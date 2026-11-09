/** 云端交互：健康检查与当前会话校验（登录本身在 dsh 的「趋势生产」面板里走设备码流程）。 */

function normalizeBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/+$/, '')
}

async function readError(response) {
  const text = await response.text().catch(() => '')
  if (text === '') return `HTTP ${response.status}`
  try {
    const payload = JSON.parse(text)
    const error = payload.error
    if (typeof error === 'string') return error
    if (error !== undefined && typeof error.message === 'string') return error.message
    if (typeof payload.message === 'string') return payload.message
  } catch {
    // 非 JSON 错误体：直接回原文
  }
  return text.slice(0, 300)
}

/** GET /health：云端进程与数据库是否可用。 */
export async function health(baseUrl, timeoutMs = 5_000) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/health`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`云端健康检查失败：${await readError(response)}`)
}

/** GET /v1/auth/session：校验令牌并取当前用户。 */
export async function session(baseUrl, token, timeoutMs = 10_000) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/auth/session`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const detail = await readError(response)
    throw new Error(`令牌无效（${response.status}）：${detail}${response.status === 401 ? '——重新跑 login 换发' : ''}`)
  }
  const payload = await response.json()
  return payload.user
}
