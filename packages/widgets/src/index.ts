/**
 * 教材渲染组件包公共出口：管理台预览与学员端共用同一套渲染器与判定逻辑。
 */

export { ArticleRenderer } from './article.js'
export { AnchorText } from './anchors.js'
export { DslBlockView } from './blocks.js'
export { ClipCard } from './clip.js'
export {
  EvidenceList,
  EvidenceProvider,
  buildEvidenceIndex,
  useEvidenceIndex,
  type EvidenceEntry,
  type EvidenceIndex,
} from './evidence.js'
export { rewriteStockAnchors, splitArticle, splitInlineAnchors, type InlineAnchor } from './dsl.js'
export { BranchingScenario } from './branching/index.js'
export { ImageJuxtaposition, type ResolveFigureUrl } from './compare/index.js'
export { LearnerWidgetPlayer, type LearnerWidget } from './learner/index.js'
export type {
  ArticleHost,
  ArticleSegment,
  FigureMeta,
  PlaybackSessionTicket,
} from './types.js'
export type {
  FormulaId,
  GeneratorId,
  WidgetAssertions,
  WidgetChartData,
  WidgetSpec,
  WidgetType,
  TrendlineSolution,
} from './spec-types.js'
export {
  atr,
  classifyShape,
  computeFormula,
  countTrendlineTouches,
  closesHoldAbove,
  formulaInputsInBounds,
  generateCandles,
  isFormulaId,
  mulberry32,
  previewProve,
  trendlineAt,
  type Candle,
  type PreviewProof,
  type Trendline,
} from './engine.js'
