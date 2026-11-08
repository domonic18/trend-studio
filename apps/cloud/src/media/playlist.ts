import { posix } from 'node:path'

/**
 * 播放列表里引用的分片/密钥/初始化片段。相对引用按播放列表所在目录解析。
 */
const SEGMENT_REF = /^\S+\.(?:ts|m4s|mp4|key)$/

/** 把播放列表中的引用解析成播放器可直接访问的地址。 */
export type PlaylistResolver = (ref: string) => string | Promise<string>

/**
 * 改写播放列表中的引用：
 * - local 模式：给引用追加应用侧播放令牌（令牌校验与 DB 会话校验留在应用）
 * - cos 模式：解析成对象存储的短时预签名地址，播放器直连对象存储取分片
 */
export async function rewritePlaylist(body: string, resolve: PlaylistResolver): Promise<string> {
  const out: string[] = []
  for (const line of body.split('\n')) {
    if (line.includes('URI="')) {
      out.push(await rewriteUriAttributes(line, resolve))
      continue
    }
    const trimmed = line.trim()
    if (trimmed !== '' && !trimmed.startsWith('#') && SEGMENT_REF.test(trimmed)) {
      out.push(line.replace(trimmed, await resolve(trimmed)))
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 一行里可能有多个 URI="..."（EXT-X-MAP、EXT-X-KEY 等），逐个改写。 */
async function rewriteUriAttributes(line: string, resolve: PlaylistResolver): Promise<string> {
  const pattern = /URI="([^"]*)"/g
  const parts: string[] = []
  let cursor = 0
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    parts.push(line.slice(cursor, match.index))
    parts.push(`URI="${await resolve(match[1] ?? '')}"`)
    cursor = match.index + match[0].length
  }
  parts.push(line.slice(cursor))
  return parts.join('')
}

/** 本地模式：引用保持相对路径，追加播放令牌。 */
export function tokenResolver(token: string): PlaylistResolver {
  return ref => (ref.includes('token=')
    ? ref
    : `${ref}${ref.includes('?') ? '&' : '?'}token=${token}`)
}

/**
 * 对象存储模式：引用按播放列表所在目录解析成对象键，再换成预签名地址。
 */
export function objectKeyResolver(dir: string, presign: (key: string) => Promise<string>): PlaylistResolver {
  return async ref => presign(joinObjectKey(dir, ref))
}

/** 解析对象键；引用里的上级目录一律拒绝（只允许播放列表同目录下的文件）。 */
export function joinObjectKey(dir: string, ref: string): string {
  const cleaned = ref.replace(/^\/+/, '')
  if (cleaned === '' || cleaned.split('/').some(part => part === '..')) {
    throw new Error('invalid playlist reference')
  }
  const joined = posix.join(dir, cleaned)
  if (dir !== '' && !joined.startsWith(dir.endsWith('/') ? dir : `${dir}/`)) {
    throw new Error('invalid playlist reference')
  }
  return joined
}
