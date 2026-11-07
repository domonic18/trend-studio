/**
 * 追加素材决策（场景 B）：A 只补这节 / B 重做课程骨架 / C 只入库。
 * 人决策、Agent 不得自作主张；决策落库并据此重置受影响节的九步状态。
 */

import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { PRODUCTION_STEPS, type MaterialChoice } from '@trend/contracts'
import { badRequest, notFound } from '../errors.js'

export interface MaterialChoiceRow {
  choiceId: string
  courseId: string
  assetId: string
  sectionId: string | null
  choice: MaterialChoice
  affectedSectionIds: string[]
  note: string | null
  createdAt: number
}

export interface MaterialImpact {
  choice: MaterialChoice
  affectedSectionIds: string[]
  affectedTitles: string[]
  /** 将被重置为 pending 的步骤数 = 受影响节数 × 9。 */
  resetStepCount: number
}

interface ChoiceDbRow {
  choice_id: string
  course_id: string
  asset_id: string
  section_id: string | null
  choice: MaterialChoice
  affected_section_ids: string[]
  note: string | null
  created_at: Date
}

function newChoiceId(): string {
  return `pmc_${randomBytes(8).toString('hex')}`
}

function toChoiceRow(row: ChoiceDbRow): MaterialChoiceRow {
  return {
    choiceId: row.choice_id,
    courseId: row.course_id,
    assetId: row.asset_id,
    sectionId: row.section_id,
    choice: row.choice,
    affectedSectionIds: row.affected_section_ids,
    note: row.note,
    createdAt: row.created_at.getTime(),
  }
}

/** 影响面：这次选择会让哪些节被重跑。不落库，供人决策前预览。 */
export async function planMaterialImpact(
  pool: Pool,
  input: { courseId: string; assetId: string; choice: MaterialChoice; sectionId?: string },
): Promise<MaterialImpact> {
  const asset = await pool.query(
    'SELECT asset_id FROM media_assets WHERE asset_id = $1 AND course_id = $2',
    [input.assetId, input.courseId],
  )
  if (asset.rows.length === 0) throw notFound('asset not found')

  let affected: { section_id: string; title: string }[] = []
  if (input.choice === 'A') {
    if (input.sectionId === undefined) throw badRequest('choice A requires sectionId')
    const rows = await pool.query<{ section_id: string; title: string }>(
      "SELECT section_id, title FROM sections WHERE section_id = $1 AND course_id = $2 AND status <> 'archived'",
      [input.sectionId, input.courseId],
    )
    const section = rows.rows[0]
    if (section === undefined) throw notFound('section not found')
    affected = [section]
  } else if (input.choice === 'B') {
    const rows = await pool.query<{ section_id: string; title: string }>(
      "SELECT section_id, title FROM sections WHERE course_id = $1 AND status <> 'archived' ORDER BY position, section_id",
      [input.courseId],
    )
    affected = rows.rows
  }

  const affectedSectionIds = affected.map(row => row.section_id)
  return {
    choice: input.choice,
    affectedSectionIds,
    affectedTitles: affected.map(row => row.title),
    resetStepCount: affectedSectionIds.length * PRODUCTION_STEPS.length,
  }
}

/** 落决策 + 重置受影响节的九步状态 + A 场景把新素材挂到该节。 */
export async function recordMaterialChoice(
  pool: Pool,
  input: { courseId: string; assetId: string; choice: MaterialChoice; sectionId?: string; note?: string },
): Promise<MaterialChoiceRow> {
  const impact = await planMaterialImpact(pool, input)
  const choiceId = newChoiceId()
  const sectionId = input.choice === 'A' ? input.sectionId ?? null : null

  await pool.query(
    `INSERT INTO production_material_choices
       (choice_id, course_id, asset_id, section_id, choice, affected_section_ids, note)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7)`,
    [
      choiceId,
      input.courseId,
      input.assetId,
      sectionId,
      input.choice,
      impact.affectedSectionIds,
      input.note ?? null,
    ],
  )

  if (input.choice === 'A' && input.sectionId !== undefined) {
    await mountAssetToSection(pool, input.sectionId, input.assetId)
  }
  await resetSectionSteps(pool, impact.affectedSectionIds)

  return {
    choiceId,
    courseId: input.courseId,
    assetId: input.assetId,
    sectionId,
    choice: input.choice,
    affectedSectionIds: impact.affectedSectionIds,
    note: input.note ?? null,
    createdAt: Date.now(),
  }
}

/** 课程最近的追加素材决策（看板与续跑都要看）。 */
export async function listMaterialChoices(pool: Pool, courseId: string, limit = 10): Promise<MaterialChoiceRow[]> {
  const { rows } = await pool.query<ChoiceDbRow>(
    `SELECT choice_id, course_id, asset_id, section_id, choice, affected_section_ids, note, created_at
       FROM production_material_choices
      WHERE course_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [courseId, limit],
  )
  return rows.map(toChoiceRow)
}

/** 新素材挂到节：追加到 source_asset_ids（幂等，不动已有条目）。 */
async function mountAssetToSection(pool: Pool, sectionId: string, assetId: string): Promise<void> {
  await pool.query(
    `UPDATE sections
        SET source_asset_ids = (
              SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
                FROM jsonb_array_elements(source_asset_ids) AS value
               WHERE value <> to_jsonb($2::text)
            ) || jsonb_build_array(to_jsonb($2::text)),
            updated_at = now()
      WHERE section_id = $1
        AND NOT (source_asset_ids @> jsonb_build_array(to_jsonb($2::text)))`,
    [sectionId, assetId],
  )
}

/**
 * 重置受影响节的九步状态：已有行置 pending（保留回灌预算），缺失行补建。
 * 一条语句完成，不逐节逐步往返。
 */
export async function resetSectionSteps(pool: Pool, sectionIds: string[]): Promise<void> {
  if (sectionIds.length === 0) return
  await pool.query(
    `INSERT INTO production_tasks (task_id, course_id, section_id, step, status, attempt, max_attempts, note)
     SELECT concat('pt_', substr(md5(random()::text || s.course_id || s.section_id || st.step), 1, 16)),
            s.course_id, s.section_id, st.step, 'pending', 0, 3, NULL
       FROM sections s
       CROSS JOIN unnest($1::text[]) AS st(step)
      WHERE s.section_id = ANY($2::text[])
     ON CONFLICT (course_id, section_id, step) DO UPDATE
        SET status = 'pending',
            attempt = 0,
            max_attempts = production_tasks.max_attempts,
            note = NULL,
            updated_at = now()`,
    [[...PRODUCTION_STEPS], sectionIds],
  )
}
