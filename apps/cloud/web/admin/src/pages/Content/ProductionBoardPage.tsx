import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftOutlined,
  CloudSyncOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { App, Button, Card, Empty, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProductionBoard, syncCourseQuotes } from '../../api'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader } from '../../components/PageHeader'
import { qk } from '../../lib/queryKeys'
import { quotesSyncErrorText, taskErrorText } from '../../lib/productionErrors'
import {
  PRODUCTION_STEPS,
  PRODUCTION_STEP_LABELS,
  PRODUCTION_TASK_STATUS_COLORS,
  PRODUCTION_TASK_STATUS_LABELS,
} from '../../lib/productionSteps'
import type { ProductionBoardSection, ProductionStep, ProductionTaskItem } from '../../types'

const REVIEW_LABELS: Record<string, string> = { approve: '通过', reject: '未通过' }
const REVIEW_COLORS: Record<string, string> = { approve: 'green', reject: 'red' }

const CHOICE_LABELS: Record<string, string> = {
  A: '只补这节',
  B: '重做课程骨架',
  C: '只入库',
}

/** 当前步 = 九步里第一个没做完的（与生产端引擎同一口径：状态非 done 即未完成）。 */
function currentStep(steps: ProductionTaskItem[]): ProductionStep | null {
  const byStep = new Map(steps.map(task => [task.step, task]))
  for (const step of PRODUCTION_STEPS) {
    const task = byStep.get(step)
    if (task === undefined) return step
    if (task.status !== 'done') return step
  }
  return null
}

