/** calc-trainer 公式白名单：参数域与计算内置为服务端常量，示例值由程序复算证明。 */

export const FORMULAS = ['position-size', 'risk-reward', 'drawdown-recovery'] as const
export type FormulaId = (typeof FORMULAS)[number]

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

/** 非法域或除零返回 undefined，由证明器判为失败而非抛错。 */
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
