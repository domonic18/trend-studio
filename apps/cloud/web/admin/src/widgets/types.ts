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
}
