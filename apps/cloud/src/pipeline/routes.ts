import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AccountService } from '../accounts/service.js'
import type { AppConfig } from '../config.js'
import { parseContentId, titleField } from '../content/service.js'
import { badRequest, HttpError, notFound, tooManyRequests, forbidden } from '../errors.js'
import { requireSession } from '../http/principal.js'
import { asObject, optionalStringField } from '../http/validation.js'
import { readFigureImageBytes } from '../media/figure-image.js'
import { signUploadTicket, verifyUploadTicket } from '../media/upload-sign.js'
import { RateLimiter } from '../rate-limit.js'
import type { ApprovalGate } from '@trend/contracts'
import {
  parseAssetId,
  parseAssetStatus,
  parseCandidateId,
  parseFigureId,
  parseGenerationId,
  parseJobId,
  parseJobKind,
  parseJobStatus,
  parseLanguage,
  parseSha256Header,
  type PipelineApi,
} from './service.js'

export interface PipelineRouteDeps {
  api: PipelineApi
  accounts: AccountService
  config: AppConfig
  limiter: RateLimiter
}

/** 直传的授权方式：会话直通，或签名凭据绑定「素材 + 字节数 + 摘要」。 */
type UploadAuth =
  | { kind: 'session' }
  | { kind: 'ticket'; sizeBytes: number }

