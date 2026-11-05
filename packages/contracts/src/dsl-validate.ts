/** DSL 语义校验（第 2 层，随 PUT article 复检）：引用存在性、片段窗 grounded、锚格式。 */

import type { DslBlock, DslParseResult } from './dsl-parse.js'
import type { DslErrorSink } from './errors-sink.js'
import { checkAttrs, parseBody } from './dsl.js'
import { SOURCE_UNIT_ID, STOCK_CODE } from './ids.js'
import type { DslDirectiveName } from './enums.js'
import { splitStockAnchorCode } from './stock-codes.js'

export interface DslUnitRef {
  assetId: string
  startMs: number
  endMs: number
}

/** 案例股窗口（:::annotation 的 d 必须落在窗口内）。 */
export interface CaseStockWindow {
  start: string
  end: string
}

export interface DslValidateCtx {
  sectionFigureIds: Set<string>
  units: Map<string, DslUnitRef>
  /** [[unit:]] 锚的 unitId 必须落在本课程（经 media_assets.course_id 关联的全部 source units）。 */
  courseUnitIds: ReadonlySet<string>
  /** clip 时间窗是否完整落在该 assetId 某 source unit 的 [startMs, endMs] 内（宿主懒查）。 */
  clipGrounded: (assetId: string, fromMs: number, toMs: number) => Promise<boolean>
  /** 个股锚是否在本节案例股清单内（宿主懒查；清单以 exchange + 6 位数字形态比对）。 */
  stockInSection: (exchange: string, code: string) => Promise<boolean>
  /** v2：素材是否存在（:::annotation 的 assetId）。 */
  assetExists?: (assetId: string) => Promise<boolean>
  /** v2：案例股窗口（:::annotation 的 code 对应的本节案例股；不在清单返回 null）。 */
  caseStockWindow?: (exchange: string, code: string) => Promise<CaseStockWindow | null>
  /** v2：该股行情缓存中的实际交易日（:::annotation 的 d 必须是其中一天）。 */
  isTradingDay?: (exchange: string, code: string, date: string) => Promise<boolean>
  /** v2：课程 concepts 名称与别名并集（:::annotation 术语校验基准）。 */
  conceptNames?: ReadonlySet<string>
  /** v2：本节该 code 的 bar-replay-decision 课件数量（:::replay 唯一性解析）。 */
  replayWidgetCount?: (code: string) => Promise<number>
}

export const CLIP_MAX_PER_SECTION = 3
export const CLIP_WINDOW_MAX_SEC = 60
export const UNIT_ANCHOR_LABEL_MAX = 50
export const ANNOTATION_MAX_PER_SECTION = 12
export const REPLAY_MAX_PER_SECTION = 2

