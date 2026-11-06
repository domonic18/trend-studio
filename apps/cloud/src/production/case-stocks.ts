/** 节级案例股清单（M10 R2，架构 §6.6.3）：生产端抽取，云端复检后落库；同节同代号覆盖更新。 */

import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { badRequest, codedBadRequest } from '../errors.js'

export const CASE_STOCK_BATCH_LIMIT = 10
const CODE = /^[0-9]{6}$/
const UNIT_ID = /^su_[0-9a-f]{16}$/
const EXCHANGES = ['SZSE', 'SSE', 'BSE'] as const
/** K 线周期：课程讲日线画日线，讲周线画周线（行情按周期原生存放）。 */
const PERIODS = ['1d', '1w'] as const

export type CaseStockExchange = (typeof EXCHANGES)[number]
export type CaseStockPeriod = (typeof PERIODS)[number]

export interface CaseStockEvent {
  date: string
  label: string
  unitId: string
}

export interface CaseStockInput {
  name: string
  exchange: CaseStockExchange
  code: string
  period: CaseStockPeriod
  windowStart: string
  windowEnd: string
  events: CaseStockEvent[]
  note?: string
}

export interface CaseStockEntry {
  stockRefId: string
  sectionId: string
  name: string
  exchange: string
  code: string
  period: CaseStockPeriod
  windowStart: string
  windowEnd: string
  events: CaseStockEvent[]
  note: string | null
  status: string
  position: number
  createdAt: string
}

export interface CaseStockSaveResult {
  stockRefId: string
  code: string
  deduped: boolean
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseEvent(raw: unknown, index: number): CaseStockEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest(`events[${index}] must be an object`)
  }
  const event = raw as Record<string, unknown>
  const date = typeof event.date === 'string' ? event.date : ''
  if (!isIsoDate(date)) throw badRequest(`events[${index}].date must be YYYY-MM-DD`)
  const label = typeof event.label === 'string' ? event.label.trim() : ''
  if ([...label].length < 1 || [...label].length > 100) {
    throw badRequest(`events[${index}].label must be 1–100 characters`)
  }
  const unitId = typeof event.unitId === 'string' ? event.unitId : ''
  if (!UNIT_ID.test(unitId)) throw badRequest(`events[${index}].unitId invalid`)
  return { date, label, unitId }
}

function parseStock(raw: unknown, index: number): CaseStockInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest(`stocks[${index}] must be an object`)
  }
  const stock = raw as Record<string, unknown>
  const name = typeof stock.name === 'string' ? stock.name.trim() : ''
  if ([...name].length < 1 || [...name].length > 50) {
    throw badRequest(`stocks[${index}].name must be 1–50 characters`)
  }
  const exchange = typeof stock.exchange === 'string' ? stock.exchange : ''
  if (!EXCHANGES.includes(exchange as CaseStockExchange)) {
    throw badRequest(`stocks[${index}].exchange must be one of ${EXCHANGES.join('/')}`)
  }
  const code = typeof stock.code === 'string' ? stock.code : ''
  if (!CODE.test(code)) throw badRequest(`stocks[${index}].code must be 6 digits`)
  const period = stock.period === undefined ? '1d' : typeof stock.period === 'string' ? stock.period : ''
  if (!PERIODS.includes(period as CaseStockPeriod)) {
    throw badRequest(`stocks[${index}].period must be one of ${PERIODS.join('/')}`)
  }
  const windowStart = typeof stock.windowStart === 'string' ? stock.windowStart : ''
  const windowEnd = typeof stock.windowEnd === 'string' ? stock.windowEnd : ''
  if (!isIsoDate(windowStart)) throw badRequest(`stocks[${index}].windowStart must be YYYY-MM-DD`)
  if (!isIsoDate(windowEnd)) throw badRequest(`stocks[${index}].windowEnd must be YYYY-MM-DD`)
  if (windowEnd < windowStart) throw badRequest(`stocks[${index}] windowEnd must not precede windowStart`)
  const events = stock.events === undefined ? [] : stock.events
  if (!Array.isArray(events)) throw badRequest(`stocks[${index}].events must be an array`)
  if (events.length > 20) throw badRequest(`stocks[${index}].events must contain at most 20 items`)
  const parsedEvents = events.map((event, eventIndex) => parseEvent(event, eventIndex))
  for (const event of parsedEvents) {
    if (event.date < windowStart || event.date > windowEnd) {
      throw codedBadRequest('event_date_out_of_window', 'event date must fall inside the case stock window', {
        stockCode: code,
        date: event.date,
        windowStart,
        windowEnd,
      })
    }
  }
  const note = stock.note === undefined ? undefined : typeof stock.note === 'string' ? stock.note.trim() : ''
  if (note !== undefined && [...note].length > 500) {
    throw badRequest(`stocks[${index}].note must be at most 500 characters`)
  }
  return {
    name,
    exchange: exchange as CaseStockExchange,
    code,
    period: period as CaseStockPeriod,
    windowStart,
    windowEnd,
    events: parsedEvents,
    ...(note === undefined || note === '' ? {} : { note }),
  }
}