function queryInt(
  query: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = query[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

function queryText(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function parseApprovalGate(value: unknown): ApprovalGate {
  if (value === 'skeleton' || value === 'final') return value
  throw badRequest('gate must be skeleton or final')
}

export async function registerPipelineRoutes(app: FastifyInstance, deps: PipelineRouteDeps): Promise<void> {
  const { api, accounts, config, limiter } = deps
  const uploadLimit = config.pipeline?.maxUploadBytes ?? 1024 * 1024
  const staff = (request: FastifyRequest): Promise<{ userId: string }> =>
    requireSession(request, accounts, ['operator', 'admin'])

  const guard = async (request: FastifyRequest): Promise<{ userId: string }> => {
    const principal = await staff(request)
    if (!limiter.take(`pipeline:${principal.userId}`, config.rateLimitPipelinePerMinute)) {
      throw tooManyRequests()
    }
    return principal
  }

  const producerGuard = async (request: FastifyRequest): Promise<{ userId: string; role: string }> => {
    const principal = await requireSession(request, accounts, ['operator', 'admin', 'producer'])
    if (!limiter.take(`pipeline:${principal.userId}`, config.rateLimitPipelinePerMinute)) {
      throw tooManyRequests()
    }
    return principal
  }

  // 直传既可带会话（管理台 / 脚本），也可只带签名凭据（生产端），二者择一即可。
  const uploadAuth = new WeakMap<FastifyRequest, UploadAuth>()

  const resolveUploadAuth = async (request: FastifyRequest): Promise<UploadAuth | null> => {
    try {
      await requireSession(request, accounts, ['operator', 'admin', 'producer'])
      return { kind: 'session' }
    } catch {
      // 无有效会话，落到签名凭据分支。
    }
    const query = asObject(request.query)
    const assetId = parseAssetId(String((request.params as { assetId: string }).assetId))
    const sizeBytes = Number(query.size)
    const header = request.headers['x-file-sha256']
    const sha256 = parseSha256Header(Array.isArray(header) ? header[0] : header)
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sha256 === undefined) return null
    const ok = verifyUploadTicket(
      config.mediaSigningSecret,
      assetId,
      sizeBytes,
      sha256,
      query.expires,
      typeof query.sig === 'string' ? query.sig : undefined,
    )
    if (!ok) return null
    if (!limiter.take(`pipeline:ticket:${assetId}`, config.rateLimitPipelinePerMinute)) {
      throw tooManyRequests()
    }
    return { kind: 'ticket', sizeBytes }
  }

  app.get('/v1/admin/content/media-assets', async request => {
    await producerGuard(request)
    const query = asObject(request.query)
    return api.listAssets({
      ...(query.courseId === undefined
        ? {}
        : { courseId: parseContentId(String(query.courseId), 'courseId') }),
      ...(query.status === undefined ? {} : { status: parseAssetStatus(query.status) }),
      offset: queryInt(query, 'offset', 0, 0, 100_000),
      limit: queryInt(query, 'limit', 50, 1, 100),
    })
  })

  app.post('/v1/admin/content/media-assets', async (request, reply) => {
    await producerGuard(request)
    const body = asObject(request.body)
    const asset = await api.createAsset({
      courseId: parseContentId(String(body.courseId ?? ''), 'courseId'),
      title: titleField(body),
    })
    return reply.code(201).send({ asset })
  })

  app.patch('/v1/admin/content/media-assets/:assetId', async request => {
    const principal = await producerGuard(request)
    const { assetId } = request.params as { assetId: string }
    const body = asObject(request.body)
    const title = optionalStringField(body, 'title', { min: 1, max: 200 })
    let status: 'archived' | undefined
    if (body.status !== undefined) {
      if (body.status !== 'archived') throw badRequest('status must be archived')
      // 归档是运营动作，生产者只改标题。
      if (principal.role === 'producer') throw forbidden('producers cannot change asset status')
      status = 'archived'
    }
    if (title === undefined && status === undefined) {
      throw badRequest('at least one of title, status is required')
    }
    return {
      asset: await api.patchAsset(parseAssetId(assetId), {
        ...(title === undefined ? {} : { title }),
        ...(status === undefined ? {} : { status }),
      }),
    }
  })

  /**
   * 直传凭据：把「素材 + 字节数 + 摘要 + 有效期」签进签名，客户端凭 URL 与 header 直传原始字节。
   */
  app.post('/v1/admin/content/media-assets/:assetId/upload-ticket', async (request, reply) => {
    await producerGuard(request)
    const { assetId } = request.params as { assetId: string }
    const id = parseAssetId(assetId)
    const body = asObject(request.body)
    const sizeBytes = Number(body.sizeBytes)
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw badRequest('sizeBytes must be a positive integer')
    const sha256 = parseSha256Header(typeof body.sha256 === 'string' ? body.sha256 : undefined)
    if (sha256 === undefined) throw badRequest('sha256 is required')

    await api.getAsset(id)

    const expiresAt = Math.floor(Date.now() / 1000) + config.uploadSigningTtlSec
    const sig = signUploadTicket(config.mediaSigningSecret, { assetId: id, sizeBytes, sha256, expiresAt })
    const url = new URL(`${config.publicBaseUrl}/v1/admin/content/media-assets/${id}/source`)
    url.searchParams.set('expires', String(expiresAt))
    url.searchParams.set('size', String(sizeBytes))
    url.searchParams.set('sig', sig)

    return reply.code(201).send({
      assetId: id,
      uploadUrl: url.toString(),
      method: 'PUT',
      // 摘要不回显：客户端自己算过，凭据只负责把它绑进签名。
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt,
    })
  })

  /** 落库确认：云端已落字节数与摘要必须与声明一致，否则素材不可信。 */
  app.post('/v1/admin/content/media-assets/:assetId/upload-confirm', async request => {
    await producerGuard(request)
    const { assetId } = request.params as { assetId: string }
    const body = asObject(request.body)
    const sizeBytes = Number(body.sizeBytes)
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw badRequest('sizeBytes must be a positive integer')
    const sha256 = parseSha256Header(typeof body.sha256 === 'string' ? body.sha256 : undefined)
    if (sha256 === undefined) throw badRequest('sha256 is required')
    const asset = await api.confirmUpload(parseAssetId(assetId), { sizeBytes, sha256 })
    return { asset }
  })

  // 上传解析器只在本插件作用域注册，避免影响其它 JSON 接口。
  await app.register(async scope => {
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload)
    })

    scope.put('/v1/admin/content/media-assets/:assetId/source', {
      bodyLimit: uploadLimit,
      preParsing: async (request, _reply, payload) => {
        const auth = await resolveUploadAuth(request)
        if (auth === null) throw new HttpError(401, 'unauthorized')
        uploadAuth.set(request, auth)
        const raw = request.headers['content-length']
        const declared = raw === undefined ? Number.NaN : Number(raw)
        if (Number.isFinite(declared) && declared > uploadLimit) {
          throw new HttpError(413, 'payload too large')
        }
        return payload
      },
    }, async request => {
      const { assetId } = request.params as { assetId: string }
      const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== 'application/octet-stream') {
        throw new HttpError(415, 'unsupported media type')
      }
      const body = request.body as AsyncIterable<Buffer> | undefined
      if (body === undefined || typeof body !== 'object') throw badRequest('source body required')
      const id = parseAssetId(assetId)
      const auth = uploadAuth.get(request)
      const header = request.headers['x-file-sha256']
      const expectedSha256 = parseSha256Header(Array.isArray(header) ? header[0] : header)
      const asset = auth?.kind === 'ticket'
        ? await api.uploadSource(id, body, expectedSha256, auth.sizeBytes)
        : await api.uploadSource(id, body, expectedSha256)
      return { asset }
    })
  })

  app.post('/v1/admin/content/media-assets/:assetId/generations', async (request, reply) => {
    await guard(request)
    const { assetId } = request.params as { assetId: string }
    const job = await api.enqueueGeneration(parseAssetId(assetId))
    return reply.code(202).send({ job })
  })

  app.get('/v1/admin/content/generations/:generationId', async request => {
    await guard(request)
    const { generationId } = request.params as { generationId: string }
    return api.getGeneration(parseGenerationId(generationId))
  })

  app.post('/v1/admin/content/generations/:generationId/apply', async request => {
    await guard(request)
    const { generationId } = request.params as { generationId: string }
    return api.applyGeneration(parseGenerationId(generationId))
  })

  app.post('/v1/admin/content/generations/:generationId/discard', async request => {
    await guard(request)
    const { generationId } = request.params as { generationId: string }
    return api.discardGeneration(parseGenerationId(generationId))
  })

  app.post('/v1/admin/content/courses/:courseId/illustrate', async (request, reply) => {
    await guard(request)
    const { courseId } = request.params as { courseId: string }
    const body = request.body === undefined ? {} : asObject(request.body)
    let chapterIds: string[] | undefined
    if (body.chapterIds !== undefined) {
      if (!Array.isArray(body.chapterIds)) throw badRequest('chapterIds must be an array')
      chapterIds = body.chapterIds.map(id => parseContentId(String(id), 'chapterId'))
    }
    const job = await api.enqueueIllustrate(parseContentId(courseId, 'courseId'), chapterIds)
    return reply.code(202).send({ job })
  })

  app.get('/v1/admin/content/figures', async request => {
    await guard(request)
    const query = asObject(request.query)
    const courseId = queryText(query, 'courseId')
    const chapterId = queryText(query, 'chapterId')
    return api.listFigures({
      ...(courseId === undefined ? {} : { courseId: parseContentId(courseId, 'courseId') }),
      ...(chapterId === undefined ? {} : { chapterId: parseContentId(chapterId, 'chapterId') }),
      offset: queryInt(query, 'offset', 0, 0, 100_000),
      limit: queryInt(query, 'limit', 50, 1, 100),
    })
  })

  app.post('/v1/admin/content/figures/:figureId/select', async request => {
    await guard(request)
    const { figureId } = request.params as { figureId: string }
    const body = asObject(request.body)
    return {
      figure: await api.selectFigure(
        parseFigureId(figureId),
        parseCandidateId(String(body.candidateId ?? '')),
      ),
    }
  })

  app.post('/v1/admin/content/figures/:figureId/regenerate', async (request, reply) => {
    await guard(request)
    const { figureId } = request.params as { figureId: string }
    const figure = await api.regenerateFigure(parseFigureId(figureId))
    return reply.code(202).send({ figure })
  })

  app.delete('/v1/admin/content/figures/:figureId', async (request, reply) => {
    await guard(request)
    const { figureId } = request.params as { figureId: string }
    await api.deleteFigure(parseFigureId(figureId))
    return reply.code(204).send()
  })

  app.get('/v1/admin/content/figure-candidates/:candidateId', async (request, reply) => {
    await guard(request)
    const { candidateId } = request.params as { candidateId: string }
    const { relPath } = await api.candidateFile(parseCandidateId(candidateId))
    const root = config.figureLocalDir
    if (root === undefined) throw new HttpError(503, 'figure storage not configured')
    const image = await readFigureImageBytes(root, relPath)
    if (image === undefined) throw notFound('candidate image not found')
    reply.header('cache-control', 'private, max-age=300')
    return reply.type(image.mime).send(image.bytes)
  })

  app.post('/v1/admin/content/courses/:courseId/publish', async request => {
    await guard(request)
    const { courseId } = request.params as { courseId: string }
    return api.publishCourse(parseContentId(courseId, 'courseId'))
  })

  // M3b 审批版本绑定：签批 = 对内容指纹签名；发布时重算比对，内容变了必须重签。
  app.post('/v1/admin/content/courses/:courseId/approvals', async request => {
    const principal = await guard(request)
    const { courseId } = request.params as { courseId: string }
    const body = asObject(request.body ?? {})
    const gate = parseApprovalGate(body.gate)
    return {
      approval: await api.approveCourse(parseContentId(courseId, 'courseId'), gate, principal.userId),
    }
  })

  app.get('/v1/admin/content/courses/:courseId/approvals', async request => {
    await guard(request)
    const { courseId } = request.params as { courseId: string }
    return api.listApprovals(parseContentId(courseId, 'courseId'))
  })

  app.post('/v1/admin/content/courses/:courseId/quotes-sync', async request => {
    await producerGuard(request)
    const { courseId } = request.params as { courseId: string }
    return api.syncQuotes(parseContentId(courseId, 'courseId'))
  })

  app.post('/v1/admin/content/media-assets/:assetId/ingest', async (request, reply) => {
    await producerGuard(request)
    const { assetId } = request.params as { assetId: string }
    const body = request.body === undefined ? {} : asObject(request.body)
    const job = await api.enqueueIngest(parseAssetId(assetId), parseLanguage(body.language))
    return reply.code(202).send({ job })
  })

  app.get('/v1/admin/content/media-assets/:assetId/transcript', async request => {
    await producerGuard(request)
    const { assetId } = request.params as { assetId: string }
    const query = asObject(request.query)
    return api.getTranscript(parseAssetId(assetId), {
      offset: queryInt(query, 'offset', 0, 0, 100_000),
      limit: queryInt(query, 'limit', 100, 1, 500),
    })
  })

  app.get('/v1/admin/content/pipeline/jobs', async request => {
    await producerGuard(request)
    const query = asObject(request.query)
    const courseId = queryText(query, 'courseId')
    const assetId = queryText(query, 'assetId')
    return api.listJobs({
      ...(query.status === undefined ? {} : { status: parseJobStatus(query.status) }),
      ...(query.kind === undefined ? {} : { kind: parseJobKind(query.kind) }),
      ...(courseId === undefined ? {} : { courseId: parseContentId(courseId, 'courseId') }),
      ...(assetId === undefined ? {} : { assetId: parseAssetId(assetId) }),
      offset: queryInt(query, 'offset', 0, 0, 100_000),
      limit: queryInt(query, 'limit', 50, 1, 100),
    })
  })

  app.get('/v1/admin/content/pipeline/jobs/:jobId', async request => {
    await producerGuard(request)
    const { jobId } = request.params as { jobId: string }
    return { job: await api.getJob(parseJobId(jobId)) }
  })

  app.post('/v1/admin/content/pipeline/jobs/:jobId/retry', async request => {
    await guard(request)
    const { jobId } = request.params as { jobId: string }
    return { job: await api.retryJob(parseJobId(jobId)) }
  })

  app.post('/v1/admin/content/pipeline/jobs/:jobId/cancel', async request => {
    await guard(request)
    const { jobId } = request.params as { jobId: string }
    return { job: await api.cancelJob(parseJobId(jobId)) }
  })
}
