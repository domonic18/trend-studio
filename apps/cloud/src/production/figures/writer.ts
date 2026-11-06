/** 节级图示写入（架构 §6.6.2）：keyframe 抽帧路 + diagram 模板渲染路；配额分路，自动选定候选。 */

import { randomBytes } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { badRequest, codedBadRequest, codedConflict, notFound, serviceUnavailable } from '../../errors.js'
import { candidateIdFor } from '../../pipeline/ids.js'
import { jpegDimensions } from '../../pipeline/keyframes.js'
import type { FigureStore } from '../../illustration/store.js'
import { renderTemplate } from './templates/index.js'

export const KEYFRAME_QUOTA_PER_SECTION = 6
export const DIAGRAM_QUOTA_PER_SECTION = 2
const MIN_IMAGE_EDGE = 800

export interface FigureWriterDeps {
  pool: Pool
  figureStore: FigureStore
  /** 管线 work 目录根（<PIPELINE_STORAGE_DIR>/work）；帧轨道读取与抽帧落点。 */
  keyframeRoot?: string
  /** 帧轨道未命中时回源 ffmpeg 抽帧；未启用管线时缺省。 */
  extractKeyframe?: (assetId: string, sec: number) => Promise<void>
}

export interface SectionFigureScope {
  sectionId: string
  courseId: string
  chapterId: string
}

export type KeyframeFigureInput = {
  kind: 'keyframe'
  assetId: string
  sec: number
  caption: string
  unitId: string
}

export type DiagramFigureInput = {
  kind: 'diagram'
  template: string
  params: unknown
  caption: string
}

export type SectionFigureInput = KeyframeFigureInput | DiagramFigureInput

export interface SectionFigureResult {
  figureId: string
  kind: string
  caption: string
  status: string
  selectedCandidateId: string
  assetId: string | null
  sourceSec: number | null
  spec: Record<string, unknown> | null
}

const ASSET_ID = /^asset_[0-9a-f]{16}$/
const UNIT_ID = /^su_[0-9a-f]{16}$/
const TEMPLATE_NAME = /^[a-z][a-z0-9-]{1,39}$/

/** HTTP 边界形状校验：keyframe 四元组 / diagram 模板三元组（generated 走 M8 通道，此处拒绝）。 */
export function parseSectionFigureInput(input: unknown): SectionFigureInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw badRequest('request body must be a JSON object')
  }
  const body = input as Record<string, unknown>
  const caption = typeof body.caption === 'string' && body.caption.trim().length >= 1 && body.caption.trim().length <= 200
    ? body.caption.trim()
    : undefined
  if (caption === undefined) throw badRequest('caption must be 1–200 characters')
  if (body.kind === 'keyframe') {
    if (typeof body.assetId !== 'string' || !ASSET_ID.test(body.assetId)) throw badRequest('assetId invalid')
    if (typeof body.unitId !== 'string' || !UNIT_ID.test(body.unitId)) throw badRequest('unitId invalid')
    const sec = body.sec
    if (typeof sec !== 'number' || !Number.isInteger(sec) || sec < 0 || sec > 86_400) {
      throw badRequest('sec must be an integer between 0 and 86400')
    }
    return { kind: 'keyframe', assetId: body.assetId, sec, caption, unitId: body.unitId }
  }
  if (body.kind === 'diagram') {
    if (typeof body.template !== 'string' || !TEMPLATE_NAME.test(body.template)) throw badRequest('template invalid')
    if (typeof body.params !== 'object' || body.params === null || Array.isArray(body.params)) {
      throw badRequest('params must be a JSON object')
    }
    return { kind: 'diagram', template: body.template, params: body.params, caption }
  }
  throw badRequest("kind must be 'keyframe' or 'diagram'")
}

function figureIdFor(): string {
  return `fig_${randomBytes(8).toString('hex')}`
}

