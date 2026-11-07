/**
 * 九步生产引擎（纯逻辑）：判断「当前该做第几步」、挡住跑错的顺序、算出追加素材的影响面。
 * 顺序真相源在 @trend/contracts 的 PRODUCTION_STEPS；这里只做判定，不碰云端。
 */

import {
  PRODUCTION_STEPS,
  PRODUCTION_STEP_LABELS,
  type ProductionStep,
  type ProductionTaskStatus,
} from '@trend/contracts'

export interface StepTaskView {
  step: ProductionStep
  status: ProductionTaskStatus
}

export interface StepPlan {
  /** 第一个未完成的步骤；九步全完成时为 null。 */
  currentStep: ProductionStep | null
  currentLabel: string
  completed: ProductionStep[]
  /** 被前置步骤挡住的步骤（排在 currentStep 之后的都还没资格开始）。 */
  blocked: ProductionStep[]
}

export interface StepGate {
  ok: boolean
  /** 不放行时给模型看的话：当前该做第几步。 */
  message: string
}

function statusMap(tasks: StepTaskView[]): Map<ProductionStep, ProductionTaskStatus> {
  return new Map(tasks.map(task => [task.step, task.status]))
}

/** 这一节的进度：做到哪一步、后面哪些还动不了。 */
export function planSectionSteps(tasks: StepTaskView[]): StepPlan {
  const statuses = statusMap(tasks)
  const firstIncomplete = PRODUCTION_STEPS.findIndex(step => statuses.get(step) !== 'done')
  if (firstIncomplete === -1) {
    return {
      currentStep: null,
      currentLabel: '已定稿',
      completed: [...PRODUCTION_STEPS],
      blocked: [],
    }
  }
  return {
    currentStep: PRODUCTION_STEPS[firstIncomplete] ?? null,
    currentLabel: PRODUCTION_STEP_LABELS[PRODUCTION_STEPS[firstIncomplete] as ProductionStep],
    completed: PRODUCTION_STEPS.slice(0, firstIncomplete) as ProductionStep[],
    blocked: PRODUCTION_STEPS.slice(firstIncomplete + 1) as ProductionStep[],
  }
}

/**
 * 只有「开始做」与「做完了」两类状态受顺序约束；
 * pending（重置）/ blocked / failed 只是记录事实，不受约束。
 */
export function isGateEnforced(status: ProductionTaskStatus): boolean {
  return status === 'running' || status === 'done'
}

/** 顺序门禁：前置步骤没做完就不许开始这一步。 */
export function checkStepGate(tasks: StepTaskView[], step: ProductionStep): StepGate {
  const statuses = statusMap(tasks)
  const targetIndex = PRODUCTION_STEPS.indexOf(step)
  for (let index = 0; index < targetIndex; index += 1) {
    const earlier = PRODUCTION_STEPS[index]
    if (earlier === undefined) continue
    if (statuses.get(earlier) === 'done') continue
    return {
      ok: false,
      message: `当前该做第 ${index + 1} 步（${PRODUCTION_STEP_LABELS[earlier]}）：`
        + `「${PRODUCTION_STEP_LABELS[step]}」要在它完成之后再执行。`,
    }
  }
  return { ok: true, message: '' }
}

/**
 * 回灌计数：attempt = 这步已经开始过几次。
 * 首次开始记 1；失败后重跑再加 1；其余状态沿用已有计数。
 */
export function nextAttempt(
  existing: { status: ProductionTaskStatus; attempt: number } | undefined,
  status: ProductionTaskStatus,
): number {
  if (existing === undefined) return status === 'running' ? 1 : 0
  if (status === 'running' && existing.status !== 'running') return existing.attempt + 1
  return existing.attempt
}