export async function validateArticleDsl(parsed: DslParseResult, ctx: DslValidateCtx, sink: DslErrorSink): Promise<void> {
  const clipBlocks = parsed.blocks.filter(block => block.directive === 'clip')
  if (clipBlocks.length > CLIP_MAX_PER_SECTION) {
    sink.coded('clip_not_grounded', 'article contains more than 3 clip blocks', {
      found: clipBlocks.length,
    })
  }
  const annotationBlocks = parsed.blocks.filter(block => block.directive === 'annotation')
  if (annotationBlocks.length > ANNOTATION_MAX_PER_SECTION) {
    sink.conflict('annotation_quota_exceeded', `article contains more than ${ANNOTATION_MAX_PER_SECTION} annotation blocks`, {
      found: annotationBlocks.length,
    })
  }
  const replayBlocks = parsed.blocks.filter(block => block.directive === 'replay')
  if (replayBlocks.length > REPLAY_MAX_PER_SECTION) {
    sink.conflict('replay_quota_exceeded', `article contains more than ${REPLAY_MAX_PER_SECTION} replay blocks`, {
      found: replayBlocks.length,
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
  for (const anchor of parsed.unitAnchors) {
    if (!SOURCE_UNIT_ID.test(anchor.unitId)) {
      sink.bad(`dsl: unit anchor id '${anchor.unitId}' invalid (line ${anchor.line})`)
      continue
    }
    if ([...anchor.label].length > UNIT_ANCHOR_LABEL_MAX) {
      sink.bad(`dsl: unit anchor label must be at most ${UNIT_ANCHOR_LABEL_MAX} characters (line ${anchor.line})`)
    }
    if (!ctx.courseUnitIds.has(anchor.unitId)) {
      sink.coded('unit_anchor_unknown', 'unit anchor is not in this course', {
        unitId: anchor.unitId,
        line: anchor.line,
      })
    }
  }
}

async function validateBlock(block: DslBlock, ctx: DslValidateCtx, sink: DslErrorSink): Promise<void> {
  const directive = block.directive as DslDirectiveName
  checkAttrs(directive, block.attrs, block.line, sink.bad)
  const body = parseBody(directive, block.bodyLines, sink.bad)

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
  if (directive === 'annotation') {
    await validateAnnotation(block, body, ctx, sink)
    return
  }
  if (directive === 'replay') {
    await validateReplay(block, ctx, sink)
    return
  }
  const unitId = block.attrs.unitId
  if (unitId !== undefined && !ctx.units.has(unitId)) {
    sink.coded('unit_ref_unknown', 'source unit not found', { unitId, line: block.line })
  }
}

/** :::annotation：老师标注详情卡（架构 §6.6.1 v2）。 */
async function validateAnnotation(
  block: DslBlock,
  body: unknown,
  ctx: DslValidateCtx,
  sink: DslErrorSink,
): Promise<void> {
  const assetExists = ctx.assetExists
  const caseStockWindow = ctx.caseStockWindow
  const isTradingDay = ctx.isTradingDay
  const conceptNames = ctx.conceptNames
  if (assetExists === undefined || caseStockWindow === undefined || isTradingDay === undefined || conceptNames === undefined) {
    sink.bad(`dsl: host does not support :::annotation validation (line ${block.line})`)
  }
  const unitId = block.attrs.unitId ?? ''
  const assetId = block.attrs.assetId ?? ''
  const code = block.attrs.code ?? ''
  const atMs = Number(block.attrs.atMs)
  const unit = ctx.units.get(unitId)
  if (unit === undefined) {
    sink.coded('annotation_not_grounded', 'annotation source unit not found', { unitId, line: block.line })
  }
  if (!(await assetExists(assetId))) {
    sink.coded('annotation_not_grounded', 'annotation asset not found', { assetId, line: block.line })
  }
  if (unit.assetId !== assetId) {
    sink.coded('annotation_not_grounded', 'annotation asset does not match the source unit asset', {
      unitId,
      assetId,
      unitAssetId: unit.assetId,
      line: block.line,
    })
  }
  if (!Number.isInteger(atMs) || atMs < unit.startMs || atMs > unit.endMs) {
    sink.coded('annotation_not_grounded', 'annotation atMs must fall inside the source unit window', {
      unitId,
      atMs,
      startMs: unit.startMs,
      endMs: unit.endMs,
      line: block.line,
    })
  }
  const parts = splitStockAnchorCode(code)
  if (parts === null) sink.bad(`dsl: annotation code '${code}' invalid (line ${block.line})`)
  if (!(await ctx.stockInSection(parts.exchange, parts.code))) {
    sink.coded('stock_not_in_list', 'annotation stock is not in the section case stock list', {
      stockCode: code,
      line: block.line,
    })
  }
  const window = await caseStockWindow(parts.exchange, parts.code)
  if (window === null) {
    sink.coded('stock_not_in_list', 'annotation stock is not in the section case stock list', {
      stockCode: code,
      line: block.line,
    })
  }
  const annotation = body as { d?: string; glossary?: string[] }
  const d = annotation.d ?? ''
  if (d < window.start || d > window.end) {
    sink.coded('annotation_date_out_of_window', 'annotation date must fall inside the case stock window', {
      stockCode: code,
      d,
      windowStart: window.start,
      windowEnd: window.end,
      line: block.line,
    })
  }
  if (!(await isTradingDay(parts.exchange, parts.code, d))) {
    sink.coded('annotation_date_not_trading_day', 'annotation date is not a trading day in the quote cache; sync quotes before writing the article', {
      stockCode: code,
      d,
      line: block.line,
    })
  }
  for (const term of annotation.glossary ?? []) {
    if (!conceptNames.has(term)) {
      sink.coded('annotation_term_unknown', 'annotation glossary term is not a course concept', {
        term,
        line: block.line,
      })
    }
  }
}

/** :::replay：正文内嵌逐根回放入口（架构 §6.6.1 v2）。 */
async function validateReplay(block: DslBlock, ctx: DslValidateCtx, sink: DslErrorSink): Promise<void> {
  const replayWidgetCount = ctx.replayWidgetCount
  if (replayWidgetCount === undefined) {
    sink.bad(`dsl: host does not support :::replay validation (line ${block.line})`)
  }
  const code = block.attrs.code ?? ''
  const parts = splitStockAnchorCode(code)
  if (parts === null) sink.bad(`dsl: replay code '${code}' invalid (line ${block.line})`)
  const count = await replayWidgetCount(code)
  if (count === 0) {
    sink.coded('replay_widget_unknown', 'no bar-replay-decision widget matches this replay code', {
      stockCode: code,
      line: block.line,
    })
  }
  if (count > 1) {
    sink.coded('replay_widget_ambiguous', 'more than one bar-replay-decision widget matches this replay code', {
      stockCode: code,
      found: count,
      line: block.line,
    })
  }
}
