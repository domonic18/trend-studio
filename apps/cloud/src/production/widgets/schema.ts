/** 课件 spec schema v1（架构 §6.5.5 冻结）：逐类型校验字段/长度/枚举与必带断言，未列字段一律拒绝。 */

import { badRequest } from '../../errors.js'
import { isFormulaId } from './formulas.js'
import { isGeneratorId, type GeneratorId } from './generators.js'

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

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value)
}

export const WIDGET_SPEC_VERSION = 2

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
  /** M10 v2 bar-replay-decision：真实案例股逐根回放。 */
  code?: string
  window?: { from: string; to: string }
  overlays?: string[]
  decisions?: {
    atDate: string
    question: string
    options: { label: string }[]
    correct: number
    revealText: string
    unitId: string
    atMs: number
  }[]
  citations?: string[]
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

const REQUIRED_ASSERTIONS: Record<WidgetType, readonly string[]> = {
  'kline-annotator': ['trendlineTouches', 'slopeRange', 'noBreakBelow'],
  'pattern-quiz': ['answerUnique', 'distractorsDistinct'],
  'step-reveal': ['markersInRange', 'conclusionsNonEmpty'],
  'calc-trainer': ['examplesRecomputable', 'paramsInBounds'],
  'mcq-quiz': ['answerUnique', 'termsInConcepts'],
  flashcards: ['termsInConcepts', 'cardCount'],
  checklist: ['itemsNonEmpty'],
  'timeline-explorer': ['edgeRefsExist', 'acyclicPrerequisite'],
  'bar-replay-decision': ['decisionPointsGrounded', 'revealMonotonic', 'annotationTermsGrounded', 'answerUnique'],
}

const ALLOWED_ASSERTIONS: Record<WidgetType, readonly string[]> = {
  'kline-annotator': REQUIRED_ASSERTIONS['kline-annotator'],
  'pattern-quiz': [...REQUIRED_ASSERTIONS['pattern-quiz'], 'patternMatchesAnswer'],
  'step-reveal': REQUIRED_ASSERTIONS['step-reveal'],
  'calc-trainer': REQUIRED_ASSERTIONS['calc-trainer'],
  'mcq-quiz': REQUIRED_ASSERTIONS['mcq-quiz'],
  flashcards: REQUIRED_ASSERTIONS.flashcards,
  checklist: [...REQUIRED_ASSERTIONS.checklist, 'termsInConcepts'],
  'timeline-explorer': REQUIRED_ASSERTIONS['timeline-explorer'],
  'bar-replay-decision': REQUIRED_ASSERTIONS['bar-replay-decision'],
}

type Raw = Record<string, unknown>

function field(value: Raw, key: string): unknown {
  if (!(key in value)) throw badRequest(`spec.${key} is required`)
  return value[key]
}

function textField(value: Raw, key: string, min = 1, max = 2000): string {
  const raw = field(value, key)
  if (typeof raw !== 'string' || raw.trim().length < min || raw.trim().length > max) {
    throw badRequest(`spec.${key} must be ${min}–${max} characters`)
  }
  return raw
}

function intNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${label} must be an integer between ${min} and ${max}`)
  }
  return value
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${label} must be a finite number`)
  return value
}

