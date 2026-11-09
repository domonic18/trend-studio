/** 云端后台会话凭据：授权流 commit 的 grant record 优先，老装机的 credential-ref 兜底；令牌只在请求头中出现，不进日志。 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { AuthError, readJsonResponse } from '../errors.js'
import { isConsoleGrantFresh, readConsoleGrant } from './console-grant.js'

export interface AuthConfig {
  baseUrl: string
  timeoutMs: number
  consoleTokenRef: Volatile<string>
}

/**
 * 最小请求形状：直传要用流式 body 与 duplex，这两项只有运行时的 undici 认，
 * DOM 类型里没有，故在此自定义一次，不把 DOM 的 RequestInit 泄漏到调用方。
 */
export interface CloudRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string | AsyncIterable<Uint8Array>
  duplex?: 'half'
}

/** 测试注入面：cloud-client 只依赖这个最小接口。 */
export interface AuthRequester {
  request(path: string, init: CloudRequestInit, signal?: AbortSignal, timeoutMs?: number): Promise<Response>
  requestJson(path: string, init: CloudRequestInit, signal?: AbortSignal): Promise<unknown>
}

export class CloudAuth implements AuthRequester {
  private readonly credentials: CredentialProvider

  constructor(
    ctx: Context,
    private readonly config: AuthConfig,
  ) {
    const credentials = ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) {
      throw new Error('trend-producer: 缺少 credentials 服务，无法解析云端凭据')
    }
    this.credentials = credentials
  }

  async request(path: string, init: CloudRequestInit, signal?: AbortSignal, timeoutMs = this.config.timeoutMs): Promise<Response> {
    const token = await this.consoleToken()
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.any([...(signal === undefined ? [] : [signal]), AbortSignal.timeout(timeoutMs)]),
    } as unknown as RequestInit)
  }

  async requestJson(path: string, init: CloudRequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(path, init, signal)
    return await readJsonResponse(response, '云端服务')
  }

  private async consoleToken(): Promise<string> {
    const grant = await readConsoleGrant(this.credentials)
    if (grant !== null && isConsoleGrantFresh(grant)) return grant.token
    // 老装机把令牌写在 refs 里；record 缺失或过期时仍可用，保持平滑迁移。
    const ref = this.config.consoleTokenRef.get()
    if (typeof ref === 'string' && ref !== '') {
      const hit = await this.credentials.resolve(credentialRef(ref))
      if (hit !== undefined && hit.value !== '') return hit.value
    }
    throw new AuthError()
  }
}
