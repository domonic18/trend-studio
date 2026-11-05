/** M10 v2 管理台课程预览：课程树全量草稿态，供生产端所见即所得审阅。 */

import type { Pool } from 'pg'
import { markdownDslVersion } from '@trend/contracts'
import { HttpError } from '../errors.js'
import { cloudDslSink } from './dsl/sink.js'

export interface CoursePreview {
  course: {
    courseId: string
    title: string
    status: string
  }
  chapters: ChapterPreview[]
}

export interface ChapterPreview {
  chapterId: string
  title: string
  position: number
  sections: SectionPreview[]
}

export interface SectionPreview {
  section: {
    sectionId: string
    courseId: string
    chapterId: string
    title: string
    position: number
    status: string
    summary?: string
    conceptRefs: string[]
  }
  article: {
    markdown: string
    citations: string[]
    version: number
    status: string
    dslVersion: number
  } | null
  widgets: WidgetPreview[]
  figures: FigurePreview[]
  caseStocks: CaseStockPreview[]
}

export interface WidgetPreview {
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

export interface FigurePreview {
  figureId: string
  kind: string
  caption: string
  status: string
  selectedCandidateId: string | null
  spec: unknown
  sectionId: string | null
}

export interface CaseStockPreview {
  stockRefId: string
  name: string
  exchange: string
  code: string
  windowStart: string
  windowEnd: string
  events: unknown[]
  note: string | null
  status: string
  position: number
}

export async function readCoursePreview(pool: Pool, courseId: string): Promise<CoursePreview> {
  const { rows: courseRows } = await pool.query<{ course_id: string; title: string; status: string }>(
    'SELECT course_id, title, status FROM courses WHERE course_id = $1 AND status <> $2',
    [courseId, 'archived'],
  )
  const course = courseRows[0]
  if (course === undefined) throw new HttpError(404, 'course not found')

  const { rows: chapterRows } = await pool.query<{ chapter_id: string; title: string; position: number }>(
    'SELECT chapter_id, title, position FROM chapters WHERE course_id = $1 ORDER BY position, chapter_id',
    [courseId],
  )

  const { rows: sectionRows } = await pool.query<{
    section_id: string
    chapter_id: string
    title: string
    position: number
    status: string
    summary: string | null
    concept_refs: unknown
  }>(
    `SELECT section_id, chapter_id, title, position, status, summary, concept_refs
       FROM sections
      WHERE course_id = $1 AND status <> 'archived'
      ORDER BY position, section_id`,
    [courseId],
  )

  const sectionIds = sectionRows.map(row => row.section_id)
  const articles = sectionIds.length > 0 ? await loadArticles(pool, sectionIds) : new Map()
  const widgets = sectionIds.length > 0 ? await loadWidgets(pool, sectionIds) : new Map()
  const figures = sectionIds.length > 0 ? await loadFigures(pool, sectionIds) : new Map()
  const caseStocks = sectionIds.length > 0 ? await loadCaseStocks(pool, sectionIds) : new Map()

  const sectionsByChapter = new Map<string, SectionPreview[]>()
  for (const row of sectionRows) {
    const sectionId = row.section_id
    const preview: SectionPreview = {
      section: {
        sectionId,
        courseId,
        chapterId: row.chapter_id,
        title: row.title,
        position: row.position,
        status: row.status,
        ...(row.summary === null ? {} : { summary: row.summary }),
        conceptRefs: Array.isArray(row.concept_refs) ? row.concept_refs as string[] : [],
      },
      article: articles.get(sectionId) ?? null,
      widgets: widgets.get(sectionId) ?? [],
      figures: figures.get(sectionId) ?? [],
      caseStocks: caseStocks.get(sectionId) ?? [],
    }
    const list = sectionsByChapter.get(row.chapter_id) ?? []
    list.push(preview)
    sectionsByChapter.set(row.chapter_id, list)
  }

  return {
    course: { courseId: course.course_id, title: course.title, status: course.status },
    chapters: chapterRows.map(row => ({
      chapterId: row.chapter_id,
      title: row.title,
      position: row.position,
      sections: sectionsByChapter.get(row.chapter_id) ?? [],
    })),
  }
}

async function loadArticles(pool: Pool, sectionIds: string[]): Promise<Map<string, SectionPreview['article']>> {
  const { rows } = await pool.query<{
    section_id: string
    markdown: string
    citations: unknown
    version: number
    status: string
  }>(
    'SELECT section_id, markdown, citations, version, status FROM section_articles WHERE section_id = ANY($1::text[])',
    [sectionIds],
  )
  return new Map(rows.map(row => [row.section_id, {
    markdown: row.markdown,
    citations: Array.isArray(row.citations) ? row.citations as string[] : [],
    version: row.version,
    status: row.status,
    dslVersion: markdownDslVersion(row.markdown, cloudDslSink),
  }]))
}

async function loadWidgets(pool: Pool, sectionIds: string[]): Promise<Map<string, WidgetPreview[]>> {
  const { rows } = await pool.query<{
    section_id: string
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
    `SELECT section_id, widget_id, type, spec_version, spec, assertions, validation, status, version, created_at
       FROM widget_specs
      WHERE section_id = ANY($1::text[])
      ORDER BY created_at, widget_id`,
    [sectionIds],
  )
  const map = new Map<string, WidgetPreview[]>()
  for (const row of rows) {
    const list = map.get(row.section_id) ?? []
    list.push({
      widgetId: row.widget_id,
      type: row.type,
      specVersion: row.spec_version,
      spec: row.spec,
      assertions: row.assertions,
      validation: row.validation,
      status: row.status,
      version: row.version,
      createdAt: row.created_at.toISOString(),
    })
    map.set(row.section_id, list)
  }
  return map
}

async function loadFigures(pool: Pool, sectionIds: string[]): Promise<Map<string, FigurePreview[]>> {
  const { rows } = await pool.query<{
    section_id: string
    figure_id: string
    kind: string
    caption: string
    status: string
    selected_candidate_id: string | null
    spec: unknown
  }>(
    `SELECT section_id, figure_id, kind, caption, status, selected_candidate_id, spec
       FROM figures
      WHERE section_id = ANY($1::text[])
      ORDER BY created_at, figure_id`,
    [sectionIds],
  )
  const map = new Map<string, FigurePreview[]>()
  for (const row of rows) {
    const list = map.get(row.section_id) ?? []
    list.push({
      figureId: row.figure_id,
      kind: row.kind,
      caption: row.caption,
      status: row.status,
      selectedCandidateId: row.selected_candidate_id,
      spec: row.spec,
      sectionId: row.section_id,
    })
    map.set(row.section_id, list)
  }
  return map
}

async function loadCaseStocks(pool: Pool, sectionIds: string[]): Promise<Map<string, CaseStockPreview[]>> {
  const { rows } = await pool.query<{
    section_id: string
    stock_ref_id: string
    name: string
    exchange: string
    code: string
    window_start: string | Date
    window_end: string | Date
    events: unknown
    note: string | null
    status: string
    position: number
  }>(
    `SELECT section_id, stock_ref_id, name, exchange, code,
            window_start::text AS window_start, window_end::text AS window_end,
            events, note, status, position
       FROM section_case_stocks
      WHERE section_id = ANY($1::text[])
      ORDER BY position, stock_ref_id`,
    [sectionIds],
  )
  const map = new Map<string, CaseStockPreview[]>()
  for (const row of rows) {
    const list = map.get(row.section_id) ?? []
    list.push({
      stockRefId: row.stock_ref_id,
      name: row.name,
      exchange: row.exchange,
      code: row.code,
      windowStart: toDateStr(row.window_start),
      windowEnd: toDateStr(row.window_end),
      events: Array.isArray(row.events) ? row.events as unknown[] : [],
      note: row.note,
      status: row.status,
      position: row.position,
    })
    map.set(row.section_id, list)
  }
  return map
}

function toDateStr(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}