/** 配额按 kind 分路：keyframe ≤6/节、diagram ≤2/节（generated 沿用 M8 illustrate 通道不经此端点）。 */
async function assertQuota(pool: Pool, sectionId: string, kind: 'keyframe' | 'diagram', excludeFigureId?: string): Promise<void> {
  const limit = kind === 'keyframe' ? KEYFRAME_QUOTA_PER_SECTION : DIAGRAM_QUOTA_PER_SECTION
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM figures
      WHERE section_id = $1 AND kind = $2 AND ($3::text IS NULL OR figure_id <> $3)`,
    [sectionId, kind, excludeFigureId ?? null],
  )
  if (Number(rows[0]?.count ?? 0) >= limit) {
    throw codedConflict('figure_quota_exceeded', `${kind} figures per section is limited to ${limit}`, { kind, limit })
  }
}

async function readKeyframeBytes(deps: FigureWriterDeps, assetId: string, sec: number): Promise<Buffer> {
  if (deps.keyframeRoot === undefined) throw serviceUnavailable('pipeline is not enabled')
  const framePath = join(deps.keyframeRoot, assetId, 'keyframes', `${sec}.jpg`)
  let bytes = await readFile(framePath).catch(() => undefined)
  if (bytes === undefined && deps.extractKeyframe !== undefined) {
    await deps.extractKeyframe(assetId, sec)
    bytes = await readFile(framePath).catch(() => undefined)
  }
  if (bytes === undefined) throw badRequest('keyframe frame unavailable for this asset/second')
  return bytes
}

/** figure 行与候选同事务写入；selected_candidate_id 指向首个也是唯一候选。 */
async function insertFigureWithCandidate(
  deps: FigureWriterDeps,
  scope: SectionFigureScope,
  input: SectionFigureInput,
  stored: { relPath: string; bytes: number; sha256: string },
  dimensions: { width: number; height: number },
  figureId: string,
  candidateId: string,
): Promise<void> {
  const client = await deps.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO figures (figure_id, course_id, chapter_id, section_id, asset_id, kind, caption,
                             source_sec, spec, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'ready')`,
      [
        figureId,
        scope.courseId,
        scope.chapterId,
        scope.sectionId,
        input.kind === 'keyframe' ? input.assetId : null,
        input.kind,
        input.caption,
        input.kind === 'keyframe' ? input.sec : null,
        input.kind === 'diagram' ? JSON.stringify({ template: input.template, params: input.params }) : null,
      ],
    )
    await client.query(
      `INSERT INTO figure_candidates
         (candidate_id, figure_id, rel_path, width, height, bytes, sha256, source_sec, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready')`,
      [
        candidateId,
        figureId,
        stored.relPath,
        dimensions.width,
        dimensions.height,
        stored.bytes,
        stored.sha256,
        input.kind === 'keyframe' ? input.sec : null,
      ],
    )
    await client.query(
      'UPDATE figures SET selected_candidate_id = $2, updated_at = now() WHERE figure_id = $1',
      [figureId, candidateId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/**
 * 同节同 kind 同 caption 的图示覆盖更新：figure_id 不变（正文 :::figure 引用不失效），
 * 旧候选行清掉、spec 与选中候选换新。生产端写错一张图没有删除端点可用，产线需要纠错回路。
 */
async function replaceFigureWithCandidate(
  deps: FigureWriterDeps,
  input: SectionFigureInput,
  stored: { relPath: string; bytes: number; sha256: string },
  dimensions: { width: number; height: number },
  figureId: string,
  candidateId: string,
): Promise<void> {
  const client = await deps.pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: oldCandidates } = await client.query<{ rel_path: string }>(
      'SELECT rel_path FROM figure_candidates WHERE figure_id = $1',
      [figureId],
    )
    await client.query('DELETE FROM figure_candidates WHERE figure_id = $1', [figureId])
    await client.query(
      `INSERT INTO figure_candidates
         (candidate_id, figure_id, rel_path, width, height, bytes, sha256, source_sec, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready')`,
      [
        candidateId,
        figureId,
        stored.relPath,
        dimensions.width,
        dimensions.height,
        stored.bytes,
        stored.sha256,
        input.kind === 'keyframe' ? input.sec : null,
      ],
    )
    // selected_candidate_id 有外键指向 figure_candidates：候选行先落，再改指针。
    await client.query(
      `UPDATE figures
          SET caption = $2, spec = $3::jsonb, selected_candidate_id = $4, status = 'ready', updated_at = now()
        WHERE figure_id = $1`,
      [
        figureId,
        input.caption,
        input.kind === 'diagram' ? JSON.stringify({ template: input.template, params: input.params }) : null,
        candidateId,
      ],
    )
    await client.query('COMMIT')
    for (const old of oldCandidates) {
      await unlink(deps.figureStore.pathOf(old.rel_path)).catch(() => undefined)
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function createSectionFigure(
  deps: FigureWriterDeps,
  scope: SectionFigureScope,
  input: SectionFigureInput,
): Promise<SectionFigureResult> {
  let figureId = figureIdFor()
  const candidateId = candidateIdFor()

  if (input.kind === 'diagram') {
    // 语义校验（400）优先于配额（409）：参数错误不应消耗配额判断。
    const rendered = renderTemplate(input.template, input.params)
    // 同节同 kind 同 caption 视为同一张图：覆盖更新（figure_id 不变，正文引用不失效）。
    const { rows: sameCaption } = await deps.pool.query<{ figure_id: string }>(
      `SELECT figure_id FROM figures
        WHERE section_id = $1 AND kind = $2 AND caption = $3
        ORDER BY created_at LIMIT 1`,
      [scope.sectionId, 'diagram', input.caption],
    )
    const replacing = sameCaption[0]?.figure_id
    await assertQuota(deps.pool, scope.sectionId, 'diagram', replacing)
    // 覆盖时沿用旧 figure_id：正文 :::figure 引用不失效，SVG 也落在同一目录树下。
    figureId = replacing ?? figureId
    const stored = await deps.figureStore.write(figureId, candidateId, 'svg', Buffer.from(rendered.svg, 'utf8'))
    if (replacing === undefined) {
      await insertFigureWithCandidate(deps, scope, input, stored, rendered, figureId, candidateId)
    } else {
      await replaceFigureWithCandidate(deps, input, stored, rendered, figureId, candidateId)
    }
  } else {
    const { rows: unitRows } = await deps.pool.query<{ asset_id: string; start_ms: string | bigint; end_ms: string | bigint }>(
      'SELECT asset_id, start_ms, end_ms FROM source_units WHERE unit_id = $1',
      [input.unitId],
    )
    const unit = unitRows[0]
    if (unit === undefined || unit.asset_id !== input.assetId) {
      throw codedBadRequest('unit_ref_unknown', 'source unit not found for this asset', { unitId: input.unitId })
    }
    const atMs = input.sec * 1000
    if (atMs < Number(unit.start_ms) || atMs > Number(unit.end_ms)) {
      throw codedBadRequest('sec_not_grounded', 'sec must fall inside the referenced source unit window', {
        unitId: input.unitId,
        sec: input.sec,
      })
    }
    await assertQuota(deps.pool, scope.sectionId, 'keyframe')
    const bytes = await readKeyframeBytes(deps, input.assetId, input.sec)
    const size = jpegDimensions(bytes)
    if (size === undefined || Math.min(size.width, size.height) < MIN_IMAGE_EDGE) {
      throw badRequest(`keyframe frame is not usable (min ${MIN_IMAGE_EDGE}px edge)`)
    }
    const stored = await deps.figureStore.write(figureId, candidateId, 'jpeg', bytes)
    await insertFigureWithCandidate(deps, scope, input, stored, size, figureId, candidateId)
  }

  return {
    figureId,
    kind: input.kind,
    caption: input.caption,
    status: 'ready',
    selectedCandidateId: candidateId,
    assetId: input.kind === 'keyframe' ? input.assetId : null,
    sourceSec: input.kind === 'keyframe' ? input.sec : null,
    spec: input.kind === 'diagram' ? { template: input.template, params: input.params } : null,
  }
}

/**
 * 管理端纠错删除：图示行与候选行同事务删除（候选经 ON DELETE CASCADE 随行落地），
 * 候选字节文件在事务提交后清理。配额或抽错帧写歪时删掉重来——生产端没有覆盖删除语义可依赖。
 */
export async function deleteSectionFigure(
  deps: { pool: Pool; figureStore?: FigureStore },
  sectionId: string,
  figureId: string,
): Promise<void> {
  const client = await deps.pool.connect()
  const relPaths: string[] = []
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ rel_path: string }>(
      'SELECT rel_path FROM figure_candidates WHERE figure_id = $1',
      [figureId],
    )
    relPaths.push(...rows.map(row => row.rel_path))
    const { rowCount } = await client.query(
      'DELETE FROM figures WHERE figure_id = $1 AND section_id = $2',
      [figureId, sectionId],
    )
    if ((rowCount ?? 0) === 0) throw notFound('figure not found in section')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  if (deps.figureStore === undefined) return
  for (const relPath of relPaths) {
    await unlink(deps.figureStore.pathOf(relPath)).catch(() => undefined)
  }
}

export interface SectionFigureEntry {
  figureId: string
  kind: string
  caption: string
  status: string
  selectedCandidateId: string | null
  assetId: string | null
  sourceSec: number | null
  spec: Record<string, unknown> | null
  createdAt: string
}

export async function listSectionFigures(pool: Pool, sectionId: string): Promise<SectionFigureEntry[]> {
  const { rows } = await pool.query<{
    figure_id: string
    kind: string
    caption: string
    status: string
    selected_candidate_id: string | null
    asset_id: string | null
    source_sec: number | null
    spec: Record<string, unknown> | null
    created_at: Date
  }>(
    `SELECT figure_id, kind, caption, status, selected_candidate_id, asset_id, source_sec, spec, created_at
     FROM figures WHERE section_id = $1 ORDER BY created_at, figure_id`,
    [sectionId],
  )
  return rows.map(row => ({
    figureId: row.figure_id,
    kind: row.kind,
    caption: row.caption,
    status: row.status,
    selectedCandidateId: row.selected_candidate_id,
    assetId: row.asset_id,
    sourceSec: row.source_sec,
    spec: row.spec,
    createdAt: row.created_at.toISOString(),
  }))
}

