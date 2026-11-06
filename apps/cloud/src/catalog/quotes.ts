/** 学员端行情读取（M3b B5）：只放行「已发布课程的已发布案例股清单内」的代号。
 *
 * 未同步过时返回 pending=true + 空数组（不是 404）：渲染层据此显示「等待行情同步」。
 */

import type { QuotesItem } from '@trend/contracts/catalog'
import type { Pool } from 'pg'
import {
  MAX_QUOTE_BARS_PER_CODE,
  MAX_QUOTE_CODES,
  parseQuoteCodes,
  parseQuoteDate,
  parseQuotePeriod,
  readQuotes,
  type CatalogQuote,
  type CatalogQuotes,
  type QuoteQuery,
} from '../quotes/read.js'

export {
  MAX_QUOTE_BARS_PER_CODE,
  MAX_QUOTE_CODES,
  parseQuoteCodes,
  parseQuoteDate,
  parseQuotePeriod,
  type CatalogQuote,
  type CatalogQuotes,
  type QuoteQuery,
}

export async function readCourseQuotes(
  pool: Pool,
  courseId: string,
  query: QuoteQuery,
): Promise<CatalogQuotes> {
  return readQuotes(pool, courseId, query, { publishedOnly: true })
}