/** HTTP 边界形状校验：单批 1–10 只；语义复检（日期落窗、unit 可回溯）落库前另做。 */
export function parseCaseStocksInput(input: unknown): CaseStockInput[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw badRequest('request body must be a JSON object')
  }
  const body = input as Record<string, unknown>
  const stocks = body.stocks
  if (!Array.isArray(stocks)) throw badRequest('stocks must be an array')
  if (stocks.length < 1 || stocks.length > CASE_STOCK_BATCH_LIMIT) {
    throw badRequest(`stocks must contain 1–${CASE_STOCK_BATCH_LIMIT} items`)
  }
  return stocks.map(parseStock)
}

function stockRefIdFor(): string {
  return `cst_${randomBytes(8).toString('hex')}`
}

/** 事件锚点必须可回溯 source unit；缺任一即整体拒绝（不部分落库）。 */
async function assertUnitsExist(pool: Pool, stocks: CaseStockInput[]): Promise<void> {
  const unitIds = [...new Set(stocks.flatMap(stock => stock.events.map(event => event.unitId)))]
  if (unitIds.length === 0) return
  const { rows } = await pool.query<{ unit_id: string }>(
    'SELECT unit_id FROM source_units WHERE unit_id = ANY($1::text[])',
    [unitIds],
  )
  const known = new Set(rows.map(row => row.unit_id))
  const missing = unitIds.filter(unitId => !known.has(unitId))
  if (missing.length > 0) {
    throw codedBadRequest('unit_ref_unknown', 'case stock event references an unknown source unit', {
      unitIds: missing,
    })
  }
}

/** 同节同代号覆盖更新；返回每只的落库 id 与是否命中既有行。 */
export async function upsertSectionCaseStocks(
  pool: Pool,
  scope: { sectionId: string; courseId: string },
  stocks: CaseStockInput[],
): Promise<CaseStockSaveResult[]> {
  await assertUnitsExist(pool, stocks)
  const saved: CaseStockSaveResult[] = []
  for (const [index, stock] of stocks.entries()) {
    const existing = await pool.query<{ stock_ref_id: string }>(
      'SELECT stock_ref_id FROM section_case_stocks WHERE section_id = $1 AND code = $2',
      [scope.sectionId, stock.code],
    )
    const { rows } = await pool.query<{ stock_ref_id: string }>(
      `INSERT INTO section_case_stocks
         (stock_ref_id, section_id, course_id, name, exchange, code, period, window_start, window_end, events, note, status, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'draft', $12)
       ON CONFLICT (section_id, code) DO UPDATE
         SET name = EXCLUDED.name, exchange = EXCLUDED.exchange, period = EXCLUDED.period,
             window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
             events = EXCLUDED.events, note = EXCLUDED.note, status = 'draft', updated_at = now()
       RETURNING stock_ref_id`,
      [
        stockRefIdFor(),
        scope.sectionId,
        scope.courseId,
        stock.name,
        stock.exchange,
        stock.code,
        stock.period,
        stock.windowStart,
        stock.windowEnd,
        JSON.stringify(stock.events),
        stock.note ?? null,
        index + 1,
      ],
    )
    const row = rows[0]
    if (row === undefined) throw new Error('case stock upsert returned no row')
    saved.push({
      stockRefId: row.stock_ref_id,
      code: stock.code,
      deduped: existing.rows.length > 0,
    })
  }
  return saved
}

export async function listSectionCaseStocks(pool: Pool, sectionId: string): Promise<CaseStockEntry[]> {
  const { rows } = await pool.query<{
    stock_ref_id: string
    section_id: string
    name: string
    exchange: string
    code: string
    period: string
    window_start: string
    window_end: string
    events: unknown
    note: string | null
    status: string
    position: number
    created_at: Date
  }>(
    `SELECT stock_ref_id, section_id, name, exchange, code, period,
            window_start::text AS window_start, window_end::text AS window_end,
            events, note, status, position, created_at
     FROM section_case_stocks WHERE section_id = $1 ORDER BY position, stock_ref_id`,
    [sectionId],
  )
  return rows.map(row => ({
    stockRefId: row.stock_ref_id,
    sectionId: row.section_id,
    name: row.name,
    exchange: row.exchange,
    code: row.code,
    period: (PERIODS.includes(row.period as CaseStockPeriod) ? row.period : '1d') as CaseStockPeriod,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    events: (row.events ?? []) as CaseStockEvent[],
    note: row.note,
    status: row.status,
    position: row.position,
    createdAt: row.created_at.toISOString(),
  }))
}
