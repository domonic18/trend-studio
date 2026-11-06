/** 管理台 DTO → 共享渲染视图模型（学员端同一套组件）。 */

import type { CoursePreviewView, SectionViewModel } from '@trend/widgets/course'
import type { CoursePreview, CoursePreviewSection } from '../types'

export function toCoursePreviewView(dto: CoursePreview): CoursePreviewView {
  return {
    course: {
      courseId: dto.course.courseId,
      title: dto.course.title,
      status: dto.course.status as 'draft' | 'published' | 'archived',
    },
    chapters: dto.chapters.map(ch => ({
      chapterId: ch.chapterId,
      title: ch.title,
      position: ch.position,
      sections: ch.sections.map(toSectionModel),
    })),
  }
}

export function toSectionModel(sec: CoursePreviewSection): SectionViewModel {
  return {
    section: {
      sectionId: sec.section.sectionId,
      courseId: sec.section.courseId,
      chapterId: sec.section.chapterId,
      title: sec.section.title,
      position: sec.section.position,
      status: sec.section.status as 'draft' | 'published' | 'archived',
      summary: sec.section.summary,
      conceptRefs: sec.section.conceptRefs,
    },
    article:
      sec.article === null
        ? null
        : {
            markdown: sec.article.markdown,
            citations: sec.article.citations,
            version: sec.article.version,
            status: sec.article.status as 'draft' | 'published' | 'archived',
            dslVersion: sec.article.dslVersion,
          },
    widgets: sec.widgets.map(w => ({
      widgetId: w.widgetId,
      type: w.type,
      specVersion: w.specVersion,
      spec: w.spec,
      assertions: w.assertions,
      validation: w.validation,
      status: w.status as 'draft' | 'published' | 'archived',
      version: w.version,
      createdAt: w.createdAt,
    })),
    figures: sec.figures.map(f => ({
      figureId: f.figureId,
      kind: f.kind,
      caption: f.caption,
      status: f.status,
      selectedCandidateId: f.selectedCandidateId,
      spec: f.spec,
      sectionId: f.sectionId,
    })),
    caseStocks: sec.caseStocks.map(s => ({
      stockRefId: s.stockRefId,
      name: s.name,
      exchange: s.exchange as 'SZSE' | 'SSE' | 'BSE',
      code: s.code,
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      events: Array.isArray(s.events)
        ? s.events.map((e: unknown) => ({
            date: typeof (e as { date?: unknown }).date === 'string' ? (e as { date: string }).date : '',
            label: typeof (e as { label?: unknown }).label === 'string' ? (e as { label: string }).label : '',
            unitId: typeof (e as { unitId?: unknown }).unitId === 'string' ? (e as { unitId: string }).unitId : '',
          }))
        : [],
      note: s.note,
      status: s.status as 'draft' | 'published' | 'archived',
      position: s.position,
    })),
  }
}
