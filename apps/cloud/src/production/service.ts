/** 语料级生产（M9）：节、source units、概念图谱、课件 spec 复检与生产溯源的存储与检索。 */

import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { isProducerTaskKey, type ProducerTaskKey } from '../ai/tasks.js'
import type { AiUsageService } from '../ai/usage.js'
import { assertSafeMarkdown, parseContentId } from '../content/service.js'
import { badRequest, codedConflict, conflict, notFound, serviceUnavailable } from '../errors.js'
import { toVectorLiteral, type EmbeddingResolver } from '../kb/embedding.js'
import { stringField } from '../http/validation.js'
import type { FigureStore } from '../illustration/store.js'
import { validateArticleDsl, type DslUnitRef } from './dsl/validate.js'
import { DSL_VERSION } from './dsl/schemas.js'
import { parseArticleDsl, type DslParseResult } from './dsl/parse.js'
import {
  createSectionFigure as writeSectionFigure,
  listSectionFigures as querySectionFigures,
  parseSectionFigureInput,
  type SectionFigureEntry,
  type SectionFigureResult,
} from './figures/writer.js'
import {
  listSectionCaseStocks as queryCaseStocks,
  parseCaseStocksInput,
  upsertSectionCaseStocks as writeCaseStocks,
  type CaseStockEntry,
  type CaseStockSaveResult,
} from './case-stocks.js'
import { proveWidget } from './widgets/provers.js'
import {
  isWidgetType,
  validateAssertions,
  validateCitations,
  validateSpec,
  WIDGET_SPEC_VERSION,
  type WidgetAssertions,
  type WidgetSpec,
  type WidgetType,
} from './widgets/schema.js'

const HEX16 = '^[0-9a-f]{16}$'

const suId = (): string => `su_${randomBytes(8).toString('hex')}`
const cptId = (): string => `cpt_${randomBytes(8).toString('hex')}`
const cedId = (): string => `ced_${randomBytes(8).toString('hex')}`
const wgtId = (): string => `wgt_${randomBytes(8).toString('hex')}`
const secId = (): string => `sec_${randomBytes(8).toString('hex')}`

const SOURCE_UNIT_ID = new RegExp(`^su_${HEX16.slice(1, -1)}$`)
const CONCEPT_ID = /^cpt_[0-9a-f]{16}$/
const SECTION_ID = /^sec_[0-9a-f]{16}$/
const ASSET_ID = /^asset_[0-9a-f]{16}$/

export function parseSourceUnitId(raw: string): string {
  return stringField({ unitId: raw }, 'unitId', { max: 19, pattern: SOURCE_UNIT_ID })
}

export function parseSectionId(raw: string): string {
  return stringField({ sectionId: raw }, 'sectionId', { max: 20, pattern: SECTION_ID })
}

export interface SectionDto {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  status: string
  summary?: string
  sourceAssetIds: string[]
  conceptRefs: string[]
  createdAt: string
  updatedAt: string
}

/** 管理台节预览聚合：节元信息 + 教材 + 课件(spec/断言全量) + 图示。 */
export interface SectionPreview {
  section: SectionBrief
  article: ArticleBrief | null
  widgets: WidgetDetail[]
  figures: FigureBrief[]
}

export interface SectionBrief {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  status: string
  summary?: string
  conceptRefs: string[]
}

export interface ArticleBrief {
  markdown: string
  citations: string[]
  version: number
  status: string
  /** 富文本 DSL 能力版本（架构 §6.6.1），渲染器按版本门禁。 */
  dslVersion: number
}

export interface WidgetDetail {
  widgetId: string
  type: string
  specVersion: number
  spec: unknown
  assertions: unknown
  validation: Record<string, string>
  status: string
  version: number
  createdAt: string
}

export interface FigureBrief {
  figureId: string
  kind: string
  caption: string
  status: string
  selectedCandidateId: string | null
  spec: unknown
  sectionId: string | null
}

interface SectionRow {
  section_id: string
  course_id: string
  chapter_id: string
  title: string
  position: number
  status: string
  summary: string | null
  source_asset_ids: unknown
  concept_refs: unknown
  created_at: Date
  updated_at: Date
}

const SECTION_COLUMNS = `section_id, course_id, chapter_id, title, position, status, summary,
  source_asset_ids, concept_refs, created_at, updated_at`

function toSection(row: SectionRow): SectionDto {
  return {
    sectionId: row.section_id,
    courseId: row.course_id,
    chapterId: row.chapter_id,
    title: row.title,
    position: row.position,
    status: row.status,
    ...(row.summary === null ? {} : { summary: row.summary }),
    sourceAssetIds: row.source_asset_ids as string[],
    conceptRefs: row.concept_refs as string[],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export interface SourceUnitDto {
  unitId: string
  assetId: string
  startMs: number
  endMs: number
  summary: string
  score: number
}

interface SourceUnitRow {
  unit_id: string
  asset_id: string
  start_ms: bigint | number | string
  end_ms: bigint | number | string
  summary: string
  score?: number | string
}

function toNumber(value: bigint | number | string): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function toUnit(row: SourceUnitRow): SourceUnitDto {
  return {
    unitId: row.unit_id,
    assetId: row.asset_id,
    startMs: toNumber(row.start_ms),
    endMs: toNumber(row.end_ms),
    summary: row.summary,
    score: row.score === undefined ? 0 : Number(row.score),
  }
}

function jsonArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw badRequest(`${label} must be an array of at most ${max} ids`)
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length > 64) throw badRequest(`${label}[${index}] invalid`)
    return entry
  })
}

