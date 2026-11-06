/**
 * 课程行情同步（M3b B5）：课程案例股清单 → 腾讯前复权 K 线 → 幂等 upsert 行情缓存。
 *
 * 幂等口径：(code, period, trade_date) 唯一，重跑同一批覆盖同一行——「同步后重跑行数不变」。
 * 单只失败即整体失败（让运营知道这次没同步全），不写半截数据。
 *
 * 周期：按案例股声明的周期拉原生序列（日线 / 周线）。同一代号可同时声明两种周期，
 * 此时两条序列都存（唯一键含周期），渲染层按所需周期取用。
 */

import type { KlinePeriod } from '@trend/contracts'
import type { Pool } from 'pg'
import { TENCENT_QUOTE_SOURCE, tencentSymbol, type QuoteBar, type QuoteFetcher } from './tencent.js'

export interface QuoteSyncResult {
  /** 本次写入（覆盖）的行情行数。 */
  upserted: number
  /** 参与同步的案例股数量。 */
  stocks: number
  /** 形态非法被跳过的案例股代号。 */
  skipped: string[]
}

async function upsertBars(
  pool: Pool,
  code: string,
  period: KlinePeriod,
  bars: QuoteBar[],
): Promise<number> {
  if (bars.length === 0) return 0
  const values: unknown[] = []
  const tuples: string[] = []
  bars.forEach((bar, index) => {
    const base = index * 9
    values.push(
      code,
      period,
      bar.tradeDate,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
      TENCENT_QUOTE_SOURCE,
    )
    // amount 恒为 NULL：腾讯前复权 K 线报文不含成交额，不估算。
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::date, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, NULL, $${base + 9})`,
    )
  })
  const { rowCount } = await pool.query(
    `INSERT INTO course_stock_quotes (code, period, trade_date, open, high, low, close, volume, amount, source)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (code, period, trade_date) DO UPDATE
       SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
           close = EXCLUDED.close, volume = EXCLUDED.volume,
           amount = EXCLUDED.amount, source = EXCLUDED.source, synced_at = now()`,
    values,
  )
  return rowCount ?? 0
}

/**
 * 同步一门课程的案例股行情。案例股清单取该课程全部未归档案例股
 * （draft 与 published 都取——同步先于发布也要能用；学员端只放行 published）。
 */
export async function syncCourseQuotes(
  pool: Pool,
  courseId: string,
  fetcher: QuoteFetcher,
): Promise<QuoteSyncResult> {
  const { rows: stockRows } = await pool.query<{
    code: string
    exchange: string
    period: string
  }>(
    `SELECT DISTINCT code, exchange, period FROM section_case_stocks
      WHERE course_id = $1 AND status <> 'archived'
      ORDER BY code, exchange, period`,
    [courseId],
  )
  const result: QuoteSyncResult = { upserted: 0, stocks: 0, skipped: [] }
  const seen = new Set<string>()
  for (const stock of stockRows) {
    const symbol = tencentSymbol(stock.exchange, stock.code)
    if (symbol === null) {
      result.skipped.push(stock.code)
      continue
    }
    const period: KlinePeriod = stock.period === '1w' ? '1w' : '1d'
    const key = `${stock.code}:${period}`
    if (seen.has(key)) continue
    seen.add(key)
    result.stocks += 1
    const bars = await fetcher(symbol, period)
    result.upserted += await upsertBars(pool, stock.code, period, bars)
  }
  return result
}

export { TENCENT_QUOTE_SOURCE }
