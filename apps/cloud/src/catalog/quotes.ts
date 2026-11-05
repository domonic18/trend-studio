/**
 * 学员端行情读取（M3b B5）：只放行「已发布课程的已发布案例股清单内」的代号。
 *
 * 未同步过时返回 pending=true + 空数组（不是 404）：渲染层据此显示「等待行情同步」。
 */

import type { QuotesItem } from '@trend/contracts/catalog'
import type { Pool } from 'pg'
import { HttpError } from '../errors.js'

const CODE = /^[0-9]{6}$/
const TRADE_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 单次请求最多 10 只（课程案例股约 10 只）。 */
export const MAX_QUOTE_CODES = 10
/** 每只最多返回的 bar 数（同步回溯 320 根，同量级）。 */
export const MAX_QUOTE_BARS_PER_CODE = 320

/** 行情条目形状的真相源在 @trend/contracts（学员端契约同源）。 */
export type CatalogQuote = QuotesItem

export interface CatalogQuotes {
  pending: boolean
  quotes: CatalogQuote[]
}

export interface QuoteQuery {
  codes?: string[]
  from?: string
  to?: string
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
  // pg 把 date 列解析为本地零点 Date；取本地年月日，勿用 toISOString（东八区会退一天）。
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

export async function readCourseQuotes(
  pool: Pool,
  courseId: string,
  query: QuoteQuery,
): Promise<CatalogQuotes> {
  const { rows: courseRows } = await pool.query<{ course_id: string }>(
    `SELECT course_id FROM courses WHERE course_id = $1 AND status = 'published'`,
    [courseId],
  )
  if (courseRows[0] === undefined) throw new HttpError(404, 'course not found')

  const { rows: stockRows } = await pool.query<{ code: string }>(
    `SELECT DISTINCT code FROM section_case_stocks
      WHERE course_id = $1 AND status = 'published'
      ORDER BY code`,
    [courseId],
  )
  const allowed = new Set(stockRows.map(row => row.code))
  // 清单外代号直接过滤：学员不可查询本课程清单外的标的。
  const wanted = (query.codes ?? [...allowed]).filter(code => allowed.has(code))
  if (wanted.length === 0) return { pending: false, quotes: [] }

  const { rows } = await pool.query<QuoteRow>(
    `SELECT code, trade_date, open, high, low, close, volume, amount, source
       FROM (
         SELECT code, trade_date, open, high, low, close, volume, amount, source,
                row_number() OVER (PARTITION BY code ORDER BY trade_date DESC) AS rn
           FROM course_stock_quotes
          WHERE code = ANY($1::text[])
            AND ($2::date IS NULL OR trade_date >= $2::date)
            AND ($3::date IS NULL OR trade_date <= $3::date)
       ) ranked
      WHERE rn <= $4
      ORDER BY code, trade_date`,
    [wanted, query.from ?? null, query.to ?? null, MAX_QUOTE_BARS_PER_CODE],
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
  }))
  // pending 只表示「压根没同步过」：窗口内查不到数据不算待同步。
  if (quotes.length > 0) return { pending: false, quotes }
  const { rows: anyRows } = await pool.query<{ code: string }>(
    'SELECT code FROM course_stock_quotes WHERE code = ANY($1::text[]) LIMIT 1',
    [wanted],
  )
  return { pending: anyRows.length === 0, quotes }
}
