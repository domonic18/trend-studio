/**
 * 学员端节内容读取（M3b B6）：只放行「已发布课程的已发布节」的内容。
 *
 * 正文按 DSL 解析出片段卡时间窗——播放会话只允许落在已发布正文的 clip 窗内，
 * 防止学员端拿会话号去放正文之外的素材。
 */

import type { Pool } from 'pg'
import { DSL_VERSION, parseArticleDsl, type DslBlock, type DslErrorSink } from '@trend/contracts'
import type {
  CatalogCaseStockOutput,
  CatalogFigureOutput,
  CatalogSectionOutput,
  CatalogSectionSummary,
  CatalogWidgetOutput,
} from '@trend/contracts/catalog'
import { HttpError, codedConflict } from '../errors.js'

export const SECTION_ID = /^sec_[0-9a-f]{16}$/
export const ASSET_ID = /^asset_[0-9a-f]{16}$/
const MAX_WIDGETS_PER_SECTION = 20
const MAX_FIGURES_PER_SECTION = 20
const MAX_CASE_STOCKS_PER_SECTION = 20

/** 已发布正文的 DSL 解析失败 = 数据损坏，不是请求错误。 */
const storedArticleSink: DslErrorSink = {
  bad: message => {
    throw new HttpError(500, `stored section article invalid: ${message}`)
  },
  coded: (_code, message) => {
    throw new HttpError(500, `stored section article invalid: ${message}`)
  },
}

export function parseSectionId(raw: string): string {
  if (!SECTION_ID.test(raw)) throw new HttpError(400, 'sectionId invalid')
  return raw
}

export function parseAssetId(raw: string): string {
  if (!ASSET_ID.test(raw)) throw new HttpError(400, 'assetId invalid')
  return raw
}

interface SectionRow {
  section_id: string
  course_id: string
  chapter_id: string
  title: string
  position: number
}

interface ArticleRow {
  markdown: string
  version: number
  published_at: Date
}

interface WidgetRow {
  widget_id: string
  type: string
  spec_version: number
  version: number
  spec: Record<string, unknown>
  assertions: Record<string, unknown>
}

interface FigureRow {
  figure_id: string
  kind: string
  caption: string
  asset_id: string | null
  source_sec: number | null
  selected_candidate_id: string | null
  rel_path: string | null
}

interface CaseStockRow {
  code: string
  name: string
  exchange: string
  window_start: Date | string
  window_end: Date | string
  events: unknown[]
}

function toDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

async function publishedSection(pool: Pool, courseId: string, sectionId: string): Promise<SectionRow> {
  const { rows } = await pool.query<SectionRow>(
    `SELECT s.section_id, s.course_id, s.chapter_id, s.title, s.position
       FROM sections s
       JOIN courses c ON c.course_id = s.course_id AND c.status = 'published'
      WHERE s.course_id = $1 AND s.section_id = $2 AND s.status = 'published'`,
    [courseId, sectionId],
  )
  const row = rows[0]
  if (row === undefined) throw new HttpError(404, 'section not found')
  return row
}

/** 按节 ID 定位已发布节（播放端点路径里没有 courseId）。 */
async function publishedSectionById(pool: Pool, sectionId: string): Promise<SectionRow> {
  const { rows } = await pool.query<SectionRow>(
    `SELECT s.section_id, s.course_id, s.chapter_id, s.title, s.position
       FROM sections s
       JOIN courses c ON c.course_id = s.course_id AND c.status = 'published'
      WHERE s.section_id = $1 AND s.status = 'published'`,
    [sectionId],
  )
  const row = rows[0]
  if (row === undefined) throw new HttpError(404, 'section not found')
  return row
}

/** 课程树里的节摘要：只统计已发布内容。 */
export async function readSectionSummaries(pool: Pool, courseId: string): Promise<CatalogSectionSummary[]> {
  const { rows } = await pool.query<{
    section_id: string
    title: string
    position: number
    has_article: boolean
    figure_count: number
    widget_types: string[]
    case_stock_codes: string[]
  }>(
    `SELECT s.section_id, s.title, s.position,
            EXISTS(
              SELECT 1 FROM section_articles a
              WHERE a.section_id = s.section_id AND a.status = 'published'
            ) AS has_article,
            (SELECT count(*)::int FROM figures f
              WHERE f.section_id = s.section_id AND f.status = 'published') AS figure_count,
            COALESCE((
              SELECT array_agg(DISTINCT w.type) FROM widget_specs w
              WHERE w.section_id = s.section_id AND w.status = 'published'
            ), '{}') AS widget_types,
            COALESCE((
              SELECT array_agg(DISTINCT c.code) FROM section_case_stocks c
              WHERE c.section_id = s.section_id AND c.status = 'published'
            ), '{}') AS case_stock_codes
       FROM sections s
      WHERE s.course_id = $1 AND s.status = 'published'
      ORDER BY s.chapter_id, s.position, s.section_id`,
    [courseId],
  )
  return rows.map(row => ({
    sectionId: row.section_id,
    title: row.title,
    position: row.position,
    hasArticle: row.has_article,
    figureCount: row.figure_count,
    widgetTypes: [...row.widget_types].sort(),
    caseStockCodes: [...row.case_stock_codes].sort(),
  }))
}

