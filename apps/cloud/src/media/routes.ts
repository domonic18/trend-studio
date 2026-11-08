import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AppConfig } from '../config.js'
import { HttpError } from '../errors.js'
import { verifyPlaybackToken } from '../playback/sign.js'
import type { CosStore } from './cos-store.js'
import { isFigurePath, verifyFigureSignature } from './figure-sign.js'
import { isKeyframePath, verifyKeyframeSignature } from './keyframe-sign.js'
import { objectKeyResolver, rewritePlaylist, tokenResolver } from './playlist.js'
import { parseRange } from './range.js'

const MEDIA_FILE = /\.(m3u8|key|ts|m4s|mp4)$/i

const MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.key': 'application/octet-stream',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export interface MediaRouteDeps {
  config: AppConfig
  pool: Pool
  /** 对象存储后端；存在时媒体从 COS 读，播放列表改写为预签名地址。 */
  cos?: CosStore
}

/** 生产媒体走对象存储：应用只签发预签名地址，业务进程不代理媒体流。 */
export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDeps): void {
  const root = resolve(deps.config.mediaLocalDir ?? '.')
  const { config, pool, cos } = deps

  app.get('/media/*', async (request, reply) => {
    const wildcard = (request.params as Record<string, string>)['*'] ?? ''
    let relative: string
    try {
      relative = decodeURIComponent(wildcard)
    } catch {
      throw new HttpError(400, 'invalid media path')
    }

    const rawToken = (request.query as Record<string, unknown>).token
    const token = typeof rawToken === 'string' ? rawToken : undefined
    if (token === undefined) throw new HttpError(403, 'playback token invalid or expired')
    const payload = verifyPlaybackToken(config.mediaSigningSecret, token)
    if (payload === undefined) throw new HttpError(403, 'playback token invalid or expired')
    if (!relative.startsWith(payload.p)) throw new HttpError(403, 'playback token scope mismatch')

    const session = await pool.query(
      `SELECT 1 FROM playback_sessions
       WHERE session_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.s],
    )
    if (session.rowCount === 0) throw new HttpError(403, 'playback session closed')

    if (!MEDIA_FILE.test(relative)) throw new HttpError(404, 'not found')

    if (cos !== undefined) return serveFromObjectStore(reply, cos, relative, request, config)

    const filePath = resolve(root, relative)
    if (!filePath.startsWith(root + sep)) throw new HttpError(404, 'not found')
    const info = await stat(filePath).catch(() => undefined)
    if (info === undefined || !info.isFile()) throw new HttpError(404, 'not found')

    const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
    if (extension === '.m3u8') {
      const playlist = await readFile(filePath, 'utf8')
      return reply
        .type('application/vnd.apple.mpegurl')
        .header('cache-control', 'no-store')
        .send(await rewritePlaylist(playlist, tokenResolver(token)))
    }

    const range = parseRange(request.headers.range, info.size)
    if (range === 'invalid') {
      return reply.code(416).header('content-range', `bytes */${info.size}`).send()
    }
    const start = range?.start ?? 0
    const end = range?.end ?? info.size - 1
    reply.header('accept-ranges', 'bytes').header('cache-control', 'no-store')
    if (range !== undefined) reply.code(206).header('content-range', `bytes ${start}-${end}/${info.size}`)
    return reply
      .type(MIME_TYPES[extension] ?? 'application/octet-stream')
      .header('content-length', String(end - start + 1))
      .send(createReadStream(filePath, { start, end }))
  })

  const figureRoot = config.figureLocalDir === undefined ? undefined : resolve(config.figureLocalDir)
  if (figureRoot !== undefined || cos !== undefined) {
    app.get('/media/figures/*', async (request, reply) => {
      const wildcard = (request.params as Record<string, string>)['*'] ?? ''
      let relative: string
      try {
        relative = decodeURIComponent(wildcard)
      } catch {
        throw new HttpError(400, 'invalid figure path')
      }
      const query = request.query as Record<string, unknown>
      if (!isFigurePath(relative)
        || !verifyFigureSignature(config.mediaSigningSecret, relative, query.expires, query.sig)) {
        throw new HttpError(403, 'figure signature invalid or expired')
      }
      const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
      const headers = {
        'cache-control': `private, max-age=${config.figureSigningTtlSec}`,
        'x-content-type-options': 'nosniff',
      }
      if (cos !== undefined) {
        const bytes = await cos.getBuffer(`figures/${relative}`)
        if (bytes === undefined) throw new HttpError(404, 'not found')
        return reply.type(MIME_TYPES[extension] ?? 'application/octet-stream').headers(headers).send(bytes)
      }
      const filePath = resolve(figureRoot as string, relative)
      if (!filePath.startsWith((figureRoot as string) + sep)) throw new HttpError(404, 'not found')
      const info = await stat(filePath).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new HttpError(404, 'not found')
      return reply
        .type(MIME_TYPES[extension] ?? 'application/octet-stream')
        .headers(headers)
        .send(createReadStream(filePath))
    })
  }

  // 关键帧轨道（M9）：签名按文件限定，服务于生产端 VLM 拉帧；本地开发同进程托管。
  const keyframeRoot = config.pipeline === undefined ? undefined : resolve(config.pipeline.storageDir, 'work')
  if (keyframeRoot !== undefined) {
    app.get('/media/keyframes/*', async (request, reply) => {
      const wildcard = (request.params as Record<string, string>)['*'] ?? ''
      let relative: string
      try {
        relative = decodeURIComponent(wildcard)
      } catch {
        throw new HttpError(400, 'invalid keyframe path')
      }
      const query = request.query as Record<string, unknown>
      if (!isKeyframePath(relative)
        || !verifyKeyframeSignature(config.mediaSigningSecret, relative, query.expires, query.sig)) {
        throw new HttpError(403, 'keyframe signature invalid or expired')
      }
      const filePath = resolve(keyframeRoot, relative)
      if (!filePath.startsWith(keyframeRoot + sep)) throw new HttpError(404, 'not found')
      const info = await stat(filePath).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new HttpError(404, 'not found')
      return reply
        .type('image/jpeg')
        .header('cache-control', `private, max-age=${config.keyframeSigningTtlSec}`)
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(filePath))
    })
  }
}

/**
 * 对象存储模式：播放列表由应用改写成预签名分片地址（播放器直连对象存储，
 * 视频带宽不再经过应用机）；分片与密钥打到应用时从对象存储透传（兜底）。
 */
async function serveFromObjectStore(
  reply: FastifyReply,
  cos: CosStore,
  relative: string,
  request: FastifyRequest,
  config: AppConfig,
): Promise<FastifyReply> {
  const key = objectKeyOf(relative)
  if (key === undefined) throw new HttpError(404, 'not found')
  const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()

  if (extension === '.m3u8') {
    const body = await cos.getBuffer(key)
    if (body === undefined) throw new HttpError(404, 'not found')
    const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
    const rewritten = await rewritePlaylist(
      body.toString('utf8'),
      objectKeyResolver(dir, ref => cos.presignedGet(ref, config.playbackSessionTtlSec)),
    )
    return reply
      .type('application/vnd.apple.mpegurl')
      .header('cache-control', 'no-store')
      .send(rewritten)
  }

  const meta = await cos.stat(key)
  if (meta === undefined) throw new HttpError(404, 'not found')
  const range = parseRange(request.headers.range, meta.size)
  if (range === 'invalid') {
    return reply.code(416).header('content-range', `bytes */${meta.size}`).send()
  }
  const start = range?.start ?? 0
  const end = range?.end ?? meta.size - 1
  const stream = range === undefined
    ? await cos.getStream(key)
    : await cos.getStream(key, { start, end })
  if (stream === undefined) throw new HttpError(404, 'not found')
  reply.header('accept-ranges', 'bytes').header('cache-control', 'no-store')
  if (range !== undefined) reply.code(206).header('content-range', `bytes ${start}-${end}/${meta.size}`)
  return reply
    .type(MIME_TYPES[extension] ?? 'application/octet-stream')
    .header('content-length', String(end - start + 1))
    .send(stream)
}

/** 对象键只允许媒体根下的相对路径。 */
function objectKeyOf(relative: string): string | undefined {
  if (relative === '' || relative.startsWith('/')) return undefined
  const parts = relative.split('/')
  if (parts.some(part => part === '' || part === '..' || part === '.')) return undefined
  return parts.join('/')
}
