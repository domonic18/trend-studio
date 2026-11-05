/**
 * 课程内容指纹（M3b 审批版本绑定）：规范 JSON → sha256。
 * 审批签批时算一次存进审批记录，发布时重算比对——内容变了必须重新签批。
 * 覆盖全部会被发布的内容：章节教材/图示/片段 + 节教材/课件/图示/案例股。
 */

import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { markdownDslVersion, type DslErrorSink } from '@trend/contracts'
import { HttpError } from '../errors.js'

export const DIGEST_VERSION = 1

/** 指纹阶段的正文解析失败 = 已存内容损坏（500），不是请求错误。 */
const digestSink: DslErrorSink = {
  bad: message => {
    throw new HttpError(500, `stored section article invalid: ${message}`)
  },
  coded: (_code, message) => {
    throw new HttpError(500, `stored section article invalid: ${message}`)
  },
  conflict: (_code, message) => {
    throw new HttpError(500, `stored section article invalid: ${message}`)
  },
}

export interface ChapterArticleDigest {
  markdown: string
}

export interface SegmentDigest {
  segmentId: string
  title: string
  startSec: number
  endSec: number
  text: string
}

export interface ArticleDigest {
  dslVersion: number
  markdown: string
  citations: string[]
}

export interface WidgetDigest {
  widgetId: string
  type: string
  specVersion: number
  spec: unknown
  assertions: unknown
}

export interface FigureDigest {
  figureId: string
  kind: string
  caption: string
  assetId: string | null
  sourceSec: number | null
  spec: unknown
}

export interface CaseStockDigest {
  code: string
  name: string
  exchange: string
  windowStart: string
  windowEnd: string
  events: unknown
}

export interface ChapterDigest {
  chapterId: string
  title: string
  sortOrder: number
  article: ChapterArticleDigest | null
  figures: FigureDigest[]
  segments: SegmentDigest[]
}

export interface SectionDigest {
  sectionId: string
  title: string
  sortOrder: number
  article: ArticleDigest | null
  widgets: WidgetDigest[]
  figures: FigureDigest[]
  caseStocks: CaseStockDigest[]
}

export interface CourseDigestManifest {
  v: number
  chapters: ChapterDigest[]
  sections: SectionDigest[]
}

export interface CourseDigest {
  digest: string
  manifest: CourseDigestManifest
  /** 每节单独指纹，便于定位「哪一节变了」。 */
  sectionDigests: Record<string, string>
}

/** 规范 JSON：对象键递归排序、无多余空白——同一内容必得同一字符串。 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function digestOfManifest(manifest: CourseDigestManifest): string {
  return sha256Hex(canonicalJson(manifest))
}

function sortedDistinct(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].sort()
}

interface FigureRow {
  figure_id: string
  section_id: string | null
  chapter_id: string
  kind: string
  caption: string
  asset_id: string | null
  source_sec: number | null
  spec: unknown
}

function toFigureDigest(row: FigureRow): FigureDigest {
  return {
    figureId: row.figure_id,
    kind: row.kind,
    caption: row.caption,
    assetId: row.asset_id,
    sourceSec: row.source_sec,
    spec: row.spec,
  }
}

/**
 * 课程内容指纹：只取内容、不取行版本计数——重存同一内容不应让已签批的课程失效。
 */
export async function computeCourseDigest(pool: Pool, courseId: string): Promise<CourseDigest> {
  const chapters = await loadChapters(pool, courseId)
  const sections = await loadSections(pool, courseId)
  const manifest: CourseDigestManifest = { v: DIGEST_VERSION, chapters, sections }
  const sectionDigests: Record<string, string> = {}
  for (const section of sections) sectionDigests[section.sectionId] = sha256Hex(canonicalJson(section))
  return { digest: digestOfManifest(manifest), manifest, sectionDigests }
}