export async function readSection(
  pool: Pool,
  courseId: string,
  sectionId: string,
  signFigure: (relPath: string) => string,
): Promise<CatalogSectionOutput> {
  const section = await publishedSection(pool, courseId, sectionId)

  const { rows: articleRows } = await pool.query<ArticleRow>(
    `SELECT markdown, version, published_at
       FROM section_articles
      WHERE section_id = $1 AND status = 'published'`,
    [sectionId],
  )
  const articleRow = articleRows[0]
  const article = articleRow === undefined
    ? null
    : {
      markdown: articleRow.markdown,
      dslVersion: DSL_VERSION,
      version: articleRow.version,
      publishedAt: articleRow.published_at.getTime(),
    }

  const { rows: widgetRows } = await pool.query<WidgetRow>(
    `SELECT widget_id, type, spec_version, version, spec, assertions
       FROM widget_specs
      WHERE section_id = $1 AND status = 'published'
      ORDER BY created_at, widget_id
      LIMIT $2`,
    [sectionId, MAX_WIDGETS_PER_SECTION + 1],
  )
  if (widgetRows.length > MAX_WIDGETS_PER_SECTION) throw new HttpError(500, 'too many widgets in section')
  const widgets: CatalogWidgetOutput[] = widgetRows.map(row => ({
    widgetId: row.widget_id,
    type: row.type,
    specVersion: row.spec_version,
    version: row.version,
    spec: row.spec,
    assertions: row.assertions,
  }))

  const { rows: figureRows } = await pool.query<FigureRow>(
    `SELECT f.figure_id, f.kind, f.caption, f.asset_id, f.source_sec, f.selected_candidate_id,
            c.rel_path
       FROM figures f
       LEFT JOIN figure_candidates c
         ON c.candidate_id = f.selected_candidate_id AND c.status = 'ready'
      WHERE f.section_id = $1 AND f.status = 'published'
      ORDER BY f.created_at, f.figure_id
      LIMIT $2`,
    [sectionId, MAX_FIGURES_PER_SECTION + 1],
  )
  if (figureRows.length > MAX_FIGURES_PER_SECTION) throw new HttpError(500, 'too many figures in section')
  const figures: CatalogFigureOutput[] = figureRows.map(row => {
    const url = row.rel_path === null ? null : signFigure(row.rel_path)
    return {
      figureId: row.figure_id,
      kind: row.kind,
      caption: row.caption,
      assetId: row.asset_id,
      sourceSec: row.source_sec,
      candidateId: row.selected_candidate_id,
      url,
    }
  })

  const { rows: caseStockRows } = await pool.query<CaseStockRow>(
    `SELECT code, name, exchange, window_start, window_end, events
       FROM section_case_stocks
      WHERE section_id = $1 AND status = 'published'
      ORDER BY position, code
      LIMIT $2`,
    [sectionId, MAX_CASE_STOCKS_PER_SECTION + 1],
  )
  if (caseStockRows.length > MAX_CASE_STOCKS_PER_SECTION) {
    throw new HttpError(500, 'too many case stocks in section')
  }
  const caseStocks: CatalogCaseStockOutput[] = caseStockRows.map(row => ({
    code: row.code,
    name: row.name,
    exchange: row.exchange as CatalogCaseStockOutput['exchange'],
    windowStart: toDate(row.window_start),
    windowEnd: toDate(row.window_end),
    events: row.events,
  }))

  return {
    sectionId: section.section_id,
    courseId: section.course_id,
    chapterId: section.chapter_id,
    title: section.title,
    position: section.position,
    article,
    widgets,
    figures,
    caseStocks,
  }
}

/** 已发布正文里的片段卡时间窗。 */
export interface ClipWindow {
  assetId: string
  fromSec: number
  toSec: number
}

export function clipWindows(markdown: string): ClipWindow[] {
  const parsed = parseArticleDsl(markdown, storedArticleSink)
  const windows: ClipWindow[] = []
  for (const block of parsed.blocks as DslBlock[]) {
    if (block.directive !== 'clip') continue
    const assetId = block.attrs.assetId
    const from = Number(block.attrs.from)
    const to = Number(block.attrs.to)
    if (assetId === undefined || !Number.isInteger(from) || !Number.isInteger(to)) continue
    windows.push({ assetId, fromSec: from, toSec: to })
  }
  return windows
}

/**
 * 播放窗校验：请求窗必须完整落在该节已发布正文的某个 clip 窗内。
 * 越窗一律 409 playback_window_invalid（含素材不匹配与窗超界两种情形）。
 */
export async function resolveClipWindow(
  pool: Pool,
  sectionId: string,
  assetId: string,
  fromSec: number,
  toSec: number,
): Promise<ClipWindow> {
  await publishedSectionById(pool, sectionId)
  const { rows } = await pool.query<ArticleRow>(
    `SELECT markdown, version, published_at
       FROM section_articles
      WHERE section_id = $1 AND status = 'published'`,
    [sectionId],
  )
  const article = rows[0]
  if (article === undefined) {
    throw codedConflict('playback_window_invalid', 'section has no published article')
  }
  const windows = clipWindows(article.markdown).filter(window => window.assetId === assetId)
  const match = windows.find(window => fromSec >= window.fromSec && toSec <= window.toSec)
  if (match === undefined) {
    throw codedConflict('playback_window_invalid', 'playback window is outside the published clip window')
  }
  return match
}