function idArray(value: unknown, label: string, pattern: RegExp, max: number): string[] {
  return jsonArray(value, label, max).map((entry, index) => {
    if (!pattern.test(entry)) throw badRequest(`${label}[${index}] invalid`)
    return entry
  })
}

function stringArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw badRequest(`${label} must be an array of at most ${max} strings`)
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length < 1 || entry.trim().length > 200) {
      throw badRequest(`${label}[${index}] must be 1–200 characters`)
    }
    return entry.trim()
  })
}

export interface ProductionDeps {
  pool: Pool
  embedding: EmbeddingResolver
  usage: AiUsageService
  searchMinConfidence: number
  recallWindow: number
  /** 管线 work 目录根（<PIPELINE_STORAGE_DIR>/work）；未启用管线时缺省，frames 接口 503。 */
  keyframeRoot?: string
  /** 图示存储（figureLocalDir）；未配置时节级图示写入 503。 */
  figureStore?: FigureStore
  /** 帧轨道未命中时回源抽帧；未启用管线时缺省。 */
  extractKeyframe?: (assetId: string, sec: number) => Promise<void>
}

export interface KeyframeEntry {
  sec: number
  width: number
  height: number
}

interface KeyframeManifest {
  frames: { sec: number; width: number; height: number }[]
}

export class ProductionService {
  constructor(private readonly deps: ProductionDeps) {}

  private get pool(): Pool {
    return this.deps.pool
  }

  async listSections(courseId: string, chapterId?: string): Promise<SectionDto[]> {
    parseContentId(courseId, 'courseId')
    const { rows } = await this.pool.query<SectionRow>(
      `SELECT ${SECTION_COLUMNS}
       FROM sections WHERE course_id = $1 AND ($2::text IS NULL OR chapter_id = $2)
       ORDER BY position, section_id`,
      [courseId, chapterId ?? null],
    )
    return rows.map(toSection)
  }

  async putSection(input: {
    sectionId?: string
    courseId: string
    chapterId: string
    title: string
    position: number
    summary?: string
    sourceAssetIds?: unknown
    conceptRefs?: unknown
  }): Promise<SectionDto> {
    parseContentId(input.courseId, 'courseId')
    parseContentId(input.chapterId, 'chapterId')
    await this.assertCourseDraft(input.courseId)
    await this.assertChapterInCourse(input.courseId, input.chapterId)
    const assetIds = input.sourceAssetIds === undefined
      ? []
      : idArray(input.sourceAssetIds, 'sourceAssetIds', ASSET_ID, 30)
    if (assetIds.length > 0) await this.assertCount('media_assets', 'asset_id', assetIds, 'sourceAssetIds contains unknown asset')
    const conceptRefs = input.conceptRefs === undefined
      ? []
      : idArray(input.conceptRefs, 'conceptRefs', CONCEPT_ID, 50)
    if (conceptRefs.length > 0) {
      await this.assertCount('concepts', 'concept_id', conceptRefs, 'conceptRefs contains unknown concept', input.courseId)
    }

    if (input.sectionId === undefined) {
      const { rows } = await this.pool.query<SectionRow>(
        `INSERT INTO sections (section_id, course_id, chapter_id, title, position, summary,
                               source_asset_ids, concept_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
         RETURNING ${SECTION_COLUMNS}`,
        [
          secId(),
          input.courseId,
          input.chapterId,
          input.title,
          input.position,
          input.summary ?? null,
          JSON.stringify(assetIds),
          JSON.stringify(conceptRefs),
        ],
      )
      const insertedSection = rows[0]
      if (insertedSection === undefined) throw new Error('section insert returned no row')
      return toSection(insertedSection)
    }
    const { rows } = await this.pool.query<SectionRow>(
      `UPDATE sections SET title = $3, position = $4, summary = $5,
              source_asset_ids = $6::jsonb, concept_refs = $7::jsonb, updated_at = now()
       WHERE section_id = $1 AND course_id = $2
       RETURNING ${SECTION_COLUMNS}`,
      [
        input.sectionId,
        input.courseId,
        input.title,
        input.position,
        input.summary ?? null,
        JSON.stringify(assetIds),
        JSON.stringify(conceptRefs),
      ],
    )
    const updatedSection = rows[0]
    if (updatedSection === undefined) throw notFound('section not found')
    return toSection(updatedSection)
  }

  async putArticle(sectionId: string, markdown: string, citations: string[]): Promise<{
    sectionId: string
    version: number
    status: string
  }> {
    parseSectionId(sectionId)
    assertSafeMarkdown(markdown)
    const parsed = parseArticleDsl(markdown)
    const section = await this.requireSection(sectionId)
    await this.assertCourseDraft(section.course_id)
    if (citations.length > 0) await this.assertCount('source_units', 'unit_id', citations, 'citations contain unknown source unit')
    await this.validateArticleGrounding(sectionId, section.course_id, parsed)
    const { rows } = await this.pool.query<{ version: number; status: string }>(
      `INSERT INTO section_articles (section_id, markdown, citations, version, status)
       VALUES ($1, $2, $3::jsonb, 1, 'draft')
       ON CONFLICT (section_id) DO UPDATE
         SET markdown = $2, citations = $3::jsonb, version = section_articles.version + 1,
             status = 'draft', updated_at = now()
       RETURNING version, status`,
      [sectionId, markdown, JSON.stringify(citations)],
    )
    const articleRow = rows[0]
    if (articleRow === undefined) throw new Error('article upsert returned no row')
    return { sectionId, version: articleRow.version, status: articleRow.status }
  }

