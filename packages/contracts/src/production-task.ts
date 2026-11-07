/**
 * 生产任务状态机契约：把 9 步生产顺序从「文档纪律」变成「云端可持久化的状态」。
 * 引擎按 step 顺序推进；看板按「节 × 步骤」呈现进度与阻塞点。
 */

import { z } from 'zod'
import { PRODUCTION_TASK_ID, SECTION_ID } from './ids.js'

const sectionId = z.string().regex(SECTION_ID, 'sectionId 格式不合法')

/** 9 步固定顺序（与 skills/section-production 的写入顺序一致）。 */
export const PRODUCTION_STEPS = [
  'case_stocks',
  'quotes_sync',
  'quotes_read',
  'figures',
  'replay_widget',
  'article',
  'widgets',
  'review',
  'provenance',
] as const
export type ProductionStep = (typeof PRODUCTION_STEPS)[number]

/** 步骤中文标签：给人看的步骤卡与看板列名。 */
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

export const PRODUCTION_TASK_STATUSES = ['pending', 'running', 'done', 'blocked', 'failed'] as const
export type ProductionTaskStatus = (typeof PRODUCTION_TASK_STATUSES)[number]

export const productionTaskDto = z.object({
  taskId: z.string().regex(PRODUCTION_TASK_ID, 'taskId 格式不合法'),
  courseId: z.string().min(1).max(64),
  sectionId,
  step: z.enum(PRODUCTION_STEPS),
  status: z.enum(PRODUCTION_TASK_STATUSES),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  note: z.string().max(2000).nullable(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

/** 任务推进：按 (courseId, sectionId, step) 幂等 upsert。 */
export const productionTaskUpsertInput = z.object({
  courseId: z.string().min(1).max(64),
  sectionId,
  step: z.enum(PRODUCTION_STEPS),
  status: z.enum(PRODUCTION_TASK_STATUSES),
  attempt: z.number().int().nonnegative().optional(),
  maxAttempts: z.number().int().positive().optional(),
  note: z.string().max(2000).optional(),
}).strict()

export const productionTaskUpsertOutput = z.object({ task: productionTaskDto }).strict()

export const productionTaskListInput = z.object({
  courseId: z.string().min(1).max(64),
  sectionId: sectionId.optional(),
}).strict()

export const productionTaskListOutput = z.object({
  tasks: z.array(productionTaskDto),
}).strict()

/** 看板聚合：每节一行——步骤状态 + 产出计数 + 最近评审结论。 */
export const productionBoardSection = z.object({
  sectionId,
  chapterId: z.string().min(1).max(64),
  title: z.string().max(200),
  position: z.number().int().positive(),
  steps: z.array(productionTaskDto),
  articleVersion: z.number().int().positive().nullable(),
  widgetCount: z.number().int().nonnegative(),
  figureCount: z.number().int().nonnegative(),
  caseStockCount: z.number().int().nonnegative(),
  reviewVerdict: z.enum(['approve', 'reject']).nullable(),
}).strict()

export const productionBoardOutput = z.object({
  courseId: z.string().min(1).max(64),
  courseTitle: z.string().max(200),
  sections: z.array(productionBoardSection),
}).strict()

export type ProductionTaskDto = z.infer<typeof productionTaskDto>
export type ProductionTaskUpsertInput = z.infer<typeof productionTaskUpsertInput>
export type ProductionTaskListOutput = z.infer<typeof productionTaskListOutput>
export type ProductionBoardOutput = z.infer<typeof productionBoardOutput>
