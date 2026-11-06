/** 断言证明器：逐条在确定性数据上验证断言，全部通过才有证明记录；失败返回断言键列表（409）。 */

import { computeFormula, formulaInputsInBounds, isFormulaId } from './formulas.js'
import {
  atr,
  classifyShape,
  closesHoldAbove,
  countTrendlineTouches,
  generateCandles,
  isGeneratorId,
  trendlineAt,
  type Candle,
} from './generators.js'
import type {
  BranchingScenarioSpec,
  ImageJuxtapositionSpec,
  WidgetAssertions,
  WidgetSpec,
  WidgetType,
} from './schema.js'

interface BarReplayAnnotation {
  unitId: string
  atMs: number
  kind: string
  d: string
  label: string
}

interface BarReplayDecision {
  atDate: string
  question: string
  options: { label: string }[]
  correct: number
  revealText: string
  unitId: string
  atMs: number
}

interface BarReplaySpec {
  type: 'bar-replay-decision'
  code: string
  window: { from: string; to: string }
  annotations?: BarReplayAnnotation[]
  decisions: BarReplayDecision[]
  citations: string[]
}

export interface ProofContext {
  /** 课程内 concepts 名称与别名的并集，mcq/flashcards/checklist/timeline 术语校验基准。 */
  conceptNames: ReadonlySet<string>
  /** M10 v2 bar-replay-decision：unitId → [startMs, endMs]（用于 grounding）。 */
  unitWindows?: ReadonlyMap<string, { startMs: number; endMs: number }>
  /** M10 v2：该股案例窗口。 */
  caseWindow?: { start: string; end: string }
  /** M10 v2：该股行情缓存中的交易日集合（YYYY-MM-DD）。 */
  tradingDays?: ReadonlySet<string>
  /** M10 v3 image-juxtaposition：本节 figures 的 figureId 集合（figureId 侧必须可解析）。 */
  figureIds?: ReadonlySet<string>
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
      // bar-replay-decision 没有 options/answerId：正确项由 decisions[].correct 唯一指定，
      // 断言口径是「每道题有且只有一个正确答案」——correct 必须落在该题选项区间内。
      if (type === 'bar-replay-decision') {
        const decisions = (spec as BarReplaySpec).decisions
        return decisions.length > 0 && decisions.every(decision =>
          Number.isInteger(decision.correct)
          && decision.correct >= 0
          && decision.correct < decision.options.length)
      }
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
      const nodes = spec.nodes as { conceptRef: string }[]
      const names = new Set(nodes.map(node => node.conceptRef))
      return nodes.every(node => ctx.conceptNames.has(node.conceptRef))
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
    case 'decisionPointsGrounded': {
      const barSpec = spec as BarReplaySpec
      const unitWindows = ctx.unitWindows
      const caseWindow = ctx.caseWindow
      const tradingDays = ctx.tradingDays
      if (unitWindows === undefined || caseWindow === undefined || tradingDays === undefined) return false
      const points = [...(barSpec.annotations ?? []), ...barSpec.decisions]
      for (const point of points) {
        const window = unitWindows.get(point.unitId)
        if (window === undefined || point.atMs < window.startMs || point.atMs > window.endMs) return false
        const date = 'd' in point ? point.d : point.atDate
        if (date < caseWindow.start || date > caseWindow.end || !tradingDays.has(date)) return false
      }
      return true
    }
    case 'revealMonotonic': {
      const barSpec = spec as BarReplaySpec
      const decisions = barSpec.decisions
      const annotations = barSpec.annotations ?? []
      if (decisions.length === 0) return false
      const decisionDates = decisions.map(d => d.atDate).sort()
      for (let i = 1; i < decisionDates.length; i++) {
        if (decisionDates[i]! <= decisionDates[i - 1]!) return false
      }
      const annotationDates = annotations.map(a => a.d).sort()
      if (annotationDates.length < decisions.length) return false
      for (let i = 0; i < decisions.length; i++) {
        if (decisions[i]!.atDate >= annotationDates[i]!) return false
      }
      return true
    }
    case 'annotationTermsGrounded': {
      const barSpec = spec as BarReplaySpec
      const conceptNames = ctx.conceptNames
      for (const decision of barSpec.decisions) {
        if (decision.revealText.trim().length === 0) return false
        if (![...conceptNames].some(name => decision.revealText.includes(name))) return false
      }
      for (const annotation of barSpec.annotations ?? []) {
        if (!conceptNames.has(annotation.label)) return false
      }
      return true
    }
    case 'pairSidesValid': {
      const juxtapose = spec as ImageJuxtapositionSpec
      for (const side of [juxtapose.left, juxtapose.right]) {
        if ('figureId' in side) {
          if (ctx.figureIds === undefined || !ctx.figureIds.has(side.figureId)) return false
          continue
        }
        if (!isGeneratorId(side.generator)) return false
        if (!Number.isInteger(side.seed) || side.seed < 0) return false
        if (!Number.isInteger(side.bars) || side.bars < 20 || side.bars > 300) return false
      }
      return true
    }
    case 'captionsGrounded': {
      const juxtapose = spec as ImageJuxtapositionSpec
      const conceptNames = [...ctx.conceptNames]
      for (const caption of [juxtapose.captions.left, juxtapose.captions.right]) {
        if (!conceptNames.some(name => caption.includes(name))) return false
      }
      return true
    }
    case 'graphAcyclic': {
      const branching = spec as BranchingScenarioSpec
      const adjacency = new Map<string, string[]>()
      for (const node of branching.nodes) {
        for (const option of node.options ?? []) {
          adjacency.set(node.id, [...(adjacency.get(node.id) ?? []), option.next])
        }
      }
      const visiting = new Set<string>()
      const visited = new Set<string>()
      const visit = (id: string): boolean => {
        if (visiting.has(id)) return false
        if (visited.has(id)) return true
        visiting.add(id)
        for (const next of adjacency.get(id) ?? []) {
          if (!visit(next)) return false
        }
        visiting.delete(id)
        visited.add(id)
        return true
      }
      return [...adjacency.keys()].every(visit)
    }
    case 'allPathsTerminate': {
      const branching = spec as BranchingScenarioSpec
      const byId = new Map(branching.nodes.map(node => [node.id, node]))
      if (!byId.has(branching.entryId)) return false
      // 三色 DFS：回边（visiting 再入）即成环，路径不再终止；后继必须落在节点集内。
      const state = new Map<string, 'visiting' | 'done'>()
      const visit = (id: string): boolean => {
        const mark = state.get(id)
        if (mark === 'done') return true
        if (mark === 'visiting') return false
        const node = byId.get(id)
        if (node === undefined) return false
        state.set(id, 'visiting')
        for (const option of node.options ?? []) {
          if (!byId.has(option.next)) return false
          if (!visit(option.next)) return false
        }
        state.set(id, 'done')
        return true
      }
      if (!visit(branching.entryId)) return false
      // 终点可达：可达子图内每个非终点节点都有后继，且路径必在无选项节点收口。
      for (const [id, mark] of state) {
        if (mark !== 'done') continue
        const node = byId.get(id)!
        if ((node.options ?? []).length === 0) continue
        for (const option of node.options ?? []) {
          if (state.get(option.next) !== 'done') return false
        }
      }
      return true
    }
    case 'optimalPathReachable': {
      const branching = spec as BranchingScenarioSpec
      const path = branching.optimalPath
      if (path.length === 0 || path[0] !== branching.entryId) return false
      const byId = new Map(branching.nodes.map(node => [node.id, node]))
      for (let index = 0; index < path.length - 1; index++) {
        const node = byId.get(path[index]!)
        if (node === undefined) return false
        if (!(node.options ?? []).some(option => option.next === path[index + 1])) return false
      }
      return byId.has(path[path.length - 1]!)
    }
    case 'feedbackNonEmpty': {
      const branching = spec as BranchingScenarioSpec
      for (const node of branching.nodes) {
        for (const option of node.options ?? []) {
          if (option.feedback.trim().length === 0) return false
        }
      }
      return true
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
