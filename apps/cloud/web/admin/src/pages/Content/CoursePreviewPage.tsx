import { useQuery } from '@tanstack/react-query'
import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CourseView } from '@trend/widgets/course'
import type { CoursePreviewView, FigureMeta } from '@trend/widgets/course'
import '@trend/widgets/course.css'
import '@trend/widgets/widgets.css'
import { getCoursePreview } from '../../api'
import { PageHeader } from '../../components/PageHeader'
import { createCourseHost } from '../../lib/courseHost'
import { qk } from '../../lib/queryKeys'
import type { CoursePreview as CoursePreviewDto } from '../../types'

export function CoursePreviewPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()

  const preview = useQuery({
    queryKey: qk.coursePreview(courseId ?? ''),
    queryFn: () => getCoursePreview(courseId as string),
    enabled: courseId !== undefined,
  })

  const figureMap = useMemo(() => {
    const map = new Map<string, FigureMeta>()
    if (preview.data === undefined) return map
    for (const ch of preview.data.chapters) {
      for (const sec of ch.sections) {
        for (const f of sec.figures) {
          map.set(f.figureId, {
            figureId: f.figureId,
            caption: f.caption,
            kind: f.kind,
            selectedCandidateId: f.selectedCandidateId,
          })
        }
      }
    }
    return map
  }, [preview.data])

  const host = useMemo(() => createCourseHost(courseId ?? '', figureMap), [courseId, figureMap])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(host as any).revokeFigureUrls?.()
    }
  }, [host])

  if (courseId === undefined) {
    return (
      <Card>
        <Empty description="缺少课程 ID" />
      </Card>
    )
  }
  if (preview.isLoading) {
    return (
      <div className="page-loading">
        <Spin />
      </div>
    )
  }
  if (preview.isError || preview.data === undefined) {
    return (
      <Card>
        <Empty description="课程不存在或加载失败" />
      </Card>
    )
  }

  const data = preview.data
  const view = dtoToView(data)
  const hasDraft = view.chapters.some(ch =>
    ch.sections.some(sec => sec.section.status !== 'published' || sec.article?.status !== 'published'),
  )

  return (
    <>
      <PageHeader
        title={
          <span className="course-preview-header-title">
            {data.course.title}
            <Tag className="course-preview-status-tag" color={data.course.status === 'published' ? 'green' : 'default'}>
              {data.course.status === 'published' ? '已发布' : '草稿'}
            </Tag>
          </span>
        }
        subtitle="课程预览 · 仅生产端可见"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/courses/${courseId}`)}>
            返回编辑
          </Button>
        }
      />

      {hasDraft ? (
        <Alert
          className="course-preview-draft-alert"
          icon={<EyeOutlined />}
          message="草稿预览"
          description="本页包含未发布内容，仅运营与生产端账号可见；学员端不会看到草稿。"
          type="warning"
          showIcon
          closable
        />
      ) : null}

      <div className="course-preview-frame">
        <CourseView view={view} host={host} />
      </div>
    </>
  )
}

function dtoToView(dto: CoursePreviewDto): CoursePreviewView {
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
      sections: ch.sections.map(sec => ({
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
      })),
    })),
  }
}
