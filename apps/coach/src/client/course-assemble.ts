import type {
  ArticleView,
  CaseStockEvent,
  CaseStockView,
  ChapterViewModel,
  CoursePreviewView,
  FigureMeta,
  FigureView,
  SectionMeta,
  SectionViewModel,
  WidgetView,
} from '@trend/widgets/course'
import type { CatalogCaseStock, CatalogCourse, CatalogFigure, CatalogSection, CatalogWidget } from '../shared/contracts.js'

/** 图示签名地址随节载荷下发，课程级宿主按 figureId 汇总。 */
export interface SignedFigure extends FigureMeta {
  url: string | null
}

function toCaseStockEvents(stock: CatalogCaseStock): CaseStockEvent[] {
  const events: CaseStockEvent[] = []
  for (const raw of stock.events) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const date = record.date
    const label = record.label
    const unitId = record.unitId
    if (typeof date !== 'string' || typeof label !== 'string' || typeof unitId !== 'string') continue
    events.push({ date, label, unitId })
  }
  return events
}

function toFigureView(figure: CatalogFigure, sectionId: string): FigureView {
  return {
    figureId: figure.figureId,
    kind: figure.kind,
    caption: figure.caption,
    status: 'published',
    selectedCandidateId: figure.candidateId,
    spec: null,
    sectionId,
  }
}

function toWidgetView(widget: CatalogWidget): WidgetView {
  return {
    widgetId: widget.widgetId,
    type: widget.type,
    specVersion: widget.specVersion,
    spec: widget.spec,
    assertions: widget.assertions,
    validation: {},
    status: 'published',
    version: widget.version,
    createdAt: '',
  }
}

function toCaseStockView(stock: CatalogCaseStock, position: number): CaseStockView {
  return {
    stockRefId: stock.code,
    name: stock.name,
    exchange: stock.exchange,
    code: stock.code,
    windowStart: stock.windowStart,
    windowEnd: stock.windowEnd,
    events: toCaseStockEvents(stock),
    note: null,
    status: 'published',
    position,
  }
}

function toArticleView(section: CatalogSection): ArticleView | null {
  if (section.article === null) return null
  return {
    markdown: section.article.markdown,
    citations: [],
    version: section.article.version,
    status: 'published',
    dslVersion: section.article.dslVersion,
  }
}

/**
 * 把学员端目录 + 节详情装配成共享课程视图模型。
 * 章节归属取节详情自带的 chapterId（节摘要不下发章节归属）。
 */
export function assembleCourseView(
  course: CatalogCourse,
  sections: CatalogSection[],
): CoursePreviewView {
  const byChapter = new Map<string, SectionViewModel[]>()
  for (const section of sections) {
    const meta: SectionMeta = {
      sectionId: section.sectionId,
      courseId: section.courseId,
      chapterId: section.chapterId,
      title: section.title,
      position: section.position,
      status: 'published',
      ...(section.summary === undefined ? {} : { summary: section.summary }),
      conceptRefs: [],
      ...(section.conceptNames === undefined ? {} : { conceptNames: section.conceptNames }),
    }
    const view: SectionViewModel = {
      section: meta,
      article: toArticleView(section),
      widgets: section.widgets.map(toWidgetView),
      figures: section.figures.map(figure => toFigureView(figure, section.sectionId)),
      caseStocks: section.caseStocks.map(toCaseStockView),
    }
    const list = byChapter.get(section.chapterId) ?? []
    list.push(view)
    byChapter.set(section.chapterId, list)
  }

  const chapters: ChapterViewModel[] = course.chapters.map(chapter => ({
    chapterId: chapter.chapterId,
    title: chapter.title,
    position: chapter.position,
    sections: (byChapter.get(chapter.chapterId) ?? [])
      .slice()
      .sort((a, b) => a.section.position - b.section.position),
  }))

  return {
    course: { courseId: course.courseId, title: course.title, status: 'published' },
    chapters,
  }
}

/** 汇总全部节的图示签名地址，供课程级宿主解析 `:::figure` 引用。 */
export function collectSignedFigures(sections: CatalogSection[]): Map<string, SignedFigure> {
  const map = new Map<string, SignedFigure>()
  for (const section of sections) {
    for (const figure of section.figures) {
      map.set(figure.figureId, {
        figureId: figure.figureId,
        caption: figure.caption,
        kind: figure.kind,
        selectedCandidateId: figure.candidateId,
        url: figure.url,
      })
    }
  }
  return map
}
