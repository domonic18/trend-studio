/** 课件渲染引擎：忠实移植云端确定性逻辑（generators/provers/formulas），使管理台预览可玩且与云端评分同源。 */

import type {
  BarReplaySpec,
  FormulaId,
  GeneratorId,
  TrendlineSolution,
  WidgetAssertions,
  WidgetSpec,
  WidgetType,
} from './spec-types.js'

export interface Candle {
  open: number
  high: number
  low: number
  close: number
}

const BASE_PRICE = 100
const TREND_TOTAL = 0.25
const PLATEAU_BOUNDARY = 0.6
const RANGE_WAVE = 0.025

/** mulberry32：种子化 PRNG，跨进程可复现。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + (Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateCandles(generator: GeneratorId, seed: number, bars: number): Candle[] {
  const random = mulberry32(seed)
  const phase = random() * Math.PI * 2
  const trendDrift = Math.pow(1 + TREND_TOTAL, 1 / bars) - 1
  const boundary = Math.floor(bars * PLATEAU_BOUNDARY)
  const direction = generator === 'downtrend' || generator === 'downtrend-platform' ? -1 : 1
  const candles: Candle[] = []
  let close = BASE_PRICE
  let plateau = BASE_PRICE
  for (let index = 0; index < bars; index += 1) {
    const noise = (random() - 0.5) * 0.016
    let open: number
    if (generator === 'range') {
      const wave = Math.sin(phase + index / 4.5) * RANGE_WAVE
      open = BASE_PRICE * (1 + wave + noise * 0.5)
      close = open * (1 + noise * 0.4)
    } else {
      const trending = generator === 'uptrend' || generator === 'downtrend' || index < boundary
      let drift: number
      if (trending) {
        drift = direction * trendDrift
      } else {
        if (index === boundary) plateau = close
        close = plateau
        drift = 0
      }
      open = close
      close = open * (1 + drift + noise)
    }
    const spread = random() * 0.004 + 0.001
    const high = Math.max(open, close) * (1 + spread)
    const low = Math.min(open, close) * (1 - spread)
    candles.push({ open, high, low, close })
  }
  return candles
}

export function atr(candles: Candle[]): number {
  let sum = 0
  let previousClose = candles[0]?.close ?? 0
  for (const bar of candles) {
    sum += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    )
    previousClose = bar.close
  }
  return candles.length === 0 ? 0 : sum / candles.length
}

export interface Trendline {
  startIdx: number
  endIdx: number
}

export function trendlineAt(candles: Candle[], line: Trendline): {
  priceAt(index: number): number
  angleDeg: number
} {
  const lowStart = candles[line.startIdx]?.low
  const lowEnd = candles[line.endIdx]?.low
  if (lowStart === undefined || lowEnd === undefined) {
    throw new Error('trendline anchors out of range')
  }
  const slope = (lowEnd - lowStart) / (line.endIdx - line.startIdx)
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  for (const bar of candles) {
    high = Math.max(high, bar.high)
    low = Math.min(low, bar.low)
  }
  const priceRange = high - low
  const normalizedSlope = priceRange > 0
    ? (slope * candles.length) / priceRange
    : 0
  return {
    priceAt: (index: number) => lowStart + slope * (index - line.startIdx),
    angleDeg: (Math.atan(normalizedSlope) * 180) / Math.PI,
  }
}

export function countTrendlineTouches(candles: Candle[], line: Trendline, toleranceAtr = 0.5): number {
  const { priceAt } = trendlineAt(candles, line)
  const tolerance = atr(candles) * toleranceAtr
  let touches = 0
  for (let index = line.startIdx; index <= line.endIdx; index += 1) {
    const bar = candles[index]
    if (bar === undefined) continue
    const price = priceAt(index)
    if (price >= bar.low - tolerance && price <= bar.high + tolerance) {
      touches += 1
    }
  }
  return touches
}

export function closesHoldAbove(candles: Candle[], line: Trendline, epsilon = 1e-6): boolean {
  const { priceAt } = trendlineAt(candles, line)
  return candles.every((bar, index) => bar.close >= priceAt(index) - epsilon)
}

export function classifyShape(candles: Candle[]): GeneratorId {
  const bars = candles.length
  const first = candles[0]?.close
  const tailAnchor = candles[Math.floor(bars * 0.65)]?.close
  const last = candles[bars - 1]?.close
  if (bars < 2 || first === undefined || tailAnchor === undefined || last === undefined) return 'range'
  const driftTotal = (last - first) / first
  const driftTail = (last - tailAnchor) / tailAnchor
  const trend = driftTotal >= 0.06 ? 'uptrend' : driftTotal <= -0.06 ? 'downtrend' : 'range'
  if (trend === 'range') return 'range'
  const platform = Math.abs(driftTail) <= 0.02
  if (trend === 'uptrend') return platform ? 'uptrend-platform' : 'uptrend'
  return platform ? 'downtrend-platform' : 'downtrend'
}

const FORMULAS = ['position-size', 'risk-reward', 'drawdown-recovery'] as const

export function isFormulaId(value: string): value is FormulaId {
  return (FORMULAS as readonly string[]).includes(value)
}

type Bounds = Record<string, { min: number; max: number; exclusiveMin?: boolean }>

const BOUNDS: Record<FormulaId, Bounds> = {
  'position-size': {
    capital: { min: 0, max: 1e12, exclusiveMin: true },
    price: { min: 0, max: 1e6, exclusiveMin: true },
    riskPct: { min: 0, max: 100, exclusiveMin: true },
    stopDistancePct: { min: 0, max: 100, exclusiveMin: true },
  },
  'risk-reward': {
    entry: { min: 0, max: 1e6, exclusiveMin: true },
    stop: { min: 0, max: 1e6, exclusiveMin: true },
    target: { min: 0, max: 1e6, exclusiveMin: true },
  },
  'drawdown-recovery': {
    drawdownPct: { min: 0, max: 100, exclusiveMin: true },
  },
}

function inBounds(formula: FormulaId, inputs: Record<string, number>): boolean {
  const bounds = BOUNDS[formula]
  const keys = Object.keys(bounds)
  if (Object.keys(inputs).length !== keys.length) return false
  return keys.every(key => {
    const bound = bounds[key]
    const value = inputs[key]
    if (bound === undefined) return false
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    if (bound.exclusiveMin === true) return value > bound.min && value <= bound.max
    return value >= bound.min && value <= bound.max
  })
}

function requiredInput(inputs: Record<string, number>, key: string): number | undefined {
  const value = inputs[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function computeFormula(formula: FormulaId, inputs: Record<string, number>): number | undefined {
  if (!inBounds(formula, inputs)) return undefined
  switch (formula) {
    case 'position-size': {
      const capital = requiredInput(inputs, 'capital')
      const price = requiredInput(inputs, 'price')
      const riskPct = requiredInput(inputs, 'riskPct')
      const stopDistancePct = requiredInput(inputs, 'stopDistancePct')
      if (capital === undefined || price === undefined || riskPct === undefined || stopDistancePct === undefined) {
        return undefined
      }
      const riskAmount = (capital * riskPct) / 100
      const perUnitRisk = (price * stopDistancePct) / 100
      return riskAmount / perUnitRisk
    }
    case 'risk-reward': {
      const entry = requiredInput(inputs, 'entry')
      const stop = requiredInput(inputs, 'stop')
      const target = requiredInput(inputs, 'target')
      if (entry === undefined || stop === undefined || target === undefined) return undefined
      if (entry <= stop) return undefined
      return (target - entry) / (entry - stop)
    }
    case 'drawdown-recovery': {
      const drawdownPct = requiredInput(inputs, 'drawdownPct')
      if (drawdownPct === undefined) return undefined
      return (drawdownPct / (100 - drawdownPct)) * 100
    }
  }
}

export function formulaInputsInBounds(formula: FormulaId, inputs: Record<string, number>): boolean {
  return inBounds(formula, inputs)
}

/** 管理台预览评分：对云端断言做同源复算，返回每条断言 pass/fail（概念类断言因无课程概念集，仅复用数据类证明）。 */
export interface PreviewProof {
  validation: Record<string, 'pass' | 'fail' | 'n/a'>
  failed: string[]
}