export function ProductionBoardPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const { user } = useAuth()

  /** 行情同步放开到 producer（只写行情缓存，不改内容状态）；学员看不到。 */
  const canSyncQuotes = user?.role === 'producer' || user?.role === 'operator' || user?.role === 'admin'

  const board = useQuery({
    queryKey: qk.productionBoard(courseId ?? ''),
    queryFn: () => getProductionBoard(courseId as string),
    enabled: courseId !== undefined,
  })

  const syncQuotes = useMutation({
    mutationFn: () => syncCourseQuotes(courseId as string),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: qk.productionBoard(courseId ?? '') })
      if (result.upserted === 0) {
        void message.warning('行情已同步，但没有写入任何日 K：该课程可能还没有案例股，或行情源暂无数据。')
        return
      }
      void message.success(`行情已同步：${result.upserted} 根日 K 落入缓存`)
    },
    onError: error => void message.error(quotesSyncErrorText(error)),
  })

  const summary = useMemo(() => {
    let done = 0
    let blocked = 0
    let failed = 0
    for (const section of board.data?.sections ?? []) {
      for (const task of section.steps) {
        if (task.status === 'done') done += 1
        if (task.status === 'blocked') blocked += 1
        if (task.status === 'failed') failed += 1
      }
    }
    return {
      sections: board.data?.sections.length ?? 0,
      done,
      blocked,
      failed,
    }
  }, [board.data])

  const columns = useMemo<ColumnsType<ProductionBoardSection>>(() => {
    const stepColumns = PRODUCTION_STEPS.map(step => ({
      title: PRODUCTION_STEP_LABELS[step],
      key: step,
      width: 96,
      render: (_: unknown, section: ProductionBoardSection) => {
        const task = section.steps.find(item => item.step === step)
        if (task === undefined) {
          return <Tag bordered={false}>未开始</Tag>
        }
        const tip = [
          `第 ${task.attempt}/${task.maxAttempts} 次尝试`,
          task.updatedAt > 0 ? `更新于 ${new Date(task.updatedAt).toLocaleString('zh-CN')}` : null,
          task.note,
        ].filter(line => line !== null && line !== '').join('\n')
        return (
          <Tooltip title={tip}>
            <Tag color={PRODUCTION_TASK_STATUS_COLORS[task.status]} bordered={false}>
              {PRODUCTION_TASK_STATUS_LABELS[task.status]}
            </Tag>
          </Tooltip>
        )
      },
    }))

    return [
      {
        title: '节',
        key: 'section',
        fixed: 'left',
        width: 200,
        render: (_: unknown, section: ProductionBoardSection) => (
          <div className="board-section-cell">
            <Typography.Text strong ellipsis>{section.title}</Typography.Text>
            <Typography.Text type="secondary">{section.sectionId}</Typography.Text>
          </div>
        ),
      },
      ...stepColumns,
      {
        title: '产出',
        key: 'outputs',
        width: 190,
        render: (_: unknown, section: ProductionBoardSection) => (
          <Space size={4} wrap>
            <Tag bordered={false}>正文 {section.articleVersion === null ? '—' : `v${section.articleVersion}`}</Tag>
            <Tag bordered={false}>课件 {section.widgetCount}</Tag>
            <Tag bordered={false}>图示 {section.figureCount}</Tag>
            <Tag bordered={false}>案例股 {section.caseStockCount}</Tag>
          </Space>
        ),
      },
      {
        title: '评审',
        key: 'review',
        width: 96,
        render: (_: unknown, section: ProductionBoardSection) =>
          section.reviewVerdict === null ? (
            <Tag bordered={false}>未评审</Tag>
          ) : (
            <Tag color={REVIEW_COLORS[section.reviewVerdict]} bordered={false}>
              {REVIEW_LABELS[section.reviewVerdict]}
            </Tag>
          ),
      },
      {
        title: '当前步',
        key: 'current',
        width: 110,
        render: (_: unknown, section: ProductionBoardSection) => {
          const step = currentStep(section.steps)
          return step === null ? (
            <Tag color="green" bordered={false}>已完成</Tag>
          ) : (
            <Tag bordered={false}>{PRODUCTION_STEP_LABELS[step]}</Tag>
          )
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 110,
        render: (_: unknown, section: ProductionBoardSection) => (
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/courses/${courseId}/sections/${section.sectionId}`)}
          >
            节预览
          </Button>
        ),
      },
    ]
  }, [courseId, navigate])

  return (
    <>
      <PageHeader
        title="生产看板"
        subtitle={`${board.data?.courseTitle ?? courseId ?? ''} · 九步生产进度、产出与评审结论`}
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void board.refetch()}>刷新</Button>
            {canSyncQuotes ? (
              <Tooltip title="同步案例股行情（日 K）——只写行情缓存，不改内容状态">
                <Button
                  icon={<CloudSyncOutlined />}
                  loading={syncQuotes.isPending}
                  onClick={() => syncQuotes.mutate()}
                >
                  同步行情
                </Button>
              </Tooltip>
            ) : null}
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/courses/${courseId}`)}>
              返回课程
            </Button>
          </Space>
        }
      />

      {board.isLoading ? (
        <div className="page-loading"><Spin /></div>
      ) : board.isError || board.data === undefined ? (
        <Card><Empty description={`看板加载失败：${taskErrorText(board.error)}`} /></Card>
      ) : (
        <>
          <div className="board-summary">
            <Tag bordered={false}>{summary.sections} 节</Tag>
            <Tag color="green" bordered={false}>已完成 {summary.done} 步</Tag>
            {summary.blocked > 0 ? (
              <Tag color="orange" bordered={false}>阻塞 {summary.blocked} 步</Tag>
            ) : null}
            {summary.failed > 0 ? (
              <Tag color="red" bordered={false}>失败 {summary.failed} 步</Tag>
            ) : null}
          </div>

          <Card title="九步进度" size="small">
            <Table<ProductionBoardSection>
              rowKey="sectionId"
              size="small"
              columns={columns}
              dataSource={board.data.sections}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该课程还没有节" /> }}
            />
          </Card>

          <Card title="追加素材决策" size="small" style={{ marginTop: 16 }}>
            {board.data.materialChoices.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无追加素材决策" />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {board.data.materialChoices.map(choice => (
                  <div key={choice.choiceId} className="board-choice-row">
                    <Tag color="blue" bordered={false}>{choice.choice} · {CHOICE_LABELS[choice.choice]}</Tag>
                    <Typography.Text type="secondary">{choice.assetId}</Typography.Text>
                    <Typography.Text type="secondary">
                      影响 {choice.affectedSectionIds.length} 节
                    </Typography.Text>
                    {choice.note === null ? null : (
                      <Typography.Text type="secondary">{choice.note}</Typography.Text>
                    )}
                    <Typography.Text type="secondary">
                      {new Date(choice.createdAt).toLocaleString('zh-CN')}
                    </Typography.Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </>
      )}
    </>
  )
}