  /** DSL 语义校验上下文按正文引用懒查：figureId 查本节 figures、unitId 查 source_units。 */
  private async validateArticleGrounding(sectionId: string, courseId: string, parsed: DslParseResult): Promise<void> {
    const { rows: figureRows } = await this.pool.query<{ figure_id: string }>(
      'SELECT figure_id FROM figures WHERE section_id = $1',
      [sectionId],
    )
    const unitIds = [...new Set(
      parsed.blocks.map(block => block.attrs.unitId).filter((value): value is string => value !== undefined),
    )]
    const units = new Map<string, DslUnitRef>()
    if (unitIds.length > 0) {
      const { rows: unitRows } = await this.pool.query<{ unit_id: string; asset_id: string; start_ms: string | bigint; end_ms: string | bigint }>(
        'SELECT unit_id, asset_id, start_ms, end_ms FROM source_units WHERE unit_id = ANY($1::text[])',
        [unitIds],
      )
      for (const row of unitRows) {
        units.set(row.unit_id, { assetId: row.asset_id, startMs: Number(row.start_ms), endMs: Number(row.end_ms) })
      }
    }
    await validateArticleDsl(parsed, {
      sectionFigureIds: new Set(figureRows.map(row => row.figure_id)),
      units,
      courseUnitIds: await this.loadCourseUnitIds(courseId, parsed.unitAnchors.map(anchor => anchor.unitId)),
      clipGrounded: async (assetId, fromMs, toMs) => {
        const { rows } = await this.pool.query(
          'SELECT 1 FROM source_units WHERE asset_id = $1 AND start_ms <= $2 AND end_ms >= $3 LIMIT 1',
          [assetId, fromMs, toMs],
        )
        return rows.length > 0
      },
      stockInSection: async (exchange, code) => {
        const { rows } = await this.pool.query(
          'SELECT 1 FROM section_case_stocks WHERE section_id = $1 AND exchange = $2 AND code = $3 LIMIT 1',
          [sectionId, exchange, code],
        )
        return rows.length > 0
      },
    })
  }

  /** 内联锚 unitId 是否属于本课程：source_units 经 media_assets.course_id 归属课程。 */
  private async loadCourseUnitIds(courseId: string, unitIds: string[]): Promise<ReadonlySet<string>> {
    const wanted = [...new Set(unitIds)]
    if (wanted.length === 0) return new Set()
    const { rows } = await this.pool.query<{ unit_id: string }>(
      `SELECT su.unit_id FROM source_units su
         JOIN media_assets ma ON ma.asset_id = su.asset_id
        WHERE ma.course_id = $1 AND su.unit_id = ANY($2::text[])`,
      [courseId, wanted],
    )
    return new Set(rows.map(row => row.unit_id))
  }

  /** 管理台渲染预览：聚合节元信息、教材、课件(spec/断言全量) 与节级图示。 */
  async getSectionPreview(sectionId: string): Promise<SectionPreview> {
    parseSectionId(sectionId)
    const section = await this.requireSection(sectionId)
    const { rows: articleRows } = await this.pool.query<{
      markdown: string
      citations: unknown
      version: number
      status: string
    }>(
      'SELECT markdown, citations, version, status FROM section_articles WHERE section_id = $1',
      [sectionId],
    )
    const articleRow = articleRows[0]
    const { rows: widgetRows } = await this.pool.query<{
      widget_id: string
      type: string
      spec_version: number
      spec: unknown
      assertions: unknown
      validation: Record<string, string>
      status: string
      version: number
      created_at: Date
    }>(
      `SELECT widget_id, type, spec_version, spec, assertions, validation, status, version, created_at
       FROM widget_specs WHERE section_id = $1 ORDER BY created_at, widget_id`,
      [sectionId],
    )
    const { rows: figureRows } = await this.pool.query<{
      figure_id: string
      kind: string
      caption: string
      status: string
      selected_candidate_id: string | null
      spec: unknown
      section_id: string | null
    }>(
      `SELECT figure_id, kind, caption, status, selected_candidate_id, spec, section_id
       FROM figures WHERE section_id = $1 ORDER BY created_at, figure_id`,
      [sectionId],
    )
    return {
      section: {
        sectionId: section.section_id,
        courseId: section.course_id,
        chapterId: section.chapter_id,
        title: section.title,
        position: section.position,
        status: section.status,
        ...(section.summary === null ? {} : { summary: section.summary }),
        conceptRefs: section.concept_refs as string[],
      },
      article: articleRow === undefined
        ? null
        : {
            markdown: articleRow.markdown,
            citations: articleRow.citations as string[],
            version: articleRow.version,
            status: articleRow.status,
            dslVersion: DSL_VERSION,
          },
      widgets: widgetRows.map(row => ({
        widgetId: row.widget_id,
        type: row.type,
        specVersion: row.spec_version,
        spec: row.spec,
        assertions: row.assertions,
        validation: row.validation,
        status: row.status,
        version: row.version,
        createdAt: row.created_at.toISOString(),
      })),
      figures: figureRows.map(row => ({
        figureId: row.figure_id,
        kind: row.kind,
        caption: row.caption,
        status: row.status,
        selectedCandidateId: row.selected_candidate_id,
        spec: row.spec,
        sectionId: row.section_id,
      })),
    }
  }

