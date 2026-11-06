/** 跨端共享的业务枚举：变更即契约变更，先改云端文档再改此处。 */

export const WIDGET_TYPES = [
  'kline-annotator',
  'pattern-quiz',
  'step-reveal',
  'calc-trainer',
  'mcq-quiz',
  'flashcards',
  'checklist',
  'timeline-explorer',
  'bar-replay-decision',
] as const

export const FIGURE_TEMPLATE_NAMES = [
  'chip-contrast',
  'chip-horizontal',
  'timeline',
  'stat-inline',
] as const

export const PROVENANCE_TASK_KEYS = [
  'vision.describe',
  'content.chunk_summary',
  'content.concept_map',
  'content.curriculum',
  'content.section_draft',
  'content.section_edit',
  'content.figure_spec',
  'content.widget_spec',
  'content.rubric_review',
] as const

export const DSL_DIRECTIVES = [
  'board', 'bignum', 'cmp', 'timeline', 'warn', 'figure', 'clip',
  'annotation', 'replay',
] as const
export type DslDirectiveName = (typeof DSL_DIRECTIVES)[number]

/** 组件版本（架构 §6.6.1 组件扩容）：v1 七块=1，v2 两块=2。正文版本取用到的组件版本最大值。 */
export const DSL_DIRECTIVE_VERSIONS: Record<DslDirectiveName, 1 | 2> = {
  board: 1,
  bignum: 1,
  cmp: 1,
  timeline: 1,
  warn: 1,
  figure: 1,
  clip: 1,
  annotation: 2,
  replay: 2,
}

/** 老师标注三类（structure=结构 / invalidation=失效 / rhythm=节奏）。 */
export const ANNOTATION_KINDS = ['structure', 'invalidation', 'rhythm'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/** 课程级 K 线叠加常量（架构 §6.6.5）：均线位，新增需同步渲染器。 */
export const COURSE_OVERLAYS = ['M5', 'M10', 'M20', 'M30', 'M60'] as const

/** K 线周期口径：课程讲日线画日线，讲周线画周线（周线由日线聚合）。 */
export const KLINE_PERIODS = ['1d', '1w'] as const
export type KlinePeriod = (typeof KLINE_PERIODS)[number]
