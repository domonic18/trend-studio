export const MAX_RESPONSE_BYTES = 512 * 1024

/** 与编排约定的稳定码一一对应；工具错误必须落在其中之一。 */
export type ToolErrorCode = 'bad-request' | 'forbidden' | 'conflict' | 'unavailable' | 'internal'

export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

export class AuthError extends Error {
  constructor(message = '云端后台会话未登录或已失效，请在 dsh 右侧栏「趋势生产」面板点「登录」重新登录（或运行 /trend login）') {
    super(message)
    this.name = 'AuthError'
  }
}

/** 云端非 2xx；携带机器可读业务码（如 assertion_unproven）与原始载荷细节。 */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly businessCode: string | undefined,
    readonly detail: Record<string, unknown>,
    message: string,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export class InvalidResponseError extends Error {
  constructor(message = '云端返回的数据无法识别，请稍后重试') {
    super(message)
    this.name = 'InvalidResponseError'
  }
}

export async function readJsonResponse(response: Response, service = '云端服务'): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new InvalidResponseError(`${service}响应过大`)
  }
  if (response.body === null) {
    throw new InvalidResponseError(`${service}返回的数据无法识别，请稍后重试`)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new InvalidResponseError(`${service}响应过大`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new InvalidResponseError(`${service}返回的数据无法识别，请稍后重试`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 云端错误体两种形状：{error:string} 与 {error:{code,message,...}}（CodedHttpError）。 */
export function errorPayload(payload: unknown): { code: string | undefined; message: string; detail: Record<string, unknown> } {
  if (!isRecord(payload) || !('error' in payload)) {
    return { code: undefined, message: '', detail: {} }
  }
  const raw = payload.error
  if (typeof raw === 'string') {
    return { code: undefined, message: raw, detail: {} }
  }
  if (isRecord(raw) && typeof raw.code === 'string') {
    const { code, message, ...detail } = raw
    return {
      code,
      message: typeof message === 'string' ? message : '',
      detail,
    }
  }
  return { code: undefined, message: '', detail: {} }
}

function statusMessage(status: number, businessCode: string | undefined): string {
  if (businessCode === 'assertion_unproven') {
    return '课件断言未通过服务端证明，请按断言词表修订 spec 与 assertions 后重试'
  }
  if (businessCode === 'widget_unproven') {
    return '存在断言证明不完整的课件，请先用 cloud_widget_write 重新提交对应 spec'
  }
  if (status === 400) return '云端拒绝请求：入参不合法，请修正后重试'
  if (status === 401 || status === 403) return '云端后台会话未登录或已失效，请在 dsh 右侧栏「趋势生产」面板点「登录」重新登录（或运行 /trend login）'
  if (status === 404) return '请求的云端资源不存在，请核对 ID'
  if (status === 409) return '云端状态冲突，请先拉取最新状态再重试'
  if (status === 429) return '请求过于频繁，请稍后重试'
  if (status >= 500) return '云端服务暂时不可用，请稍后重试'
  return '云端请求失败，请稍后重试'
}

function namedError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null
    && 'name' in error && (error as { name?: unknown }).name === name
}

/** 稳定码映射：入参→bad-request；凭据/403→forbidden；409→conflict；上游/超时/网络→unavailable；其余→internal。 */
export function toolErrorCode(error: unknown): ToolErrorCode {
  if (error instanceof InputError) return 'bad-request'
  if (error instanceof AuthError) return 'forbidden'
  if (error instanceof UpstreamError) {
    if (error.status === 401 || error.status === 403) return 'forbidden'
    if (error.status === 409) return 'conflict'
    if (error.status === 400) return 'bad-request'
    return 'unavailable'
  }
  if (error instanceof InvalidResponseError) return 'unavailable'
  if (namedError(error, 'TimeoutError')) return 'unavailable'
  if (namedError(error, 'AbortError')) return 'internal'
  if (error instanceof TypeError) return 'unavailable'
  return 'internal'
}

/** 会话失效与角色不足是两回事：前者要换发令牌，后者要换账号。 */
function sessionExpired(error: UpstreamError): boolean {
  return error.status === 401 || /session invalid or expired/i.test(error.message)
}

export function userMessage(error: unknown, operation: string): string {
  if (error instanceof InputError) return error.message
  if (error instanceof AuthError) return error.message
  if (error instanceof UpstreamError) {
    const base = error.message
    const failed = error.detail.failed
    if (error.businessCode === 'assertion_unproven' && Array.isArray(failed)) {
      return `${base}（未通过断言: ${failed.map(String).join('、')}）`
    }
    if (error.businessCode === 'upload_ticket_invalid') {
      return `${base}｜直传凭据短时效且绑定素材，请重新签发后重试（不必更换会话令牌）`
    }
    if (sessionExpired(error)) {
      return `${base}｜云端后台会话已失效：在 dsh 右侧栏「趋势生产」面板点「登录」重新授权（或运行 /trend login；教员账号，无需重建）`
    }
    if (error.status === 403) {
      return `${base}｜当前账号无权执行该操作（发布、签批、账号与模型配置限 operator/admin）`
    }
    return base
  }
  if (error instanceof InvalidResponseError) return error.message
  if (namedError(error, 'TimeoutError')) return `${operation}超时，请稍后重试`
  if (namedError(error, 'AbortError')) return '请求已取消'
  if (error instanceof TypeError) return '无法连接云端服务，请检查网络与 baseUrl 配置'
  return `${operation}失败，请稍后重试`
}

/** 工具失败统一出口：错误消息携带稳定码与可行动原因，模型可直接据此回灌重写。 */
export function toToolError(error: unknown, operation: string): Error {
  const code = toolErrorCode(error)
  const message = `[${code}] ${userMessage(error, operation)}`
  return new Error(message, { cause: error })
}
