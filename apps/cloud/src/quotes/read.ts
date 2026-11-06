/** 课程行情读取（M10 v2）：管理台预览可见草稿案例股，学员端仅已发布课程。 */

import type { QuotesItem } from '@trend/contracts/catalog'
import { KLINE_PERIODS, type KlinePeriod } from '@trend/contracts'
import type { Pool } from 'pg'
import { HttpError } from '../errors.js'

const CODE = /^[0-9]{6}$/
const TRADE_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 单次请求最多 10 只（课程案例股约 10 只）。 */
export const MAX_QUOTE_CODES = 10
/**
 * 每只最多返回的 bar 数：与腾讯同步深度同量级。
 * 日线接口回溯上限约 641 根、周线约 640 根，故统一按 640 截断。
 * 周线一根即一周，640 根 ≈ 12 年，周线 M60 与 2015/2019/2021 的历史窗口都算得出来。
 */
export const MAX_QUOTE_BARS_PER_CODE = 640

export type CatalogQuote = QuotesItem

export interface CatalogQuotes {
  pending: boolean
  quotes: CatalogQuote[]
}

export interface QuoteQuery {
  codes?: string[]
  from?: string
  to?: string
  /** 取哪一周期的行情；缺省日线。 */
  period?: KlinePeriod
}

export interface ReadQuotesOptions {
  publishedOnly: boolean
}

export function parseQuoteCodes(raw: string): string[] {
  const codes = raw.split(',').map(part => part.trim()).filter(part => part !== '')
  if (codes.length === 0) throw new HttpError(400, 'codes must not be empty')
  if (codes.length > MAX_QUOTE_CODES) throw new HttpError(400, `at most ${MAX_QUOTE_CODES} codes per request`)
  for (const code of codes) {
    if (!CODE.test(code)) throw new HttpError(400, 'code must be 6 digits')
  }
  return [...new Set(codes)]
}

export function parseQuoteDate(raw: string, field: string): string {
  if (!TRADE_DATE.test(raw)) throw new HttpError(400, `${field} must be YYYY-MM-DD`)
  return raw
}

/** 周期参数校验：只认 1d / 1w，缺省日线。 */
export function parseQuotePeriod(raw: string | undefined): KlinePeriod {
  if (raw === undefined) return '1d'
  if (!(KLINE_PERIODS as readonly string[]).includes(raw)) {
    throw new HttpError(400, `period must be one of ${KLINE_PERIODS.join('/')}`)
  }
  return raw as KlinePeriod
}

interface QuoteRow {
  code: string
  trade_date: Date | string
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  volume: string | number
  amount: string | number | null
  source: string
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

function toTradeDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

export async function readQuotes(
  pool: Pool,
  courseId: string,
  query: QuoteQuery,
  options: ReadQuotesOptions,
): Promise<CatalogQuotes> {
  const period: KlinePeriod = query.period ?? '1d'
  const courseFilter = options.publishedOnly ? "AND status = 'published'" : "AND status <> 'archived'"
  const { rows: courseRows } = await pool.query<{ course_id: string }>(
    `SELECT course_id FROM courses WHERE course_id = $1 ${courseFilter}`,
    [courseId],
  )
  if (courseRows[0] === undefined) throw new HttpError(404, 'course not found')

  const stockFilter = options.publishedOnly ? "AND status = 'published'" : "AND status <> 'archived'"
  const { rows: stockRows } = await pool.query<{ code: string }>(
    `SELECT DISTINCT code FROM section_case_stocks
      WHERE course_id = $1 ${stockFilter}
      ORDER BY code`,
    [courseId],
  )
  const allowed = new Set(stockRows.map(row => row.code))
  const wanted = (query.codes ?? [...allowed]).filter(code => allowed.has(code))
  if (wanted.length === 0) return { pending: false, quotes: [] }

  const { rows } = await pool.query<QuoteRow>(
    `SELECT code, trade_date, open, high, low, close, volume, amount, source
       FROM (
         SELECT code, trade_date, open, high, low, close, volume, amount, source,
                row_number() OVER (PARTITION BY code ORDER BY trade_date DESC) AS rn
           FROM course_stock_quotes
          WHERE code = ANY($1::text[])
            AND period = $5
            AND ($2::date IS NULL OR trade_date >= $2::date)
            AND ($3::date IS NULL OR trade_date <= $3::date)
       ) ranked
      WHERE rn <= $4
      ORDER BY code, trade_date`,
    [wanted, query.from ?? null, query.to ?? null, MAX_QUOTE_BARS_PER_CODE, period],
  )
  const quotes: CatalogQuote[] = rows.map(row => ({
    code: row.code,
    tradeDate: toTradeDate(row.trade_date),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    amount: row.amount === null ? null : toNumber(row.amount),
    source: row.source,
    period,
  }))
  if (quotes.length > 0) return { pending: false, quotes }
  const { rows: anyRows } = await pool.query<{ code: string }>(
    'SELECT code FROM course_stock_quotes WHERE code = ANY($1::text[]) AND period = $2 LIMIT 1',
    [wanted, period],
  )
  return { pending: anyRows.length === 0, quotes }
}
