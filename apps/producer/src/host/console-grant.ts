/**
 * 教员端登录态的凭据 record：单一真相源。
 *
 * 授权流 commit 进来的 GrantRecord（scope `trend-producer` / id `console`），
 * 与云端 console 会话一一对应。payload 对 seam 不透明，只有本插件解释——
 * 解析失败按「未登录」处理，不让损坏的存量数据阻塞登录重试。
 */
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

export const CONSOLE_GRANT_KEY = credentialKey('trend-producer', 'console')

/** 提前判失效的余量：令牌在 expiresAt 前就不再启用，避免请求在途时刚好过期。 */
export const GRANT_EXPIRY_SKEW_MS = 60_000

export interface ConsoleGrantUser {
  userId: string
  username: string
  displayName: string | null
  role: string
}

export interface ConsoleGrantPayload {
  token: string
  expiresAt: number
  user: ConsoleGrantUser
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

/** 存量 record 不可信：任一字段形状不对按无凭据处理。 */
export function parseConsoleGrant(record: CredentialRecord | undefined): ConsoleGrantPayload | null {
  if (record === undefined || record.kind !== 'grant') return null
  const payload = asRecord(record.payload)
  if (payload === null) return null
  const user = asRecord(payload.user)
  if (user === null) return null
  if (typeof payload.token !== 'string' || payload.token === '') return null
  if (typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= 0) return null
  if (typeof user.userId !== 'string' || typeof user.username !== 'string' || typeof user.role !== 'string') return null
  if (user.displayName !== null && typeof user.displayName !== 'string') return null
  return {
    token: payload.token,
    expiresAt: payload.expiresAt,
    user: { userId: user.userId, username: user.username, displayName: user.displayName, role: user.role },
  }
}

export async function readConsoleGrant(credentials: CredentialProvider): Promise<ConsoleGrantPayload | null> {
  return parseConsoleGrant(await credentials.readRecord(CONSOLE_GRANT_KEY))
}

export function isConsoleGrantFresh(grant: ConsoleGrantPayload | null, now = Date.now()): boolean {
  return grant !== null && grant.expiresAt - GRANT_EXPIRY_SKEW_MS > now
}

export function toConsoleGrantRecord(grant: ConsoleGrantPayload): CredentialRecord {
  return { kind: 'grant', payload: grant }
}
