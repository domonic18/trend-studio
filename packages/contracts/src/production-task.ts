/**
 * 生产任务状态机契约：把 9 步生产顺序从「文档纪律」变成「云端可持久化的状态」。
 * 引擎按 step 顺序推进；看板按「节 × 步骤」呈现进度与阻塞点。
 */

import { z } from 'zod'
import { ASSET_ID, PRODUCTION_TASK_ID, SECTION_ID } from './ids.js'
import { PRODUCTION_STEPS, PRODUCTION_TASK_STATUSES } from './production-flow.js'

const sectionId = z.string().regex(SECTION_ID, 'sectionId 格式不合法')

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

/**
 * 追加素材的三种处理方式（人决策，Agent 不得自作主张）：
 * - A：只补这节——新素材作为该节的补充证据，只重跑该节。
 * - B：重做课程骨架——新素材可能带出新章节/新节，全课程重评。
 * - C：只入库，先不生产——素材放着，等决定了再动内容。
 */
export const MATERIAL_CHOICES = ['A', 'B', 'C'] as const
export type MaterialChoice = (typeof MATERIAL_CHOICES)[number]

export const PRODUCTION_MATERIAL_CHOICE_ID = /^pmc_[0-9a-f]{16}$/

export const materialChoiceDto = z.object({
  choiceId: z.string().regex(PRODUCTION_MATERIAL_CHOICE_ID, 'choiceId 格式不合法'),
  courseId: z.string().min(1).max(64),
  assetId: z.string().regex(ASSET_ID, 'assetId 格式不合法'),
  sectionId: sectionId.nullable(),
  choice: z.enum(MATERIAL_CHOICES),
  affectedSectionIds: z.array(sectionId),
  note: z.string().max(2000).nullable(),
  createdAt: z.number().int().nonnegative(),
}).strict()

export const materialImpactInput = z.object({
  courseId: z.string().min(1).max(64),
  assetId: z.string().regex(ASSET_ID, 'assetId 格式不合法'),
  choice: z.enum(MATERIAL_CHOICES),
  /** A 必填：只补哪一节。 */
  sectionId: sectionId.optional(),
}).strict()

export const materialImpactOutput = z.object({
  choice: z.enum(MATERIAL_CHOICES),
  affectedSectionIds: z.array(sectionId),
  affectedTitles: z.array(z.string().max(200)),
  /** 将被重置为 pending 的步骤行数。 */
  resetStepCount: z.number().int().nonnegative(),
}).strict()

export const materialChoiceInput = materialImpactInput.extend({
  note: z.string().max(2000).optional(),
}).strict()

export const materialChoiceOutput = z.object({ choice: materialChoiceDto }).strict()

export const productionBoardOutput = z.object({
  courseId: z.string().min(1).max(64),
  courseTitle: z.string().max(200),
  sections: z.array(productionBoardSection),
  /** 本课程最近一次追加素材决策（按时间倒序，最多 10 条）。 */
  materialChoices: z.array(materialChoiceDto),
}).strict()

export type ProductionTaskDto = z.infer<typeof productionTaskDto>
export type ProductionTaskUpsertInput = z.infer<typeof productionTaskUpsertInput>
export type ProductionTaskUpsertOutput = z.infer<typeof productionTaskUpsertOutput>
export type ProductionTaskListOutput = z.infer<typeof productionTaskListOutput>
export type ProductionBoardOutput = z.infer<typeof productionBoardOutput>
export type MaterialChoiceDto = z.infer<typeof materialChoiceDto>
export type MaterialImpactInput = z.infer<typeof materialImpactInput>
export type MaterialImpactOutput = z.infer<typeof materialImpactOutput>
export type MaterialChoiceInput = z.infer<typeof materialChoiceInput>
export type MaterialChoiceOutput = z.infer<typeof materialChoiceOutput>
