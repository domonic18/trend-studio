import { createHmac } from 'node:crypto'
import { safeEqual } from '../auth/tokens.js'

/** 相对 <PIPELINE_STORAGE_DIR>/work 的路径；sec 上限 86400（5 位）覆盖 24h 素材。 */
const KEYFRAME_PATH = /^asset_[0-9a-f]{16}\/keyframes\/\d{1,5}\.jpg$/

function signature(secret: string, relPath: string, expires: number): string {
  return createHmac('sha256', secret).update(`${relPath}\n${expires}`).digest('base64url')
}

/** 与图示签名同构（path\nexpires 的 HMAC），但按素材+秒寻址，供生产端 VLM 拉帧。 */
export function signKeyframeUrl(
  secret: string,
  mediaBaseUrl: string,
  relPath: string,
  ttlSec: number,
  now = Date.now(),
): string {
  if (!KEYFRAME_PATH.test(relPath)) throw new Error('invalid keyframe path')
  const expires = Math.floor(now / 1000) + ttlSec
  const path = relPath.split('/').map(encodeURIComponent).join('/')
  // mediaBaseUrl 已含 /media 前缀（本地）或 CDN 映射根（生产），与 figure URL 同约定。
  return `${mediaBaseUrl.replace(/\/+$/, '')}/keyframes/${path}?expires=${expires}&sig=${signature(secret, relPath, expires)}`
}

export function isKeyframePath(relPath: string): boolean {
  return KEYFRAME_PATH.test(relPath)
}

export function verifyKeyframeSignature(
  secret: string,
  relPath: string,
  expiresRaw: unknown,
  sig: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!KEYFRAME_PATH.test(relPath)) return false
  if (typeof sig !== 'string' || sig === '') return false
  const expires = Number(expiresRaw)
  if (!Number.isInteger(expires) || expires <= nowSec) return false
  return safeEqual(sig, signature(secret, relPath, expires))
}