function objectValue(value: unknown, label: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`)
  }
  return value as Raw
}

function arrayValue(value: Raw, key: string, min: number, max: number, label = `spec.${key}`): unknown[] {
  const raw = field(value, key)
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    throw badRequest(`${label} must be an array of ${min}–${max} items`)
  }
  return raw
}

function rejectUnknown(value: Raw, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw badRequest(`${label}.${key} is not allowed`)
  }
}

function chartData(value: Raw, label = 'spec.data'): WidgetChartData {
  const data = objectValue(field(value, 'data'), label)
  rejectUnknown(data, ['generator', 'seed', 'bars'], label)
  const generator = field(data, 'generator')
  if (typeof generator !== 'string' || !isGeneratorId(generator)) {
    throw badRequest(`${label}.generator must be one of the frozen generators`)
  }
  return {
    generator,
    seed: intNumber(field(data, 'seed'), `${label}.seed`, 0, 2 ** 31 - 1),
    bars: intNumber(field(data, 'bars'), `${label}.bars`, 20, 120),
  }
}

function optionalChartData(spec: Raw): WidgetChartData | undefined {
  return spec.data === undefined ? undefined : chartData(spec)
}

function trendlineSolution(value: Raw, bars: number): TrendlineSolution {
  const solution = objectValue(field(value, 'solution'), 'spec.solution')
  rejectUnknown(solution, ['trendline'], 'spec.solution')
  const line = objectValue(field(solution, 'trendline'), 'spec.solution.trendline')
  rejectUnknown(line, ['startIdx', 'endIdx'], 'spec.solution.trendline')
  const startIdx = intNumber(field(line, 'startIdx'), 'spec.solution.trendline.startIdx', 0, bars - 2)
  const endIdx = intNumber(field(line, 'endIdx'), 'spec.solution.trendline.endIdx', startIdx + 1, bars - 1)
  return { trendline: { startIdx, endIdx } }
}

function optionList(value: Raw, min: number, max: number, withCharts: boolean): { id: string; label: string; generator?: GeneratorId; seed?: number; bars?: number }[] {
  return arrayValue(value, 'options', min, max).map((raw, index) => {
    const option = objectValue(raw, `spec.options[${index}]`)
    const allowed = withCharts ? ['id', 'label', 'generator', 'seed', 'bars'] : ['id', 'label']
    rejectUnknown(option, allowed, `spec.options[${index}]`)
    const id = textField(option, 'id', 1, 40)
    const label2 = textField(option, 'label', 1, 200)
    if (withCharts && option.generator !== undefined) {
      if (typeof option.generator !== 'string' || !isGeneratorId(option.generator)) {
        throw badRequest(`spec.options[${index}].generator must be a frozen generator`)
      }
      return {
        id,
        label: label2,
        generator: option.generator,
        seed: intNumber(option.seed, `spec.options[${index}].seed`, 0, 2 ** 31 - 1),
        bars: intNumber(option.bars ?? 60, `spec.options[${index}].bars`, 20, 120),
      }
    }
    return { id, label: label2 }
  })
}

function uniqueIds(options: { id: string }[]): void {
  const ids = new Set(options.map(option => option.id))
  if (ids.size !== options.length) throw badRequest('spec.options ids must be unique')
}

function answerField(value: Raw, options: { id: string }[]): string {
  const answerId = textField(value, 'answerId', 1, 40)
  if (!options.some(option => option.id === answerId)) {
    throw badRequest('spec.answerId must reference an option id')
  }
  return answerId
}

function conceptName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
    throw badRequest(`${label} must be 1–200 characters`)
  }
  return value.trim()
}

const SOURCE_UNIT_ID = /^su_[0-9a-f]{16}$/
function sourceUnitId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SOURCE_UNIT_ID.test(value)) {
    throw badRequest(`${label} must be a source unit id`)
  }
  return value
}

const DATE_STR = /^\d{4}-\d{2}-\d{2}$/
function dateField(value: Raw, key: string): string {
  const raw = field(value, key)
  if (typeof raw !== 'string' || !DATE_STR.test(raw)) {
    throw badRequest(`spec.${key} must be YYYY-MM-DD`)
  }
  return raw
}

const ANNOTATION_KINDS = ['structure', 'invalidation', 'rhythm'] as const
function annotationKind(value: unknown, label: string): typeof ANNOTATION_KINDS[number] {
  if (typeof value !== 'string' || !(ANNOTATION_KINDS as readonly string[]).includes(value)) {
    throw badRequest(`${label} must be structure, invalidation, or rhythm`)
  }
  return value as typeof ANNOTATION_KINDS[number]
}

/** 均线位白名单：讲师口径常用 M5/M10/M20/M30/M60，最多同时展示 3 条。 */
const OVERLAY_PERIODS = ['M5', 'M10', 'M20', 'M30', 'M60'] as const

function stringRecord(value: unknown, label: string, maxEntries: number): Record<string, string> {
  const record = objectValue(value, label)
  const keys = Object.keys(record)
  if (keys.length > maxEntries) throw badRequest(`${label} must have at most ${maxEntries} entries`)
  const result: Record<string, string> = {}
  for (const key of keys) {
    const entry = record[key]
    if (typeof entry !== 'string' || entry.length > 200) throw badRequest(`${label}.${key} must be a string ≤200`)
    result[key] = entry
  }
  return result
}

function numberInputs(value: unknown, label: string): Record<string, number> {
  const record = objectValue(value, label)
  const result: Record<string, number> = {}
  for (const key of Object.keys(record)) {
    result[key] = numberValue(record[key], `${label}.${key}`)
  }
  return result
}

export function validateSpec(type: WidgetType, raw: unknown): WidgetSpec {
  const spec = objectValue(raw, 'spec')
  switch (type) {
    case 'kline-annotator': {
      rejectUnknown(spec, ['data', 'task', 'solution', 'annotations'], 'spec')
      const data = chartData(spec)
      const task = textField(spec, 'task', 1, 200)
      const solution = trendlineSolution(spec, data.bars)
      const annotations = spec.annotations === undefined
        ? undefined
        : arrayValue(spec, 'annotations', 0, 20)
      return {
        type,
        data,
        task,
        solution,
        ...(annotations === undefined ? {} : { annotations }),
      }
    }
    case 'pattern-quiz': {
      rejectUnknown(spec, ['data', 'question', 'options', 'answerId'], 'spec')
      const data = chartData(spec)
      const question = textField(spec, 'question', 1, 200)
      const options = optionList(spec, 2, 4, true)
      uniqueIds(options)
      if (options.some(option => option.generator === undefined)) {
        throw badRequest('pattern-quiz options must each declare a generator+seed')
      }
      const answerId = answerField(spec, options)
      return { type, data, question, options, answerId }
    }
    case 'step-reveal': {
      rejectUnknown(spec, ['data', 'steps', 'finalConclusion'], 'spec')
      const data = chartData(spec)
      const steps = arrayValue(spec, 'steps', 2, 6).map((raw, index) => {
        const step = objectValue(raw, `spec.steps[${index}]`)
        rejectUnknown(step, ['title', 'fromIdx', 'toIdx', 'markers', 'conclusion'], `spec.steps[${index}]`)
        const fromIdx = intNumber(field(step, 'fromIdx'), `spec.steps[${index}].fromIdx`, 0, data.bars - 1)
        const toIdx = intNumber(field(step, 'toIdx'), `spec.steps[${index}].toIdx`, fromIdx + 1, data.bars)
        const markers = step.markers === undefined
          ? undefined
          : (arrayValue(step, 'markers', 1, 10, `spec.steps[${index}].markers`) as unknown[]).map((marker, mIndex) => {
            const record = objectValue(marker, `spec.steps[${index}].markers[${mIndex}]`)
            rejectUnknown(record, ['idx', 'price', 'kind'], `spec.steps[${index}].markers[${mIndex}]`)
            return {
              idx: intNumber(field(record, 'idx'), `markers[${mIndex}].idx`, fromIdx, toIdx - 1),
              price: numberValue(field(record, 'price'), `markers[${mIndex}].price`),
              kind: textField(record, 'kind', 1, 40),
            }
          })
        return {
          title: textField(step, 'title', 1, 200),
          fromIdx,
          toIdx,
          ...(markers === undefined ? {} : { markers }),
          conclusion: textField(step, 'conclusion', 1, 2000),
        }
      })
      return { type, data, steps, finalConclusion: textField(spec, 'finalConclusion', 1, 2000) }
    }
    case 'calc-trainer': {
      rejectUnknown(spec, ['formula', 'inputs', 'examples', 'tolerance'], 'spec')
      const formula = field(spec, 'formula')
      if (typeof formula !== 'string' || !isFormulaId(formula)) {
        throw badRequest('spec.formula must be a frozen formula id')
      }
      const inputs = numberInputs(field(spec, 'inputs'), 'spec.inputs')
      const examples = arrayValue(spec, 'examples', 1, 10).map((raw, index) => {
        const example = objectValue(raw, `spec.examples[${index}]`)
        rejectUnknown(example, ['inputs', 'answer'], `spec.examples[${index}]`)
        return {
          inputs: numberInputs(field(example, 'inputs'), `spec.examples[${index}].inputs`),
          answer: numberValue(field(example, 'answer'), `spec.examples[${index}].answer`),
        }
      })
      const tolerance = spec.tolerance === undefined
        ? undefined
        : numberValue(spec.tolerance, 'spec.tolerance')
      return {
        type,
        formula,
        inputs,
        examples,
        ...(tolerance === undefined ? {} : { tolerance }),
      }
    }
    case 'mcq-quiz': {
      rejectUnknown(spec, ['question', 'options', 'answerId', 'conceptRefs'], 'spec')
      const question = textField(spec, 'question', 1, 2000)
      const options = optionList(spec, 2, 4, false)
      uniqueIds(options)
      const answerId = answerField(spec, options)
      const conceptRefs = arrayValue(spec, 'conceptRefs', 1, 10).map((ref, index) => conceptName(ref, `spec.conceptRefs[${index}]`))
      return { type, question, options, answerId, conceptRefs }
    }
    case 'flashcards': {
      rejectUnknown(spec, ['cards'], 'spec')
      const cards = arrayValue(spec, 'cards', 3, 20).map((raw, index) => {
        const card = objectValue(raw, `spec.cards[${index}]`)
        rejectUnknown(card, ['front', 'back', 'conceptRef'], `spec.cards[${index}]`)
        return {
          front: textField(card, 'front', 1, 2000),
          back: textField(card, 'back', 1, 2000),
          conceptRef: conceptName(field(card, 'conceptRef'), `spec.cards[${index}].conceptRef`),
        }
      })
      return { type, cards }
    }
    case 'checklist': {
      rejectUnknown(spec, ['title', 'items'], 'spec')
      const title = textField(spec, 'title', 1, 200)
      const items = arrayValue(spec, 'items', 3, 10).map((raw, index) => {
        const item = objectValue(raw, `spec.items[${index}]`)
        rejectUnknown(item, ['text', 'conceptRef'], `spec.items[${index}]`)
        const conceptRef = item.conceptRef === undefined
          ? undefined
          : conceptName(item.conceptRef, `spec.items[${index}].conceptRef`)
        return {
          text: textField(item, 'text', 1, 200),
          ...(conceptRef === undefined ? {} : { conceptRef }),
        }
      })
      return { type, title, items }
    }
    case 'timeline-explorer': {
      rejectUnknown(spec, ['nodes', 'edges'], 'spec')
      const nodes = arrayValue(spec, 'nodes', 2, 30).map((raw, index) => {
        const node = objectValue(raw, `spec.nodes[${index}]`)
        rejectUnknown(node, ['conceptRef'], `spec.nodes[${index}]`)
        return { conceptRef: conceptName(field(node, 'conceptRef'), `spec.nodes[${index}].conceptRef`) }
      })
      const edges = arrayValue(spec, 'edges', 1, 60).map((raw, index) => {
        const edge = objectValue(raw, `spec.edges[${index}]`)
        rejectUnknown(edge, ['from', 'to', 'kind'], `spec.edges[${index}]`)
        const from = conceptName(field(edge, 'from'), `spec.edges[${index}].from`)
        const to = conceptName(field(edge, 'to'), `spec.edges[${index}].to`)
        const kind = field(edge, 'kind')
        if (kind !== 'prerequisite' && kind !== 'related') {
          throw badRequest(`spec.edges[${index}].kind must be prerequisite or related`)
        }
        return { from, to, kind }
      })
      return { type, nodes, edges }
    }
    case 'bar-replay-decision': {
      rejectUnknown(spec, ['code', 'window', 'period', 'overlays', 'annotations', 'decisions', 'citations'], 'spec')
      const code = textField(spec, 'code', 1, 20)
      if (!/^s[hz]\d{6}$|^bj\d{6}$/.test(code)) throw badRequest('spec.code must be sz|sh|bj + 6 digits')
      const window = objectValue(field(spec, 'window'), 'spec.window')
      rejectUnknown(window, ['from', 'to'], 'spec.window')
      const windowFrom = dateField(window, 'from')
      const windowTo = dateField(window, 'to')
      if (windowFrom > windowTo) throw badRequest('spec.window.from must be before or equal to window.to')
      const period = spec.period === undefined ? undefined : field(spec, 'period')
      if (period !== undefined && period !== '1d' && period !== '1w') {
        throw badRequest('spec.period must be 1d or 1w')
      }
      const overlays = spec.overlays === undefined
        ? undefined
        : arrayValue(spec, 'overlays', 0, 3).map((entry, index) => {
            if (typeof entry !== 'string' || !(OVERLAY_PERIODS as readonly string[]).includes(entry)) {
              throw badRequest(`spec.overlays[${index}] must be one of ${OVERLAY_PERIODS.join('/')}`)
            }
            return entry
          })
      const annotations = spec.annotations === undefined
        ? undefined
        : arrayValue(spec, 'annotations', 0, 12).map((raw, index) => {
            const annotation = objectValue(raw, `spec.annotations[${index}]`)
            rejectUnknown(annotation, ['unitId', 'atMs', 'kind', 'd', 'label'], `spec.annotations[${index}]`)
            return {
              unitId: sourceUnitId(field(annotation, 'unitId'), `spec.annotations[${index}].unitId`),
              atMs: intNumber(field(annotation, 'atMs'), `spec.annotations[${index}].atMs`, 0, 86_400_000),
              kind: annotationKind(field(annotation, 'kind'), `spec.annotations[${index}].kind`),
              d: dateField(annotation, 'd'),
              label: textField(annotation, 'label', 1, 50),
            }
          })
      const decisions = arrayValue(spec, 'decisions', 1, 8).map((raw, index) => {
        const decision = objectValue(raw, `spec.decisions[${index}]`)
        rejectUnknown(decision, ['atDate', 'question', 'options', 'correct', 'revealText', 'unitId', 'atMs'], `spec.decisions[${index}]`)
        const options = arrayValue(decision, 'options', 2, 4, `spec.decisions[${index}].options`).map((optionRaw, optionIndex) => {
          const option = objectValue(optionRaw, `spec.decisions[${index}].options[${optionIndex}]`)
          rejectUnknown(option, ['label'], `spec.decisions[${index}].options[${optionIndex}]`)
          return { label: textField(option, 'label', 1, 200) }
        })
        return {
          atDate: dateField(decision, 'atDate'),
          question: textField(decision, 'question', 1, 500),
          options,
          correct: intNumber(field(decision, 'correct'), `spec.decisions[${index}].correct`, 0, options.length - 1),
          revealText: textField(decision, 'revealText', 1, 2000),
          unitId: sourceUnitId(field(decision, 'unitId'), `spec.decisions[${index}].unitId`),
          atMs: intNumber(field(decision, 'atMs'), `spec.decisions[${index}].atMs`, 0, 86_400_000),
        }
      })
      const citations = arrayValue(spec, 'citations', 1, 20).map((entry, index) =>
        sourceUnitId(entry, `spec.citations[${index}]`))
      return {
        type,
        code,
        window: { from: windowFrom, to: windowTo },
        ...(period === undefined ? {} : { period }),
        ...(overlays === undefined ? {} : { overlays }),
        ...(annotations === undefined ? {} : { annotations }),
        decisions,
        citations,
      }
    }
  }
}

export function validateAssertions(type: WidgetType, raw: unknown): WidgetAssertions {
  const assertions = objectValue(raw, 'assertions')
  const allowed = ALLOWED_ASSERTIONS[type]
  for (const key of Object.keys(assertions)) {
    if (!allowed.includes(key)) throw badRequest(`assertions.${key} is not allowed for ${type}`)
  }
  for (const required of REQUIRED_ASSERTIONS[type]) {
    if (!(required in assertions)) throw badRequest(`assertions.${required} is required for ${type}`)
  }
  const result = assertions as WidgetAssertions
  if (result.trendlineTouches !== undefined) {
    const min = objectValue(result.trendlineTouches as unknown, 'assertions.trendlineTouches').min
    intNumber(min, 'assertions.trendlineTouches.min', 1, 120)
  }
  if (result.slopeRange !== undefined) {
    const range = result.slopeRange
    if (!Array.isArray(range) || range.length !== 2 || range.some(entry => typeof entry !== 'number' || !Number.isFinite(entry))) {
      throw badRequest('assertions.slopeRange must be [min, max]')
    }
    if (range[0] >= range[1] || range[0] < -90 || range[1] > 90) {
      throw badRequest('assertions.slopeRange must be within -90..90 and ascending')
    }
  }
  if (result.cardCount !== undefined) {
    const count = objectValue(result.cardCount as unknown, 'assertions.cardCount')
    const min = intNumber(count.min, 'assertions.cardCount.min', 1, 20)
    intNumber(count.max, 'assertions.cardCount.max', min, 20)
  }
  return result
}

/** 生成器/公式白名单外与断言参数非法都属 schema 失败（400），与证明失败（409）分离。 */
export function validateCitations(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    throw badRequest('citations must be an array of 1–20 source unit ids')
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || !/^su_[0-9a-f]{16}$/.test(entry)) {
      throw badRequest(`citations[${index}] must be a source unit id`)
    }
    return entry
  })
}

export { stringRecord }