  async createSourceUnits(units: unknown[]): Promise<{ saved: { unitId: string; assetId: string; startMs: number; deduped: boolean }[] }> {
    if (units.length < 1 || units.length > 100) throw badRequest('units must contain 1–100 items')
    for (const raw of units) this.parseUnitInput(raw)
    const saved: { unitId: string; assetId: string; startMs: number; deduped: boolean }[] = []
    for (const raw of units) {
      const unit = this.parseUnitInput(raw)
      const existing = await this.pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM source_units WHERE asset_id = $1 AND start_ms = $2',
        [unit.assetId, unit.startMs],
      )
      const existingRow = existing.rows[0]
      if (existingRow !== undefined) {
        saved.push({ unitId: existingRow.unit_id, assetId: unit.assetId, startMs: unit.startMs, deduped: true })
        continue
      }
      const vector = await this.embedQuietly(unit.summary, 'embedding.segment')
      const inserted = await this.pool.query<{ unit_id: string }>(
        `INSERT INTO source_units (unit_id, asset_id, transcript_id, start_ms, end_ms,
                                   transcript_text, visual, summary, concept_refs, produced_by, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb,
                 ${vector === undefined ? 'NULL' : `$11::halfvec`})
         ON CONFLICT (asset_id, start_ms) DO NOTHING
         RETURNING unit_id`,
        [
          suId(),
          unit.assetId,
          unit.transcriptId ?? null,
          unit.startMs,
          unit.endMs,
          unit.transcriptText,
          JSON.stringify(unit.visual),
          unit.summary,
          JSON.stringify(unit.conceptRefs),
          JSON.stringify(unit.producedBy),
          ...(vector === undefined ? [] : [toVectorLiteral(vector)]),
        ],
      )
      const insertedRow = inserted.rows[0]
      if (insertedRow !== undefined) {
        saved.push({ unitId: insertedRow.unit_id, assetId: unit.assetId, startMs: unit.startMs, deduped: false })
        continue
      }
      // 并发写入同一 (asset, startMs)：冲突后回读既有 unitId，保持幂等语义。
      const winner = await this.pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM source_units WHERE asset_id = $1 AND start_ms = $2',
        [unit.assetId, unit.startMs],
      )
      const winnerRow = winner.rows[0]
      if (winnerRow === undefined) throw new Error('source unit conflict lost without row')
      saved.push({ unitId: winnerRow.unit_id, assetId: unit.assetId, startMs: unit.startMs, deduped: true })
    }
    return { saved }
  }

  private parseUnitInput(raw: unknown): {
    assetId: string
    transcriptId?: string
    startMs: number
    endMs: number
    transcriptText: string
    visual: Record<string, unknown>
    summary: string
    conceptRefs: string[]
    producedBy: Record<string, unknown>
  } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw badRequest('each unit must be an object')
    }
    const unit = raw as Record<string, unknown>
    for (const key of ['assetId', 'startMs', 'endMs', 'transcriptText', 'summary'] as const) {
      if (unit[key] === undefined) throw badRequest(`unit.${key} is required`)
    }
    const startMs = unit.startMs
    const endMs = unit.endMs
    if (typeof startMs !== 'number' || !Number.isInteger(startMs) || startMs < 0) {
      throw badRequest('unit.startMs must be a non-negative integer')
    }
    if (typeof endMs !== 'number' || !Number.isInteger(endMs) || endMs <= startMs) {
      throw badRequest('unit.endMs must be an integer greater than startMs')
    }
    const visual = unit.visual ?? {}
    const producedBy = unit.producedBy ?? {}
    for (const [label, value] of [['unit.visual', visual], ['unit.producedBy', producedBy]] as const) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw badRequest(`${label} must be an object`)
      }
    }
    return {
      assetId: stringField({ assetId: unit.assetId }, 'assetId', { max: 22, pattern: ASSET_ID }),
      ...(unit.transcriptId === undefined
        ? {}
        : { transcriptId: stringField({ transcriptId: unit.transcriptId }, 'transcriptId', { max: 19, pattern: /^tr_[0-9a-f]{16}$/ }) }),
      startMs,
      endMs,
      transcriptText: stringField({ transcriptText: unit.transcriptText }, 'transcriptText', { min: 1, max: 8000 }),
      summary: stringField({ summary: unit.summary }, 'summary', { min: 1, max: 2000 }),
      visual: visual as Record<string, unknown>,
      conceptRefs: unit.conceptRefs === undefined ? [] : jsonArray(unit.conceptRefs, 'unit.conceptRefs', 30),
      producedBy: producedBy as Record<string, unknown>,
    }
  }

  /**
   * 检索：q 缺省为列表（keyset 游标）；q 存在为词法+向量 RRF 融合（offset 游标）。
   * 向量未配置时退化为纯词法，不伪装召回（原则 6）。
   */
  async searchSourceUnits(input: {
    assetId: string
    q?: string
    conceptId?: string
    cursor?: string
    limit: number
  }): Promise<{ units: SourceUnitDto[]; nextCursor: string | null }> {
    const assetId = stringField({ assetId: input.assetId }, 'assetId', { max: 22, pattern: ASSET_ID })
    const conditions = ['asset_id = $1']
    const params: unknown[] = [assetId]
    const bind = (value: unknown): string => {
      params.push(value)
      return `$${params.length}`
    }
    if (input.conceptId !== undefined) {
      const conceptId = stringField({ conceptId: input.conceptId }, 'conceptId', { max: 20, pattern: CONCEPT_ID })
      conditions.push(`concept_refs @> to_jsonb(${bind(conceptId)}::text)`)
    }

    if (input.q === undefined || input.q === '') {
      let cursor: { startMs: number; unitId: string } | undefined
      if (input.cursor !== undefined) {
        cursor = this.parseKeysetCursor(input.cursor)
        params.push(cursor.startMs, cursor.unitId)
        conditions.push(`(start_ms, unit_id) > ($${params.length - 1}, $${params.length})`)
      }
      const { rows } = await this.pool.query<SourceUnitRow>(
        `SELECT unit_id, asset_id, start_ms, end_ms, summary, 0 AS score
         FROM source_units WHERE ${conditions.join(' AND ')}
         ORDER BY start_ms, unit_id LIMIT ${input.limit + 1}`,
        params,
      )
      return this.pageKeyset(rows, input.limit)
    }

    let offset = 0
    if (input.cursor !== undefined) {
      offset = this.parseOffsetCursor(input.cursor)
    }
    const query = input.q
    // 词法/向量两条 SQL 共用 asset_id（+conceptId）前缀参数；向量侧只引用前缀，
    // 若沿用整条 params 会留下未引用的 $n 让 PG 无法推断类型（42P18）
    const baseParamCount = params.length
    const window = Math.max(input.limit * 4, this.deps.recallWindow)
    const lexicalScore = `GREATEST(similarity(summary, ${bind(query)}), word_similarity(${bind(query)}, summary),
        similarity(transcript_text, ${bind(query)}), word_similarity(${bind(query)}, transcript_text))`
    params.push(this.deps.searchMinConfidence)
    const threshold = `$${params.length}`
    const lexicalRows = await this.pool.query<SourceUnitRow>(
      `SELECT unit_id, asset_id, start_ms, end_ms, summary, ${lexicalScore} AS score
       FROM source_units WHERE ${conditions.join(' AND ')} AND ${lexicalScore} >= ${threshold}
       ORDER BY score DESC, unit_id LIMIT ${window}`,
      params,
    )
    const queryVector = await this.embedQuietly(query, 'embedding.query')
    const vectorRows = queryVector === undefined
      ? []
      : (await this.pool.query<SourceUnitRow>(
        `SELECT unit_id, asset_id, start_ms, end_ms, summary,
                1 - (embedding <=> $${baseParamCount + 2}::halfvec) AS score
         FROM source_units
         WHERE ${conditions.join(' AND ')} AND embedding IS NOT NULL
           AND 1 - (embedding <=> $${baseParamCount + 2}::halfvec) >= $${baseParamCount + 1}
         ORDER BY embedding <=> $${baseParamCount + 2}::halfvec LIMIT ${window}`,
        [...params.slice(0, baseParamCount), this.deps.searchMinConfidence, toVectorLiteral(queryVector)],
      )).rows
    const fused = fuseUnits([lexicalRows.rows, vectorRows])
    const page = fused.slice(offset, offset + input.limit)
    return {
      units: page,
      nextCursor: fused.length > offset + page.length && page.length > 0 ? String(offset + page.length) : null,
    }
  }

  private parseKeysetCursor(raw: string): { startMs: number; unitId: string } {
    const separator = raw.indexOf(':')
    if (separator <= 0) throw badRequest('cursor invalid')
    const startMs = Number(raw.slice(0, separator))
    const unitId = raw.slice(separator + 1)
    if (!Number.isInteger(startMs) || startMs < 0 || !SOURCE_UNIT_ID.test(unitId)) {
      throw badRequest('cursor invalid')
    }
    return { startMs, unitId }
  }

  private parseOffsetCursor(raw: string): number {
    if (!/^\d+$/.test(raw)) throw badRequest('cursor invalid')
    const offset = Number(raw)
    if (offset > 100_000) throw badRequest('cursor invalid')
    return offset
  }

  private pageKeyset(rows: SourceUnitRow[], limit: number): { units: SourceUnitDto[]; nextCursor: string | null } {
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return {
      units: page.map(toUnit),
      nextCursor: rows.length > limit && last !== undefined ? `${toNumber(last.start_ms)}:${last.unit_id}` : null,
    }
  }

  async putConcept(input: {
    courseId: string
    name: string
    aliases?: unknown
    definition?: string
  }): Promise<{ conceptId: string }> {
    parseContentId(input.courseId, 'courseId')
    await this.assertCourseRow(input.courseId)
    const aliases = input.aliases === undefined ? [] : stringArray(input.aliases, 'aliases', 20)
    const { rows } = await this.pool.query<{ concept_id: string }>(
      `INSERT INTO concepts (concept_id, course_id, name, aliases, definition)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (course_id, name) DO NOTHING
       RETURNING concept_id`,
      [cptId(), input.courseId, input.name, JSON.stringify(aliases), input.definition ?? null],
    )
    const conceptRow = rows[0]
    if (conceptRow === undefined) throw conflict('concept name already exists in course')
    return { conceptId: conceptRow.concept_id }
  }

  async listConcepts(courseId: string): Promise<{
    concepts: { conceptId: string; name: string; aliases: string[]; definition: string | null }[]
  }> {
    parseContentId(courseId, 'courseId')
    const { rows } = await this.pool.query<{ concept_id: string; name: string; aliases: string[]; definition: string | null }>(
      'SELECT concept_id, name, aliases, definition FROM concepts WHERE course_id = $1 ORDER BY created_at, concept_id',
      [courseId],
    )
    return {
      concepts: rows.map(row => ({
        conceptId: row.concept_id,
        name: row.name,
        aliases: row.aliases ?? [],
        definition: row.definition,
      })),
    }
  }

  async createConceptEdge(input: {
    courseId: string
    fromConceptId: string
    toConceptId: string
    kind: 'prerequisite' | 'related'
  }): Promise<{ edgeId: string }> {
    parseContentId(input.courseId, 'courseId')
    if (input.fromConceptId === input.toConceptId) throw badRequest('concept edge must not be a self loop')
    if (!CONCEPT_ID.test(input.fromConceptId) || !CONCEPT_ID.test(input.toConceptId)) {
      throw badRequest('concept ids invalid')
    }
    const existing = await this.pool.query<{ edge_id: string }>(
      `SELECT edge_id FROM concept_edges
       WHERE course_id = $1 AND from_concept_id = $2 AND to_concept_id = $3 AND kind = $4`,
      [input.courseId, input.fromConceptId, input.toConceptId, input.kind],
    )
    const existingEdge = existing.rows[0]
    if (existingEdge !== undefined) return { edgeId: existingEdge.edge_id }
    const known = await this.pool.query<{ concept_id: string }>(
      'SELECT concept_id FROM concepts WHERE course_id = $1 AND concept_id = ANY($2::text[])',
      [input.courseId, [input.fromConceptId, input.toConceptId]],
    )
    if (known.rows.length !== 2) throw notFound('concept not found in course')
    const { rows } = await this.pool.query<{ edge_id: string }>(
      `INSERT INTO concept_edges (edge_id, course_id, from_concept_id, to_concept_id, kind)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING edge_id`,
      [cedId(), input.courseId, input.fromConceptId, input.toConceptId, input.kind],
    )
    const edgeRow = rows[0]
    if (edgeRow === undefined) throw new Error('concept edge insert returned no row')
    return { edgeId: edgeRow.edge_id }
  }

  /** 关键帧轨道清单：优先读 worker 写入的 manifest，缺失时回退目录文件名（尺寸 0）。 */
  async listKeyframes(assetId: string, fromMs: number, toMs: number): Promise<KeyframeEntry[]> {
    if (this.deps.keyframeRoot === undefined) throw serviceUnavailable('pipeline is not enabled')
    const manifest = await this.readKeyframeManifest(assetId)
    if (manifest !== undefined) {
      return manifest.frames
        .filter(frame => frame.sec * 1000 >= fromMs && frame.sec * 1000 < toMs)
        .map(frame => ({ sec: frame.sec, width: frame.width, height: frame.height }))
    }
    const directory = join(this.deps.keyframeRoot, assetId, 'keyframes')
    const entries = await readdir(directory).catch(() => [] as string[])
    const secs: number[] = []
    for (const name of entries) {
      const match = /^(\d{1,5})\.jpg$/.exec(name)
      if (match === null) continue
      const sec = Number(match[1])
      if (Number.isFinite(sec)) secs.push(sec)
    }
    return secs
      .filter(sec => sec * 1000 >= fromMs && sec * 1000 < toMs)
      .sort((a, b) => a - b)
      .map(sec => ({ sec, width: 0, height: 0 }))
  }

  async hasKeyframesFrom(assetId: string, fromMs: number): Promise<boolean> {
    if (this.deps.keyframeRoot === undefined) return false
    const manifest = await this.readKeyframeManifest(assetId)
    if (manifest !== undefined) {
      return manifest.frames.some(frame => frame.sec * 1000 >= fromMs)
    }
    const directory = join(this.deps.keyframeRoot, assetId, 'keyframes')
    const entries = await readdir(directory).catch(() => [] as string[])
    return entries.some(name => {
      const match = /^(\d{1,5})\.jpg$/.exec(name)
      if (match === null) return false
      const sec = Number(match[1])
      return Number.isFinite(sec) && sec * 1000 >= fromMs
    })
  }

  private async readKeyframeManifest(assetId: string): Promise<KeyframeManifest | undefined> {
    if (this.deps.keyframeRoot === undefined) return undefined
    const path = join(this.deps.keyframeRoot, assetId, 'keyframes', 'manifest.json')
    const raw = await readFile(path, 'utf8').catch(() => undefined)
    if (raw === undefined) return undefined
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as KeyframeManifest).frames)) {
        return undefined
      }
      return parsed as KeyframeManifest
    } catch {
      return undefined
    }
  }

  async listWidgets(sectionId: string): Promise<{
    widgets: {
      widgetId: string
      type: string
      specVersion: number
      specBytes: number
      validation: Record<string, string>
      status: string
      version: number
      createdAt: string
      updatedAt: string
    }[]
  }> {
    parseSectionId(sectionId)
    const { rows } = await this.pool.query<{
      widget_id: string
      type: string
      spec_version: number
      spec: unknown
      validation: Record<string, string>
      status: string
      version: number
      created_at: Date
      updated_at: Date
    }>(
      `SELECT widget_id, type, spec_version, spec, validation, status, version, created_at, updated_at
       FROM widget_specs WHERE section_id = $1 ORDER BY created_at, widget_id`,
      [sectionId],
    )
    return {
      widgets: rows.map(row => ({
        widgetId: row.widget_id,
        type: row.type,
        specVersion: row.spec_version,
        specBytes: Buffer.byteLength(JSON.stringify(row.spec)),
        validation: row.validation,
        status: row.status,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    }
  }

  async createWidget(sectionId: string, input: unknown): Promise<{
    widgetId: string
    validation: Record<string, 'pass'>
    status: string
  }> {
    parseSectionId(sectionId)
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw badRequest('request body must be a JSON object')
    }
    const body = input as Record<string, unknown>
    const type = body.type
    if (typeof type !== 'string' || !isWidgetType(type)) throw badRequest('type is not in the frozen whitelist')
    if (body.specVersion !== WIDGET_SPEC_VERSION) throw badRequest(`specVersion must be ${WIDGET_SPEC_VERSION}`)
    const spec = validateSpec(type, body.spec)
    const assertions = validateAssertions(type, body.assertions)
    const citations = body.citations === undefined ? [] : validateCitations(body.citations)

    const section = await this.requireSection(sectionId)
    await this.assertCourseDraft(section.course_id)
    if (citations.length > 0) await this.assertCount('source_units', 'unit_id', citations, 'citations contain unknown source unit')
    const conceptNames = await this.conceptNameSet(section.course_id)
    const proof = proveWidget(type, spec, assertions, { conceptNames })
    if (!proof.ok) {
      throw codedConflict('assertion_unproven', 'widget assertions failed server-side proof', { failed: proof.failed })
    }
    const id = wgtId()
    const { rows } = await this.pool.query<{ status: string }>(
      `INSERT INTO widget_specs (widget_id, section_id, course_id, type, spec_version, spec,
                                 assertions, validation, citations)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
       RETURNING status`,
      [
        id,
        sectionId,
        section.course_id,
        type,
        WIDGET_SPEC_VERSION,
        JSON.stringify(spec),
        JSON.stringify(assertions),
        JSON.stringify(proof.validation),
        JSON.stringify(citations),
      ],
    )
    const widgetRow = rows[0]
    if (widgetRow === undefined) throw new Error('widget insert returned no row')
    return { widgetId: id, validation: proof.validation, status: widgetRow.status }
  }

  /** 管理端纠错删除：草稿/已发布均可（清探针、误建课件）；widget 不在该节下视同不存在。 */
  async deleteWidget(sectionId: string, widgetId: string): Promise<void> {
    parseSectionId(sectionId)
    if (!/^wgt_[0-9a-f]{16}$/.test(widgetId)) throw badRequest('widgetId invalid')
    const { rowCount } = await this.pool.query(
      'DELETE FROM widget_specs WHERE widget_id = $1 AND section_id = $2',
      [widgetId, sectionId],
    )
    if ((rowCount ?? 0) === 0) throw notFound('widget not found in section')
  }

  /** 节级图示写入（§6.6.2）：keyframe 抽帧 / diagram 模板 SVG；配额分路，自动选定。 */
  async createSectionFigure(sectionId: string, input: unknown): Promise<SectionFigureResult> {
    parseSectionId(sectionId)
    if (this.deps.figureStore === undefined) throw serviceUnavailable('figure storage is not enabled')
    const parsed = parseSectionFigureInput(input)
    const section = await this.requireSection(sectionId)
    await this.assertCourseDraft(section.course_id)
    if (parsed.kind === 'keyframe') await this.assertAssetExists(parsed.assetId)
    return writeSectionFigure(
      {
        pool: this.pool,
        figureStore: this.deps.figureStore,
        ...(this.deps.keyframeRoot === undefined ? {} : { keyframeRoot: this.deps.keyframeRoot }),
        ...(this.deps.extractKeyframe === undefined ? {} : { extractKeyframe: this.deps.extractKeyframe }),
      },
      { sectionId, courseId: section.course_id, chapterId: section.chapter_id },
      parsed,
    )
  }

  async listSectionFigures(sectionId: string): Promise<{ figures: SectionFigureEntry[] }> {
    parseSectionId(sectionId)
    return { figures: await querySectionFigures(this.pool, sectionId) }
  }

  /** 节级案例股清单写入（§6.6.3）：生产端抽取，云端复检代号/窗口/事件锚点后落库；同节同代号覆盖。 */
  async upsertSectionCaseStocks(sectionId: string, input: unknown): Promise<{ saved: CaseStockSaveResult[] }> {
    parseSectionId(sectionId)
    const stocks = parseCaseStocksInput(input)
    const section = await this.requireSection(sectionId)
    await this.assertCourseDraft(section.course_id)
    return { saved: await writeCaseStocks(this.pool, { sectionId, courseId: section.course_id }, stocks) }
  }

  async listSectionCaseStocks(sectionId: string): Promise<{ stocks: CaseStockEntry[] }> {
    parseSectionId(sectionId)
    await this.requireSection(sectionId)
    return { stocks: await queryCaseStocks(this.pool, sectionId) }
  }

  async reportProvenance(input: {
    taskKey: string
    model: string
    provider?: string
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    latencyMs?: number
    status: 'success' | 'error'
    errorCode?: string
    skillVersions?: Record<string, string>
    targetId?: string
    summary?: Record<string, unknown>
  }): Promise<{ runId: string; usageId: string }> {
    if (!isProducerTaskKey(input.taskKey)) throw badRequest('taskKey must be a producer task key')
    return this.deps.usage.recordProducer({
      taskKey: input.taskKey,
      model: input.model,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
      ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens }),
      ...(input.cachedTokens === undefined ? {} : { cachedTokens: input.cachedTokens }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      status: input.status,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.skillVersions === undefined ? {} : { skillVersions: input.skillVersions }),
      ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
    })
  }

  async assertAssetExists(assetId: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 FROM media_assets WHERE asset_id = $1', [assetId])
    if (rows.length === 0) throw notFound('media asset not found')
  }

  /** 向量化尽力而为：provider 未配置或上游失败一律退纯词法，不阻断草稿写入与检索。 */
  private async embedQuietly(text: string, task: 'embedding.segment' | 'embedding.query'): Promise<number[] | undefined> {
    try {
      const provider = await this.deps.embedding.resolve(task)
      return provider === undefined ? undefined : await provider(text)
    } catch {
      return undefined
    }
  }

  /** 补向量：只取 embedding IS NULL 的 units，分批可重入（断点即 NULL 本身）；失败单位保持 NULL 供下次重试。 */
  async reindexSourceUnits(limit: number): Promise<{ embedded: number; failed: number; remaining: number }> {
    const embed = await this.deps.embedding.resolve('embedding.segment')
    if (embed === undefined) throw conflict('embedding provider not configured')
    const { rows } = await this.pool.query<{ unit_id: string; summary: string }>(
      'SELECT unit_id, summary FROM source_units WHERE embedding IS NULL ORDER BY unit_id LIMIT $1',
      [limit],
    )
    let embedded = 0
    let failed = 0
    const CONCURRENCY = 4
    for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
      await Promise.all(rows.slice(offset, offset + CONCURRENCY).map(async row => {
        try {
          const vector = toVectorLiteral(await embed(row.summary))
          const { rowCount } = await this.pool.query(
            'UPDATE source_units SET embedding = $2::halfvec WHERE unit_id = $1 AND embedding IS NULL',
            [row.unit_id, vector],
          )
          if ((rowCount ?? 0) === 1) embedded += 1
          else failed += 1
        } catch {
          failed += 1
        }
      }))
    }
    const { rows: remainRows } = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM source_units WHERE embedding IS NULL',
    )
    return { embedded, failed, remaining: Number(remainRows[0]?.count ?? 0) }
  }

  private async requireSection(sectionId: string): Promise<{
    section_id: string
    course_id: string
    chapter_id: string
    title: string
    position: number
    status: string
    summary: string | null
    concept_refs: unknown
  }> {
    const { rows } = await this.pool.query<{
      section_id: string
      course_id: string
      chapter_id: string
      title: string
      position: number
      status: string
      summary: string | null
      concept_refs: unknown
    }>(
      `SELECT section_id, course_id, chapter_id, title, position, status, summary, concept_refs
       FROM sections WHERE section_id = $1`,
      [sectionId],
    )
    const sectionRow = rows[0]
    if (sectionRow === undefined) throw notFound('section not found')
    return sectionRow
  }

  private async assertCourseDraft(courseId: string): Promise<void> {
    const row = await this.courseRow(courseId)
    if (row === undefined) throw notFound('course not found')
    if (row.status !== 'draft') throw conflict('course is not draft')
  }

  private async assertCourseRow(courseId: string): Promise<void> {
    const row = await this.courseRow(courseId)
    if (row === undefined) throw notFound('course not found')
  }

  private async courseRow(courseId: string): Promise<{ status: string } | undefined> {
    const { rows } = await this.pool.query<{ status: string }>(
      'SELECT status FROM courses WHERE course_id = $1',
      [courseId],
    )
    return rows[0]
  }

  private async assertChapterInCourse(courseId: string, chapterId: string): Promise<void> {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM chapters WHERE course_id = $1 AND chapter_id = $2',
      [courseId, chapterId],
    )
    if (rows.length === 0) throw notFound('chapter not found in course')
  }

  private async assertCount(
    table: string,
    column: string,
    ids: string[],
    message: string,
    courseId?: string,
  ): Promise<void> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}
       WHERE ${column} = ANY($1::text[])${courseId === undefined ? '' : ' AND course_id = $2'}`,
      courseId === undefined ? [ids] : [ids, courseId],
    )
    const count = rows[0]?.count
    if (count === undefined || Number(count) !== new Set(ids).size) throw badRequest(message)
  }

  /** concepts 名称 + 别名并集：课件 spec 术语校验的基准（架构 §6.5.5 termsInConcepts）。 */
  private async conceptNameSet(courseId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ name: string; aliases: unknown }>(
      'SELECT name, aliases FROM concepts WHERE course_id = $1 AND status <> $2',
      [courseId, 'archived'],
    )
    const names = new Set<string>()
    for (const row of rows) {
      names.add(row.name)
      for (const alias of Array.isArray(row.aliases) ? row.aliases as unknown[] : []) {
        if (typeof alias === 'string') names.add(alias)
      }
    }
    return names
  }
}

/** RRF 融合（k=60），按各路理论最高分归一到 [0,1]，与 kb 召回栈同口径。 */
function fuseUnits(lists: SourceUnitRow[][]): SourceUnitDto[] {
  const k = 60
  const scores = new Map<string, { row: SourceUnitRow; score: number }>()
  const maxPerList = 1 / (k + 1)
  for (const list of lists) {
    list.forEach((row, index) => {
      const entry = scores.get(row.unit_id) ?? { row, score: 0 }
      entry.score += 1 / (k + index + 1)
      scores.set(row.unit_id, entry)
    })
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.row.unit_id.localeCompare(b.row.unit_id))
    .map(entry => ({ ...toUnit(entry.row), score: Number((entry.score / maxPerList).toFixed(4)) }))
}
