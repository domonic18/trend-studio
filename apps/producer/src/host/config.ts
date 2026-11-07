import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

export const LOCAL_BASE_URL = 'http://127.0.0.1:3939'

export const ENVIRONMENTS = ['local', 'staging', 'production'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** 视觉模型的协议形态——与 pi-ai provider 的 `api` 同一套取值。 */
export const MODEL_APIS = ['openai-completions', 'anthropic-messages'] as const
export type ModelApi = (typeof MODEL_APIS)[number]

export interface UnderstandingConfig {
  /** 生产端视觉模型密钥的环境变量名（dsh .env / 启动环境注入）。 */
  apiKeyEnv: string
  /** 协议形态：OpenAI 兼容走 `/chat/completions`，Anthropic 走 `/v1/messages`。 */
  api: ModelApi
  baseUrl: string
  model: string
  /** 强制 thinking 模型：预算给小必截断（选型实测红线）。 */
  maxTokens: number
  /** 每 N 帧取 1 帧（2 = 1帧/30s，帧轨道按 15s 抽取）。 */
  frameEveryNth: number
}

export interface Config {
  environment: Environment
  baseUrl: string
  consoleTokenRef: Volatile<string>
  timeoutMs: number
  logLevel: LogLevel
  understanding: UnderstandingConfig
}

function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value)
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value)
}

function environmentOrDefault(): Environment {
  const value = process.env.TREND_PRODUCER_ENV
  return value !== undefined && isEnvironment(value) ? value : 'local'
}

function logLevelOrDefault(): LogLevel {
  const value = process.env.TREND_PRODUCER_LOG_LEVEL
  return value !== undefined && isLogLevel(value) ? value : 'warn'
}

export const Config = Schema.object({
  environment: Schema.string().default(environmentOrDefault()),
  baseUrl: Schema.string().default(process.env.TREND_PRODUCER_BASE_URL?.trim() || LOCAL_BASE_URL),
  consoleTokenRef: Schema.string().role('credential-ref').default('TREND_PRODUCER_CONSOLE_TOKEN').volatile(),
  // 生产编排单步工具调用可能聚合多次云端请求，超时需大于学员插件（10s）。
  timeoutMs: Schema.number().default(30_000),
  logLevel: Schema.string().default(logLevelOrDefault()),
  understanding: Schema.object({
    apiKeyEnv: Schema.string().default('MINIMAX_API_KEY'),
    api: Schema.union(MODEL_APIS.map(api => Schema.const(api))).default('openai-completions'),
    baseUrl: Schema.string().default('https://api.minimaxi.com/v1'),
    model: Schema.string().default('MiniMax-M3.1-Flash'),
    maxTokens: Schema.number().default(32_768),
    frameEveryNth: Schema.number().default(2),
  }),
})

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname === '0.0.0.0'
    || /^127\./.test(hostname)
}

/** 校验并规范化配置；失败直接阻止插件激活，避免用错误地址静默请求。 */
export function resolveConfig(input: Config): Config {
  if (!isEnvironment(input.environment)) {
    throw new Error(`trend-producer: environment 必须是 ${ENVIRONMENTS.join('/')}`)
  }
  if (!isLogLevel(input.logLevel)) {
    throw new Error(`trend-producer: logLevel 必须是 ${LOG_LEVELS.join('/')}`)
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error('trend-producer: timeoutMs 必须是正数')
  }

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('trend-producer: baseUrl 不是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('trend-producer: baseUrl 协议必须是 http/https')
  }
  if (input.environment !== 'local') {
    if (url.protocol !== 'https:') {
      throw new Error(`trend-producer: ${input.environment} 环境必须使用 HTTPS`)
    }
    if (input.environment === 'production' && isLoopback(url.hostname)) {
      throw new Error('trend-producer: production 环境拒绝本机地址')
    }
  }

  return { ...input, baseUrl, environment: input.environment, logLevel: input.logLevel }
}
