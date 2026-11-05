/** 断言证明器：逐条在确定性数据上验证断言，全部通过才有证明记录；失败返回断言键列表（409）。 */

import { computeFormula, formulaInputsInBounds, isFormulaId } from './formulas.js'
import {
  atr,
  classifyShape,
  closesHoldAbove,
  countTrendlineTouches,
  generateCandles,
  trendlineAt,
  type Candle,
} from './generators.js'
import type { WidgetAssertions, WidgetSpec, WidgetType } from './schema.js'

export interface ProofContext {
  /** 课程内 concepts 名称与别名的并集，mcq/flashcards/checklist/timeline 术语校验基准。 */
  conceptNames: ReadonlySet<string>
}

export type ProofResult =
  | { ok: true; validation: Record<string, 'pass'> }
  | { ok: false; failed: string[] }

function optionCandles(spec: WidgetSpec, index: number): Candle[] {
  const base = spec.data!
  const option = spec.options![index]
  if (option === undefined) return generateCandles(base.generator, base.seed, base.bars)
  return generateCandles(option.generator ?? base.generator, option.seed ?? base.seed, option.bars ?? base.bars)
}

function proofFor(type: WidgetType, spec: WidgetSpec, key: string, assertions: WidgetAssertions, ctx: ProofContext): boolean {
  switch (key) {
    case 'trendlineTouches': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      const touches = countTrendlineTouches(candles, spec.solution!.trendline)
      return touches >= assertions.trendlineTouches!.min
    }
    case 'slopeRange': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      const { angleDeg } = trendlineAt(candles, spec.solution!.trendline)
      const [min, max] = assertions.slopeRange!
      return angleDeg >= min && angleDeg <= max
    }
    case 'noBreakBelow': {
      const candles = generateCandles(spec.data!.generator, spec.data!.seed, spec.data!.bars)
      return closesHoldAbove(candles, spec.solution!.trendline)
    }
    case 'answerUnique': {
      const options = spec.options!
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
    case 'termsInConcepts': {
      const refs = type === 'mcq-quiz'
        ? spec.conceptRefs ?? []
        : type === 'flashcards'
          ? spec.cards!.map(card => card.conceptRef)
          : (spec.items ?? []).map(item => item.conceptRef).filter((ref): ref is string => ref !== undefined)
      return refs.every(ref => ctx.conceptNames.has(ref))
    }
    case 'cardCount': {
      const { min, max } = assertions.cardCount!
      return spec.cards!.length >= min && spec.cards!.length <= max
    }
    case 'itemsNonEmpty': {
      return (spec.items ?? []).every(item => item.text.trim().length > 0)
    }
    case 'edgeRefsExist': {
      const names = new Set(spec.nodes!.map(node => node.conceptRef))
      return spec.nodes!.every(node => ctx.conceptNames.has(node.conceptRef))
        && spec.edges!.every(edge => names.has(edge.from) && names.has(edge.to))
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
    default:
      return false
  }
}

export function proveWidget(
  type: WidgetType,
  spec: WidgetSpec,
  assertions: WidgetAssertions,
  ctx: ProofContext,
): ProofResult {
  const validation: Record<string, 'pass'> = {}
  const failed: string[] = []
  for (const [key, params] of Object.entries(assertions) as [string, unknown][]) {
    if (params === undefined) continue
    if (proofFor(type, spec, key, assertions, ctx)) {
      validation[key] = 'pass'
    } else {
      failed.push(key)
    }
  }
  return failed.length === 0 ? { ok: true, validation } : { ok: false, failed }
}
