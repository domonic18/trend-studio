/** 适配层：解析器真相源在 @trend/contracts；此处绑定 cloud 错误形状，保持模块签名稳定。 */

import { parseArticleDsl as contractParseArticleDsl, type DslBlock, type DslParseResult, type StockAnchor } from '@trend/contracts'
import { cloudDslSink } from './sink.js'

export type { DslBlock, DslParseResult, StockAnchor }

export function parseArticleDsl(markdown: string): DslParseResult {
  return contractParseArticleDsl(markdown, cloudDslSink)
}
