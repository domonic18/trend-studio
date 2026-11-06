/**
 * K 线周期口径：课程讲日线就画日线，讲周线就画周线。
 *
 * 行情真相源按周期存（1d 日线 / 1w 周线），周线由腾讯周K 原生给出——
 * 日线接口只能回溯约 641 根，聚合出的周线仅约 128 根，周线 M60 与更早的
 * 历史窗口都算不出来。周线原生序列可回溯约 640 根（12 年），口径才成立。
 * 本模块的日线聚合仅作兜底（宿主只给到日线时）。
 */

import type { KlineBar } from './kline-chart.js'

export type KlinePeriod = '1d' | '1w'

export const PERIOD_LABEL: Record<KlinePeriod, string> = { '1d': '日线', '1w': '周线' }

export interface PeriodBar extends KlineBar {
  /** 周期起始交易日（周线为该周首个交易日）。 */
  startDate: string
  /** 周期结束交易日（周线为该周最后一个交易日）。 */
  endDate: string
}

/** ISO 周（周一起算）的周键，用于把同一周的日线归到一根周线。 */
export function isoWeekKey(tradeDate: string): string {
  const date = new Date(`${tradeDate}T00:00:00Z`)
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** 按周期聚合：日线原样透传，周线按自然周合成（开=首日开，高/低取极值，收=末日收，量=累加）。 */
export function toPeriodBars(bars: KlineBar[], period: KlinePeriod): PeriodBar[] {
  if (period === '1d') {
    return bars.map(bar => ({ ...bar, startDate: bar.tradeDate, endDate: bar.tradeDate }))
  }
  const sorted = [...bars].sort((a, b) => (a.tradeDate > b.tradeDate ? 1 : -1))
  const result: PeriodBar[] = []
  for (const bar of sorted) {
    const last = result[result.length - 1]
    if (last !== undefined && isoWeekKey(last.endDate) === isoWeekKey(bar.tradeDate)) {
      last.high = Math.max(last.high, bar.high)
      last.low = Math.min(last.low, bar.low)
      last.close = bar.close
      last.volume += bar.volume
      last.amount = last.amount === null || bar.amount === null ? null : last.amount + bar.amount
      last.endDate = bar.tradeDate
      last.tradeDate = bar.tradeDate
      continue
    }
    result.push({ ...bar, startDate: bar.tradeDate, endDate: bar.tradeDate })
  }
  return result
}

/** 周期 bar 与窗口的交集过滤：周线按周期区间与窗口相交即保留（边界周不被切碎）。 */
export function filterPeriodWindow(bars: PeriodBar[], window: { from: string; to: string }): PeriodBar[] {
  return bars.filter(bar => bar.endDate >= window.from && bar.startDate <= window.to)
}

/** 找某个交易日落在哪根周期 bar 上；不在周期内返回 -1（不静默挪到相邻 bar）。 */
export function findPeriodIndex(bars: PeriodBar[], tradeDate: string): number {
  for (const [index, bar] of bars.entries()) {
    if (tradeDate >= bar.startDate && tradeDate <= bar.endDate) return index
  }
  return -1
}

/**
 * 取某标的某周期的 bar：优先用该周期的原生序列；没有原生周线时回落到日线聚合。
 * 传入的 bars 须已按标的过滤（同一标的不同周期的 bar 混在一起会串位）。
 */
export function periodBarsOf(bars: KlineBar[], period: KlinePeriod): PeriodBar[] {
  const periodOf = (bar: KlineBar): KlinePeriod => bar.period ?? '1d'
  const native = bars.filter(bar => periodOf(bar) === period)
  if (period === '1d' || native.length > 0) {
    return native.map(bar => ({ ...bar, startDate: bar.tradeDate, endDate: bar.tradeDate }))
  }
  return toPeriodBars(bars.filter(bar => periodOf(bar) === '1d'), '1w')
}
