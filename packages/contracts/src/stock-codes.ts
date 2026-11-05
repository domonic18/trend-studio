/** 个股代号双形态映射（架构 §6.6.1）：正文锚用 sz|sh|bj 前缀，落库用 exchange + 6 位数字。 */

export const STOCK_ANCHOR_EXCHANGES: Record<string, string> = {
  sz: 'SZSE',
  sh: 'SSE',
  bj: 'BSE',
}

export interface StockCodeParts {
  exchange: string
  code: string
}

/** 正文锚（sz000713）拆成落库形态（SZSE + 000713）；形态非法返回 null。 */
export function splitStockAnchorCode(anchor: string): StockCodeParts | null {
  const match = /^(sz|sh|bj)(\d{6})$/.exec(anchor)
  if (match === null) return null
  const prefix = match[1]
  const code = match[2]
  if (prefix === undefined || code === undefined) return null
  const exchange = STOCK_ANCHOR_EXCHANGES[prefix]
  if (exchange === undefined) return null
  return { exchange, code }
}
