import { useQuery } from '@tanstack/react-query'
import { ArrowLeftOutlined, EyeOutlined, PictureOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createAssetPlaybackSession, getCoursePreview, getFigureCandidateBlob, getSectionPreview } from '../../api'
import { PageHeader } from '../../components/PageHeader'
import { StatusTag } from '../../components/StatusTag'
import { qk } from '../../lib/queryKeys'
import { createCourseHost } from '../../lib/courseHost'
import { toSectionModel } from '../../lib/courseView'
import type { FigureBrief } from '../../types'
import { ArticleRenderer } from '@trend/widgets/article'
import { SectionView } from '@trend/widgets/course'
import type { ArticleHost, FigureMeta } from '@trend/widgets/types'
import '@trend/widgets/widgets.css'
import '@trend/widgets/course.css'
import { WidgetPlayer } from '../../widgets'

export function SectionPreviewPage() {
  const { courseId, sectionId } = useParams<{ courseId: string; sectionId: string }>()
  const navigate = useNavigate()

  const preview = useQuery({
    queryKey: qk.sectionPreview(sectionId ?? ''),
    queryFn: () => getSectionPreview(sectionId as string),
    enabled: sectionId !== undefined,
  })

  /** 课程预览载荷（含案例股与课件），用于按学员同款渲染本节。 */
  const coursePreview = useQuery({
    queryKey: qk.coursePreview(courseId ?? ''),
    queryFn: () => getCoursePreview(courseId as string),
    enabled: courseId !== undefined,
  })

  const courseSection = useMemo(
    () =>
      coursePreview.data?.chapters
        .flatMap(ch => ch.sections)
        .find(sec => sec.section.sectionId === sectionId),
    [coursePreview.data, sectionId],
  )

  const host = useMemo<ArticleHost>(() => {
    const figures = new Map<string, FigureMeta>()
    for (const figure of preview.data?.figures ?? []) {
      figures.set(figure.figureId, {
        figureId: figure.figureId,
        caption: figure.caption,
        kind: figure.kind,
        selectedCandidateId: figure.selectedCandidateId,
      })
    }
    return {
      figures,
      resolveFigureUrl: async figureId => {
        const candidateId = figures.get(figureId)?.selectedCandidateId
        if (candidateId === undefined || candidateId === null) throw new Error('figure unresolved')
        return getFigureCandidateBlob(candidateId)
      },
      createPlaybackSession: (assetId, fromSec, toSec) =>
        createAssetPlaybackSession(assetId, fromSec, toSec),
    }
  }, [preview.data])

  /** 学员同款渲染的宿主：图示 blob、行情加载、片段会话与课程预览页一致。 */
  const learnerHost = useMemo(() => {
    const figures = new Map<string, FigureMeta>()
    for (const figure of courseSection?.figures ?? []) {
      figures.set(figure.figureId, {
        figureId: figure.figureId,
        caption: figure.caption,
        kind: figure.kind,
        selectedCandidateId: figure.selectedCandidateId,
      })
    }
    return createCourseHost(courseId ?? '', figures)
  }, [courseId, courseSection])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(learnerHost as any).revokeFigureUrls?.()
    }
  }, [learnerHost])

  const back = (): void => {
    if (courseId !== undefined) navigate(`/courses/${courseId}`)
    else navigate('/courses')
  }

  if (sectionId === undefined) {
    return <Card><Empty description="缺少节 ID" /></Card>
  }
  if (preview.isLoading) return <div className="page-loading"><Spin /></div>
  if (preview.isError || preview.data === undefined) {
    return <Card><Empty description="节不存在或加载失败" /></Card>
  }

  const data = preview.data

  return (
    <>
      <PageHeader
        title={data.section.title}
        subtitle={`节预览 · ${data.section.sectionId}`}
        extra={
          <Space>
            <Button icon={<EyeOutlined />} onClick={() => navigate(`/courses/${courseId}/preview`)}>
              课程预览
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={back}>返回课程</Button>
          </Space>
        }
      />

      <div className="section-preview-meta">
        <Space wrap>
          <StatusTag value={data.section.status} />
          <Typography.Text type="secondary">位置 {data.section.position}</Typography.Text>
          {data.section.conceptRefs.map(ref => <Tag key={ref} color="blue">{ref}</Tag>)}
        </Space>
        {data.section.summary ? <Typography.Paragraph type="secondary">{data.section.summary}</Typography.Paragraph> : null}
      </div>

      <div className="section-preview-layout">
        <div className="section-preview-article">
          <Card title="教材（学员同款渲染）" size="small">
            {data.article === null ? (
              <Empty description="本节约无教材" />
            ) : courseSection === undefined ? (
              <>
                <Space wrap style={{ marginBottom: 8 }}>
                  <StatusTag value={data.article.status} />
                  <Typography.Text type="secondary">v{data.article.version}</Typography.Text>
                </Space>
                <ArticleRenderer markdown={data.article.markdown} host={host} />
              </>
            ) : (
              <SectionView section={toSectionModel(courseSection)} host={learnerHost} />
            )}
          </Card>
        </div>

        <div className="section-preview-side">
          <Card
            title={`课件明细（${data.widgets.length}）`}
            size="small"
            style={{ marginBottom: 16 }}
          >
            {data.widgets.length === 0 ? (
              <Empty description="本节约无课件" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {data.widgets.map(w => (
                  <WidgetPlayer key={w.widgetId} widget={w} resolveFigureUrl={host.resolveFigureUrl} />
                ))}
              </Space>
            )}
          </Card>

          <Card title={`图示（${data.figures.length}）`} size="small">
            {data.figures.length === 0 ? (
              <Empty description="本节约无图示" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {data.figures.map(f => <FigureThumb key={f.figureId} figure={f} />)}
              </Space>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

/** 节级图示缩略：取 selectedCandidateId 转 blob 渲染（与 FiguresDrawer 同生命周期处理）。 */
function FigureThumb({ figure }: { figure: FigureBrief }) {
  const blob = useQuery({
    queryKey: ['content', 'section-figure', figure.figureId, figure.selectedCandidateId],
    queryFn: () => getFigureCandidateBlob(figure.selectedCandidateId as string),
    enabled: figure.selectedCandidateId !== null,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })

  useEffect(() => {
    const url = blob.data
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [blob.data])

  return (
    <div className="section-figure">
      <div className="section-figure-head">
        <Space wrap>
          <PictureOutlined />
          <Typography.Text strong>{figure.caption}</Typography.Text>
          <Tag>{figure.figureId}</Tag>
          <Tag bordered={false}>{figure.kind}</Tag>
          <Tag color={figure.status === 'ready' ? 'green' : undefined}>{figure.status}</Tag>
        </Space>
      </div>
      {figure.selectedCandidateId === null ? (
        <Typography.Text type="secondary">尚未选定候选图</Typography.Text>
      ) : blob.isLoading ? (
        <Spin size="small" />
      ) : blob.data !== undefined ? (
        <img src={blob.data} alt={figure.caption} className="section-figure-img" />
      ) : (
        <Typography.Text type="danger">图加载失败</Typography.Text>
      )}
    </div>
  )
}