export function previewProve(
  type: WidgetType,
  spec: WidgetSpec,
  assertions: WidgetAssertions,
): PreviewProof {
  const validation: Record<string, 'pass' | 'fail' | 'n/a'> = {}
  const failed: string[] = []
  const entries = Object.entries(assertions) as [keyof WidgetAssertions, unknown][]
  const conceptNames = new Set<string>()
  for (const [key, params] of entries) {
    if (params === undefined) continue
    const result = proofFor(type, spec, key, assertions, conceptNames)
    if (result === 'n/a') {
      validation[key] = 'n/a'
    } else if (result) {
      validation[key] = 'pass'
    } else {
      validation[key] = 'fail'
      failed.push(key)
    }
  }
  return { validation, failed }
}

function optionCandles(spec: WidgetSpec, index: number): Candle[] {
  const base = spec.data!
  const option = spec.options![index]
  if (option === undefined) return generateCandles(base.generator, base.seed, base.bars)
  return generateCandles(option.generator ?? base.generator, option.seed ?? base.seed, option.bars ?? base.bars)
}

function proofFor(
  type: WidgetType,
  spec: WidgetSpec,
  key: keyof WidgetAssertions,
  assertions: WidgetAssertions,
  conceptNames: ReadonlySet<string>,
): boolean | 'n/a' {
  switch (key) {
    case 'trendlineTouches': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      const touches = countTrendlineTouches(candles, (spec.solution as TrendlineSolution).trendline)
      return touches >= assertions.trendlineTouches!.min
    }
    case 'slopeRange': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      const { angleDeg } = trendlineAt(candles, (spec.solution as TrendlineSolution).trendline)
      const [min, max] = assertions.slopeRange!
      return angleDeg >= min && angleDeg <= max
    }
    case 'noBreakBelow': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      return closesHoldAbove(candles, (spec.solution as TrendlineSolution).trendline)
    }
    case 'answerUnique': {
      // bar-replay-decision 没有 options/answerId：正确项由 decisions[].correct 唯一指定，
      // 断言口径是「每道题有且只有一个正确答案」——correct 必须落在该题选项区间内。
      if (type === 'bar-replay-decision') {
        const decisions = (spec as unknown as Partial<BarReplaySpec>).decisions ?? []
        return decisions.length > 0 && decisions.every(decision =>
          Number.isInteger(decision.correct)
          && decision.correct >= 0
          && decision.correct < decision.options.length)
      }
      const options = spec.options
      if (options === undefined) return false
      return options.some(option => option.id === spec.answerId)
        && new Set(options.map(option => option.id)).size === options.length
    }
    case 'distractorsDistinct': {
      const shapes = spec.options!.map((_option, index) => classifyShape(optionCandles(spec, index)))
      return new Set(shapes).size === shapes.length
    }
    case 'patternMatchesAnswer': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      return classifyShape(candles) === assertions.patternMatchesAnswer
    }
    case 'markersInRange': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      const tolerance = atr(candles) * 0.5
      let previousTo = -1
      for (const step of spec.steps!) {
        if (step.fromIdx <= previousTo) return false
        previousTo = step.toIdx
        for (const marker of step.markers ?? []) {
          const bar = candles[marker.idx]
          if (bar === undefined) return false
          if (marker.price < bar.low - tolerance || marker.price > bar.high + tolerance) return false
        }
      }
      return true
    }
    case 'conclusionsNonEmpty': {
      return spec.steps!.every(step => step.conclusion.trim().length > 0)
        && spec.finalConclusion!.trim().length > 0
    }
    case 'examplesRecomputable': {
      const formula = spec.formula!
      if (!isFormulaId(formula)) return false
      const tolerance = spec.tolerance ?? 1e-6
      return spec.examples!.every(example => {
        const recomputed = computeFormula(formula, example.inputs)
        if (recomputed === undefined) return false
        const scale = Math.max(1, Math.abs(example.answer))
        return Math.abs(recomputed - example.answer) <= tolerance * scale
      })
    }
    case 'paramsInBounds': {
      const formula = spec.formula!
      if (!isFormulaId(formula)) return false
      if (!formulaInputsInBounds(formula, spec.inputs!)) return false
      return spec.examples!.every(example => formulaInputsInBounds(formula, example.inputs))
    }
    case 'termsInConcepts':
    case 'edgeRefsExist': {
      // 概念/节点归属需课程概念集，预览态无此上下文，标记 n/a。
      return 'n/a'
    }
    case 'cardCount': {
      const { min, max } = assertions.cardCount!
      return spec.cards!.length >= min && spec.cards!.length <= max
    }
    case 'itemsNonEmpty': {
      return (spec.items ?? []).every(item => item.text.trim().length > 0)
    }
    case 'acyclicPrerequisite': {
      const prerequisite = spec.edges!.filter(edge => edge.kind === 'prerequisite')
      const adjacency = new Map<string, string[]>()
      for (const edge of prerequisite) {
        adjacency.set(edge.from, [...adjacency.get(edge.from) ?? [], edge.to])
      }
      const visiting = new Set<string>()
      const visited = new Set<string>()
      const visit = (node: string): boolean => {
        if (visiting.has(node)) return false
        if (visited.has(node)) return true
        visiting.add(node)
        for (const next of adjacency.get(node) ?? []) {
          if (!visit(next)) return false
        }
        visiting.delete(node)
        visited.add(node)
        return true
      }
      return [...adjacency.keys()].every(visit)
    }
    case 'revealMonotonic': {
      const barSpec = spec as unknown as Partial<BarReplaySpec>
      const decisions = barSpec.decisions ?? []
      const annotations = barSpec.annotations ?? []
      if (decisions.length === 0) return false
      const decisionDates = decisions.map(decision => decision.atDate).sort()
      for (let i = 1; i < decisionDates.length; i++) {
        if (decisionDates[i]! <= decisionDates[i - 1]!) return false
      }
      const annotationDates = annotations.map(annotation => annotation.d).sort()
      if (annotationDates.length < decisions.length) return false
      for (let i = 0; i < decisions.length; i++) {
        if (decisions[i]!.atDate >= annotationDates[i]!) return false
      }
      return true
    }
    case 'decisionPointsGrounded':
    case 'annotationTermsGrounded': {
      // 需要单元时间窗、案例窗口、交易日与课程概念集，预览态无此上下文（云端写入时已证明）。
      return 'n/a'
    }
    default:
      return false
  }
}
