/**
 * 教材渲染组件包公共出口：管理台预览与学员端共用同一套渲染器与判定逻辑。
 */

export { ArticleRenderer } from './article.js'
export { DslBlockView } from './blocks.js'
export { ClipCard } from './clip.js'
export { rewriteStockAnchors, splitArticle } from './dsl.js'
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
