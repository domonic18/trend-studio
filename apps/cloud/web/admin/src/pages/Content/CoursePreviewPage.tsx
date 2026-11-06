import { useQuery } from '@tanstack/react-query'
import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CourseView } from '@trend/widgets/course'
import type { FigureMeta } from '@trend/widgets/course'
import '@trend/widgets/course.css'
import '@trend/widgets/widgets.css'
import { getCoursePreview } from '../../api'
import { PageHeader } from '../../components/PageHeader'
import { createCourseHost } from '../../lib/courseHost'
import { toCoursePreviewView } from '../../lib/courseView'
import { qk } from '../../lib/queryKeys'

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
  const view = toCoursePreviewView(data)
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
