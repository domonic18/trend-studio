/** 课件 spec 类型（admin 侧，与云端 schema.ts v1 冻结形状一致，仅供预览渲染消费）。 */

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
export type WidgetType = (typeof WIDGET_TYPES)[number]

export const GENERATORS = [
  'uptrend',
  'downtrend',
  'range',
  'uptrend-platform',
  'downtrend-platform',
] as const
export type GeneratorId = (typeof GENERATORS)[number]

export const FORMULAS = ['position-size', 'risk-reward', 'drawdown-recovery'] as const
export type FormulaId = (typeof FORMULAS)[number]

export interface WidgetChartData {
  generator: GeneratorId
  seed: number
  bars: number
}

export interface TrendlineSolution {
  trendline: { startIdx: number; endIdx: number }
}

export interface WidgetSpec {
  type: WidgetType
  data?: WidgetChartData
  task?: string
  solution?: TrendlineSolution
  annotations?: unknown[]
  question?: string
  options?: { id: string; label: string; generator?: GeneratorId; seed?: number; bars?: number }[]
  answerId?: string
  steps?: {
    title: string
    fromIdx: number
    toIdx: number
    markers?: { idx: number; price: number; kind: string }[]
    conclusion: string
  }[]
  finalConclusion?: string
  formula?: string
  inputs?: Record<string, number>
  examples?: { inputs: Record<string, number>; answer: number }[]
  tolerance?: number
  conceptRefs?: string[]
  cards?: { front: string; back: string; conceptRef: string }[]
  title?: string
  items?: { text: string; conceptRef?: string }[]
  nodes?: { conceptRef: string }[]
  edges?: { from: string; to: string; kind: string }[]
  patternMatchesAnswer?: GeneratorId
}

export type BarReplayAnnotationKind = 'structure' | 'invalidation' | 'rhythm'

export interface BarReplayAnnotation {
  unitId: string
  atMs: number
  kind: BarReplayAnnotationKind
  d: string
  label: string
}

export interface BarReplayDecisionSpec {
  atDate: string
  question: string
  options: { label: string }[]
  correct: number
  revealText: string
  unitId: string
  atMs: number
}

export interface BarReplaySpec {
  code: string
  window: { from: string; to: string }
  /** K 线周期：课件讲日线画日线，讲周线画周线（周线由日线聚合）。缺省日线。 */
  period?: '1d' | '1w'
  overlays?: string[]
  annotations?: BarReplayAnnotation[]
  decisions: BarReplayDecisionSpec[]
  citations: string[]
}

export interface WidgetAssertions {
  trendlineTouches?: { min: number }
  slopeRange?: [number, number]
  noBreakBelow?: boolean
  answerUnique?: boolean
  distractorsDistinct?: boolean
  patternMatchesAnswer?: GeneratorId
  markersInRange?: boolean
  conclusionsNonEmpty?: boolean
  examplesRecomputable?: boolean
  paramsInBounds?: boolean
  termsInConcepts?: boolean
  cardCount?: { min: number; max: number }
  itemsNonEmpty?: boolean
  edgeRefsExist?: boolean
  acyclicPrerequisite?: boolean
  revealMonotonic?: boolean
  decisionPointsGrounded?: boolean
  annotationTermsGrounded?: boolean
}
