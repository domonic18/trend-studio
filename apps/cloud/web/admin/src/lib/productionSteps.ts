/**
 * 九步生产顺序与状态标签（副本）。
 *
 * 真相源在 @trend/contracts 的 PRODUCTION_STEPS / PRODUCTION_STEP_LABELS——
 * 管理台是浏览器端，不引 zod 契约包，故在此复制一份（与 producer 的契约副本同例）。
 * 改九步顺序或标签时，两边都要改。
 */

import type { ProductionStep, ProductionTaskStatus } from '../types'

export const PRODUCTION_STEPS: readonly ProductionStep[] = [
  'case_stocks',
  'quotes_sync',
  'quotes_read',
  'figures',
  'replay_widget',
  'article',
  'widgets',
  'review',
  'provenance',
]

export const PRODUCTION_STEP_LABELS: Record<ProductionStep, string> = {
  case_stocks: '案例股',
  quotes_sync: '行情同步',
  quotes_read: '行情读回',
  figures: '图示',
  replay_widget: '回放课件',
  article: '正文',
  widgets: '其余课件',
  review: '评审',
  provenance: '溯源',
}

export const PRODUCTION_TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  pending: '待开始',
  running: '进行中',
  done: '已完成',
  blocked: '阻塞',
  failed: '失败',
}

/** 状态色：done 绿、running 蓝、blocked 橙、failed 红、pending 灰。 */
export const PRODUCTION_TASK_STATUS_COLORS: Record<ProductionTaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  done: 'green',
  blocked: 'orange',
  failed: 'red',
}
