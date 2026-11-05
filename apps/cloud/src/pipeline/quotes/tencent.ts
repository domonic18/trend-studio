/**
 * 腾讯前复权日K 拉取与解析（M3b B5）。
 *
 * 报文样例（web.ifzq.gtimg.cn fqkline）：
 *   {"code":0,"data":{"sz000001":{"qfqday":[["2026-10-22","11.410","11.300","11.420","11.260","1297649.000"]]}}}
 * 行字段序为 [日期, 开, 收, 高, 低, 成交量(手)]——开收在前、高低在后，解析不可颠倒。
 * 该接口不含成交额，故下游 amount 为 null（源不可得，不估算）。
 */

/** 复权口径标识：写库 source 列与接口返回共用。 */
export const TENCENT_QUOTE_SOURCE = 'tencent-qfq'

export interface QuoteBar {
  /** 交易日 YYYY-MM-DD。 */
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  /** 成交量，单位手（1 手 = 100 股），沿用腾讯原始口径。 */
  volume: number
}

/** 拉取器：入参为带市场前缀的 symbol（sz000001 / sh600519 / bj430047），出参为前复权日K序列。 */
export type QuoteFetcher = (symbol: string) => Promise<QuoteBar[]>

export type QuotesErrorKind = 'unavailable' | 'invalid_response' | 'rate_limited'

export class QuotesError extends Error {
  constructor(readonly kind: QuotesErrorKind) {
    super(`quotes ${kind}`)
    this.name = 'QuotesError'
  }
}

const EXCHANGE_PREFIX: Record<string, string> = { SZSE: 'sz', SSE: 'sh', BSE: 'bj' }
const CODE = /^[0-9]{6}$/
const TRADE_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 交易所 + 6 位数字代号 → 腾讯 symbol；形态不合法返回 null（跳过该股，不中断整轮同步）。 */
export function tencentSymbol(exchange: string, code: string): string | null {
  const prefix = EXCHANGE_PREFIX[exchange]
  if (prefix === undefined || !CODE.test(code)) return null
  return `${prefix}${code}`
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseRow(row: unknown): QuoteBar | null {
  if (!Array.isArray(row) || row.length < 6) return null
  const tradeDate = typeof row[0] === 'string' ? row[0] : String(row[0] ?? '')
  if (!TRADE_DATE.test(tradeDate)) return null
  const open = toNumber(row[1])
  const close = toNumber(row[2])
  const high = toNumber(row[3])
  const low = toNumber(row[4])
  const volume = toNumber(row[5])
  if (open === null || close === null || high === null || low === null || volume === null) return null
  if (open < 0 || close < 0 || high < 0 || low < 0 || volume < 0) return null
  return { tradeDate, open, high, low, close, volume: Math.round(volume) }
}

/**
 * 解析腾讯日K 报文为 bar 序列（纯函数，便于用真实报文夹具单测）。
 * `qfqday` 为前复权日线；个别标的回落到不复权 `day`，两者字段序一致。
 */
export function parseTencentDailyKline(text: string, symbol: string): QuoteBar[] {
  let payload: { code?: unknown; data?: Record<string, { qfqday?: unknown; day?: unknown }> }
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    throw new QuotesError('invalid_response')
  }
  if (payload.code !== 0) throw new QuotesError('invalid_response')
  const entry = payload.data?.[symbol]
  const rows = entry?.qfqday ?? entry?.day
  if (!Array.isArray(rows)) throw new QuotesError('invalid_response')
  const bars: QuoteBar[] = []
  for (const row of rows) {
    const bar = parseRow(row)
    if (bar !== null) bars.push(bar)
  }
  return bars
}

export interface TencentQuoteFetcherOptions {
  baseUrl?: string
  timeoutMs?: number
  /** 失败重试次数（总尝试次数 = retries + 1）。 */
  retries?: number
  /** 回溯 bar 数（腾讯上限约 640）。 */
  count?: number
}

export function createTencentQuoteFetcher(options: TencentQuoteFetcherOptions = {}): QuoteFetcher {
  const baseUrl = (options.baseUrl ?? 'https://web.ifzq.gtimg.cn').replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? 10_000
  const retries = options.retries ?? 2
  const count = options.count ?? 320
  return async (symbol: string): Promise<QuoteBar[]> => {
    const url = `${baseUrl}/appstock/app/fqkline/get?param=${symbol},day,,,${count},qfq`
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status === 429) throw new QuotesError('rate_limited')
        if (!response.ok) throw new QuotesError('unavailable')
        return parseTencentDailyKline(await response.text(), symbol)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new QuotesError('unavailable')
  }
}