async function loadChapters(pool: Pool, courseId: string): Promise<ChapterDigest[]> {
  const { rows: chapterRows } = await pool.query<{ chapter_id: string; title: string; position: number }>(
    'SELECT chapter_id, title, position FROM chapters WHERE course_id = $1 ORDER BY position, chapter_id',
    [courseId],
  )
  const chapters: ChapterDigest[] = chapterRows.map(row => ({
    chapterId: row.chapter_id,
    title: row.title,
    sortOrder: row.position,
    article: null,
    figures: [],
    segments: [],
  }))
  if (chapters.length === 0) return chapters
  const byChapter = new Map(chapters.map(chapter => [chapter.chapterId, chapter]))

  const { rows: articleRows } = await pool.query<{ chapter_id: string; markdown: string }>(
    `SELECT chapter_id, markdown FROM chapter_articles
      WHERE course_id = $1 AND status IN ('draft', 'published')`,
    [courseId],
  )
  for (const row of articleRows) {
    const chapter = byChapter.get(row.chapter_id)
    if (chapter !== undefined) chapter.article = { markdown: row.markdown }
  }

  const { rows: figureRows } = await pool.query<FigureRow>(
    `SELECT figure_id, section_id, chapter_id, kind, caption, asset_id, source_sec, spec
       FROM figures WHERE course_id = $1 AND section_id IS NULL ORDER BY figure_id`,
    [courseId],
  )
  for (const row of figureRows) {
    const chapter = byChapter.get(row.chapter_id)
    if (chapter !== undefined) chapter.figures.push(toFigureDigest(row))
  }

  const { rows: segmentRows } = await pool.query<{
    segment_id: string
    chapter_id: string
    title: string
    start_sec: number
    end_sec: number
    text: string
  }>(
    `SELECT segment_id, chapter_id, title, start_sec, end_sec, text FROM segments
      WHERE course_id = $1 AND status <> 'archived' ORDER BY segment_id`,
    [courseId],
  )
  for (const row of segmentRows) {
    const chapter = byChapter.get(row.chapter_id)
    if (chapter === undefined) continue
    chapter.segments.push({
      segmentId: row.segment_id,
      title: row.title,
      startSec: row.start_sec,
      endSec: row.end_sec,
      text: row.text,
    })
  }
  return chapters
}

async function loadSections(pool: Pool, courseId: string): Promise<SectionDigest[]> {
  const { rows: sectionRows } = await pool.query<{ section_id: string; title: string; position: number }>(
    `SELECT s.section_id, s.title, s.position
       FROM sections s
       JOIN chapters ch ON ch.course_id = s.course_id AND ch.chapter_id = s.chapter_id
      WHERE s.course_id = $1 AND s.status <> 'archived'
      ORDER BY ch.position, s.position, s.section_id`,
    [courseId],
  )
  const sections: SectionDigest[] = sectionRows.map(row => ({
    sectionId: row.section_id,
    title: row.title,
    sortOrder: row.position,
    article: null,
    widgets: [],
    figures: [],
    caseStocks: [],
  }))
  if (sections.length === 0) return sections
  const bySection = new Map(sections.map(section => [section.sectionId, section]))
  const sectionIds = sections.map(section => section.sectionId)

  const { rows: articleRows } = await pool.query<{ section_id: string; markdown: string; citations: unknown }>(
    `SELECT section_id, markdown, citations FROM section_articles
      WHERE section_id = ANY($1::text[]) AND status IN ('draft', 'published')`,
    [sectionIds],
  )
  for (const row of articleRows) {
    const section = bySection.get(row.section_id)
    if (section === undefined) continue
    section.article = {
      dslVersion: markdownDslVersion(row.markdown, digestSink),
      markdown: row.markdown,
      citations: sortedDistinct(row.citations),
    }
  }

  const { rows: widgetRows } = await pool.query<{
    widget_id: string
    section_id: string
    type: string
    spec_version: number
    spec: unknown
    assertions: unknown
  }>(
    `SELECT widget_id, section_id, type, spec_version, spec, assertions FROM widget_specs
      WHERE section_id = ANY($1::text[]) AND status IN ('draft', 'published')
      ORDER BY widget_id`,
    [sectionIds],
  )
  for (const row of widgetRows) {
    const section = bySection.get(row.section_id)
    if (section === undefined) continue
    section.widgets.push({
      widgetId: row.widget_id,
      type: row.type,
      specVersion: row.spec_version,
      spec: row.spec,
      assertions: row.assertions,
    })
  }

  const { rows: figureRows } = await pool.query<FigureRow>(
    `SELECT figure_id, section_id, chapter_id, kind, caption, asset_id, source_sec, spec
       FROM figures WHERE section_id = ANY($1::text[]) ORDER BY figure_id`,
    [sectionIds],
  )
  for (const row of figureRows) {
    const section = bySection.get(row.section_id ?? '')
    if (section === undefined) continue
    section.figures.push(toFigureDigest(row))
  }

  const { rows: stockRows } = await pool.query<{
    section_id: string
    code: string
    name: string
    exchange: string
    window_start: string
    window_end: string
    events: unknown
  }>(
    `SELECT section_id, code, name, exchange, window_start::text AS window_start,
            window_end::text AS window_end, events
       FROM section_case_stocks
      WHERE section_id = ANY($1::text[]) AND status <> 'archived'
      ORDER BY code`,
    [sectionIds],
  )
  for (const row of stockRows) {
    const section = bySection.get(row.section_id)
    if (section === undefined) continue
    section.caseStocks.push({
      code: row.code,
      name: row.name,
      exchange: row.exchange,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      events: row.events,
    })
  }
  return sections
}
