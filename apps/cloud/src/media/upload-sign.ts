import { createHmac } from 'node:crypto'
import { safeEqual } from '../auth/tokens.js'

const SHA256 = /^[0-9a-f]{64}$/

/** 签名载荷绑定素材、字节数、摘要与有效期：一张票只能用于它签发的那份字节。 */
function signature(secret: string, assetId: string, sizeBytes: number, sha256: string, expires: number): string {
  return createHmac('sha256', secret)
    .update(`${assetId}\n${sizeBytes}\n${sha256}\n${expires}`)
    .digest('base64url')
}

export interface UploadTicketPayload {
  assetId: string
  sizeBytes: number
  sha256: string
  expiresAt: number
}

export function signUploadTicket(secret: string, payload: UploadTicketPayload): string {
  return signature(secret, payload.assetId, payload.sizeBytes, payload.sha256, payload.expiresAt)
}

export function verifyUploadTicket(
  secret: string,
  assetId: string,
  sizeBytes: number,
  sha256: string,
  expiresRaw: unknown,
  sigRaw: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof sigRaw !== 'string' || sigRaw === '') return false
  const expires = Number(expiresRaw)
  if (!Number.isInteger(expires) || expires <= nowSec) return false
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return false
  if (!SHA256.test(sha256)) return false
  return safeEqual(sigRaw, signature(secret, assetId, sizeBytes, sha256, expires))
}
