/**
 * 生产任务状态机持久化：把 9 步生产顺序落成「节 × 步骤」的任务行。
 * 写入按 (courseId, sectionId, step) 幂等；看板按节聚合步骤状态 + 产出计数 + 最近评审结论。
 */

import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { PRODUCTION_STEPS, type ProductionStep, type ProductionTaskStatus } from '@trend/contracts'
import { HttpError } from '../errors.js'
import { listMaterialChoices, type MaterialChoiceRow } from './material-choices.js'

export interface ProductionTaskRow {
  taskId: string
  courseId: string
  sectionId: string
  step: ProductionStep
  status: ProductionTaskStatus
  attempt: number
  maxAttempts: number
  note: string | null
  updatedAt: number
}

export interface ProductionBoardSectionRow {
  sectionId: string
  chapterId: string
  title: string
  position: number
  steps: ProductionTaskRow[]
  articleVersion: number | null
  widgetCount: number
  figureCount: number
  caseStockCount: number
  reviewVerdict: 'approve' | 'reject' | null
}

export interface ProductionBoardRow {
  courseId: string
  courseTitle: string
  sections: ProductionBoardSectionRow[]
  materialChoices: MaterialChoiceRow[]
}

interface TaskDbRow {
  task_id: string
  course_id: string
  section_id: string
  step: ProductionStep
  status: ProductionTaskStatus
  attempt: number
  max_attempts: number
  note: string | null
  updated_at: Date
}

function newTaskId(): string {
  return `pt_${randomBytes(8).toString('hex')}`
}

function toTaskRow(row: TaskDbRow): ProductionTaskRow {
  return {
    taskId: row.task_id,
    courseId: row.course_id,
    sectionId: row.section_id,
    step: row.step,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    note: row.note,
    updatedAt: row.updated_at.getTime(),
  }
}

export async function upsertProductionTask(
  pool: Pool,
  input: {
    courseId: string
    sectionId: string
    step: ProductionStep
    status: ProductionTaskStatus
    attempt?: number
    maxAttempts?: number
    note?: string
  },
): Promise<ProductionTaskRow> {
  const { rows: sectionRows } = await pool.query<{ section_id: string }>(
    'SELECT section_id FROM sections WHERE course_id = $1 AND section_id = $2',
    [input.courseId, input.sectionId],
  )
  if (sectionRows.length === 0) throw new HttpError(404, 'section not found')

  const { rows } = await pool.query<TaskDbRow>(
    `INSERT INTO production_tasks
       (task_id, course_id, section_id, step, status, attempt, max_attempts, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (course_id, section_id, step) DO UPDATE
        SET status = EXCLUDED.status,
            attempt = EXCLUDED.attempt,
            max_attempts = EXCLUDED.max_attempts,
            note = EXCLUDED.note,
            updated_at = now()
     RETURNING task_id, course_id, section_id, step, status, attempt, max_attempts, note, updated_at`,
    [
      newTaskId(),
      input.courseId,
      input.sectionId,
      input.step,
      input.status,
      input.attempt ?? 0,
      input.maxAttempts ?? 3,
      input.note ?? null,
    ],
  )
  const row = rows[0]
  if (row === undefined) throw new HttpError(500, 'production task upsert returned no row')
  return toTaskRow(row)
}

export async function listProductionTasks(
  pool: Pool,
  query: { courseId: string; sectionId?: string },
): Promise<ProductionTaskRow[]> {
  const { rows } = await pool.query<TaskDbRow>(
    `SELECT task_id, course_id, section_id, step, status, attempt, max_attempts, note, updated_at
       FROM production_tasks
      WHERE course_id = $1 AND ($2::text IS NULL OR section_id = $2)
      ORDER BY section_id, step`,
    [query.courseId, query.sectionId ?? null],
  )
  return rows.map(toTaskRow)
}

