/** DSL v1 语义校验（第 2 层，随 PUT article 复检）：引用存在性、片段窗 grounded、锚格式。 */

import type { DslBlock, DslParseResult } from './dsl-parse.js'
import type { DslErrorSink } from './errors-sink.js'
import { checkAttrs, parseBody } from './dsl.js'
import { STOCK_CODE } from './ids.js'
import type { DslDirectiveName } from './enums.js'
import { splitStockAnchorCode } from './stock-codes.js'

export interface DslUnitRef {
  assetId: string
  startMs: number
  endMs: number
}

export interface DslValidateCtx {
  sectionFigureIds: Set<string>
  units: Map<string, DslUnitRef>
  /** clip 时间窗是否完整落在该 assetId 某 source unit 的 [startMs, endMs] 内（宿主懒查）。 */
  clipGrounded: (assetId: string, fromMs: number, toMs: number) => Promise<boolean>
  /** 个股锚是否在本节案例股清单内（宿主懒查；清单以 exchange + 6 位数字形态比对）。 */
  stockInSection: (exchange: string, code: string) => Promise<boolean>
}

export const CLIP_MAX_PER_SECTION = 3
export const CLIP_WINDOW_MAX_SEC = 60

export async function validateArticleDsl(parsed: DslParseResult, ctx: DslValidateCtx, sink: DslErrorSink): Promise<void> {
  const clipBlocks = parsed.blocks.filter(block => block.directive === 'clip')
  if (clipBlocks.length > CLIP_MAX_PER_SECTION) {
    sink.coded('clip_not_grounded', 'article contains more than 3 clip blocks', {
      found: clipBlocks.length,
    })
  }
  for (const block of parsed.blocks) await validateBlock(block, ctx, sink)
  for (const anchor of parsed.anchors) {
    if (!STOCK_CODE.test(anchor.code)) sink.bad(`dsl: stock anchor code '${anchor.code}' invalid (line ${anchor.line})`)
    const labelLength = [...anchor.label].length
    if (labelLength < 1 || labelLength > 20) {
      sink.bad(`dsl: stock anchor label must be 1–20 characters (line ${anchor.line})`)
    }
    const parts = splitStockAnchorCode(anchor.code)
    if (parts === null) sink.bad(`dsl: stock anchor code '${anchor.code}' invalid (line ${anchor.line})`)
    if (!(await ctx.stockInSection(parts.exchange, parts.code))) {
      sink.coded('stock_not_in_list', 'stock anchor is not in the section case stock list', {
        stockCode: anchor.code,
        line: anchor.line,
      })
    }
  }
}

async function validateBlock(block: DslBlock, ctx: DslValidateCtx, sink: DslErrorSink): Promise<void> {
  const directive = block.directive as DslDirectiveName
  checkAttrs(directive, block.attrs, block.line, sink.bad)
  parseBody(directive, block.bodyLines, sink.bad)

  if (directive === 'figure') {
    const figureId = block.attrs.figureId ?? ''
    if (!ctx.sectionFigureIds.has(figureId)) {
      sink.coded('figure_ref_unknown', 'figure is not in this section', { figureId, line: block.line })
    }
  }
  if (directive === 'clip') {
    const from = Number(block.attrs.from)
    const to = Number(block.attrs.to)
    const assetId = block.attrs.assetId ?? ''
    if (from >= to || to - from > CLIP_WINDOW_MAX_SEC) {
      sink.coded('clip_not_grounded', 'clip window must satisfy 0 ≤ from < to and span ≤ 60s', {
        line: block.line,
        from,
        to,
      })
    }
    const grounded = await ctx.clipGrounded(assetId, from * 1000, to * 1000)
    if (!grounded) {
      sink.coded('clip_not_grounded', 'clip window must fall inside one source unit', {
        line: block.line,
        assetId,
        from,
        to,
      })
    }
  }
  const unitId = block.attrs.unitId
  if (unitId !== undefined && !ctx.units.has(unitId)) {
    sink.coded('unit_ref_unknown', 'source unit not found', { unitId, line: block.line })
  }
}
