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

export const DSL_DIRECTIVES = ['board', 'bignum', 'cmp', 'timeline', 'warn', 'figure', 'clip'] as const
export type DslDirectiveName = (typeof DSL_DIRECTIVES)[number]
