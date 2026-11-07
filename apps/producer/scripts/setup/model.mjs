/** 模型可达探测：用最小请求验证「模型位」真的能出 token，而不是只填了配置。 */

export class ModelProbeError extends Error {}

/** 最小生成请求：只要一个 token，证明 key、地址、模型名都对。 */
export async function probeModel(probe, timeoutMs = 30_000) {
  const started = Date.now()
  const root = probe.baseUrl.replace(/\/+$/, '')
  const url = probe.api === 'anthropic-messages' ? `${root}/v1/messages` : `${root}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  if (probe.api === 'anthropic-messages') {
    headers['x-api-key'] = probe.key
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${probe.key}`
  }
  const body = { model: probe.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }

  let response
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new ModelProbeError(`模型不可达（${url}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ModelProbeError(`模型返回 HTTP ${response.status}：${text.slice(0, 300)}`)
  }
  return { ok: true, latencyMs: Date.now() - started }
}