export async function readProductionBoard(pool: Pool, courseId: string): Promise<ProductionBoardRow> {
  const { rows: courseRows } = await pool.query<{ course_id: string; title: string }>(
    "SELECT course_id, title FROM courses WHERE course_id = $1 AND status <> 'archived'",
    [courseId],
  )
  const course = courseRows[0]
  if (course === undefined) throw new HttpError(404, 'course not found')

  const { rows: sectionRows } = await pool.query<{
    section_id: string
    chapter_id: string
    title: string
    position: number
  }>(
    `SELECT section_id, chapter_id, title, position
       FROM sections
      WHERE course_id = $1 AND status <> 'archived'
      ORDER BY position, section_id`,
    [courseId],
  )

  const sectionIds = sectionRows.map(row => row.section_id)
  const tasks = sectionIds.length > 0 ? await loadTasks(pool, courseId, sectionIds) : new Map<string, ProductionTaskRow[]>()
  const articleVersions = sectionIds.length > 0 ? await loadArticleVersions(pool, sectionIds) : new Map<string, number>()
  const widgetCounts = sectionIds.length > 0 ? await loadCounts(pool, 'widget_specs', sectionIds) : new Map<string, number>()
  const figureCounts = sectionIds.length > 0 ? await loadCounts(pool, 'figures', sectionIds) : new Map<string, number>()
  const caseStockCounts = sectionIds.length > 0 ? await loadCounts(pool, 'section_case_stocks', sectionIds) : new Map<string, number>()
  const verdicts = sectionIds.length > 0 ? await loadReviewVerdicts(pool, sectionIds) : new Map<string, 'approve' | 'reject'>()

  return {
    courseId: course.course_id,
    courseTitle: course.title,
    materialChoices: await listMaterialChoices(pool, courseId),
    sections: sectionRows.map(row => ({
      sectionId: row.section_id,
      chapterId: row.chapter_id,
      title: row.title,
      position: row.position,
      steps: orderSteps(tasks.get(row.section_id) ?? []),
      articleVersion: articleVersions.get(row.section_id) ?? null,
      widgetCount: widgetCounts.get(row.section_id) ?? 0,
      figureCount: figureCounts.get(row.section_id) ?? 0,
      caseStockCount: caseStockCounts.get(row.section_id) ?? 0,
      reviewVerdict: verdicts.get(row.section_id) ?? null,
    })),
  }
}

function orderSteps(rows: ProductionTaskRow[]): ProductionTaskRow[] {
  return [...rows].sort((a, b) => PRODUCTION_STEPS.indexOf(a.step) - PRODUCTION_STEPS.indexOf(b.step))
}

async function loadTasks(pool: Pool, courseId: string, sectionIds: string[]): Promise<Map<string, ProductionTaskRow[]>> {
  const { rows } = await pool.query<TaskDbRow>(
    `SELECT task_id, course_id, section_id, step, status, attempt, max_attempts, note, updated_at
       FROM production_tasks
      WHERE course_id = $1 AND section_id = ANY($2::text[])`,
    [courseId, sectionIds],
  )
  const map = new Map<string, ProductionTaskRow[]>()
  for (const row of rows) {
    const list = map.get(row.section_id) ?? []
    list.push(toTaskRow(row))
    map.set(row.section_id, list)
  }
  return map
}

async function loadArticleVersions(pool: Pool, sectionIds: string[]): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ section_id: string; version: number }>(
    'SELECT section_id, version FROM section_articles WHERE section_id = ANY($1::text[])',
    [sectionIds],
  )
  return new Map(rows.map(row => [row.section_id, row.version]))
}

/** 产出计数：课件 / 图示 / 案例股；归档态不计。 */
async function loadCounts(pool: Pool, table: 'widget_specs' | 'figures' | 'section_case_stocks', sectionIds: string[]): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ section_id: string; total: number }>(
    `SELECT section_id, count(*)::int AS total
       FROM ${table}
      WHERE section_id = ANY($1::text[]) AND status <> 'archived'
      GROUP BY section_id`,
    [sectionIds],
  )
  return new Map(rows.map(row => [row.section_id, row.total]))
}

/** 最近一次评审结论：ai_runs 里 content.rubric_review 的 summary.verdict。 */
async function loadReviewVerdicts(pool: Pool, sectionIds: string[]): Promise<Map<string, 'approve' | 'reject'>> {
  const { rows } = await pool.query<{ source_id: string; verdict: string }>(
    `SELECT source_id, summary->>'verdict' AS verdict
       FROM ai_runs
      WHERE task_key = 'content.rubric_review'
        AND source = 'producer'
        AND status = 'succeeded'
        AND source_id = ANY($1::text[])
      ORDER BY started_at DESC`,
    [sectionIds],
  )
  const map = new Map<string, 'approve' | 'reject'>()
  for (const row of rows) {
    if (map.has(row.source_id)) continue
    if (row.verdict === 'approve' || row.verdict === 'reject') map.set(row.source_id, row.verdict)
  }
  return map
}
