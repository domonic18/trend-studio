/** 逐根回放取 bar 的纯逻辑：按标的归一代码、按案例窗口筛选（供组件与单测共用）。 */

import type { KlineBar } from '../kline/kline-chart.js'

export interface ReplayWindow {
  from: string
  to: string
}

/** 行情缓存用 6 位纯数字码，DSL 与课件用带交易所前缀的码（sz000661），比对前先归一。 */
export function bareStockCode(code: string): string {
  return code.replace(/^[a-z]{2}/i, '')
}

/**
 * 取回放用的 bar：一节可能有多个案例股，混在一起画会串位，故按课件标的过滤。
 * bars 不带 code 时（宿主未提供标的信息）不过滤，保持兼容。
 */
export function selectReplayBars(bars: KlineBar[], code: string, window: ReplayWindow): KlineBar[] {
  const bare = bareStockCode(code)
  const coded = bars.filter(bar => typeof bar.code === 'string' && bar.code !== '')
  const scoped = bare === '' ? bars : coded.length > 0 ? coded.filter(bar => bar.code === bare) : bars
  return scoped
    .filter(bar => bar.tradeDate >= window.from && bar.tradeDate <= window.to)
    .slice()
    .sort((a, b) => (a.tradeDate > b.tradeDate ? 1 : -1))
}
