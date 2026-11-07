import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Empty, List, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { getCourseReadiness } from '../../api'
import { qk } from '../../lib/queryKeys'
import { gateIssueText } from '../../lib/publishErrors'
import type { CourseReadiness, ReadinessGateStatus } from '../../types'

const STATUS_TEXT: Record<ReadinessGateStatus, string> = {
  pass: '通过',
  fail: '未通过',
  pending: '待办',
}

const STATUS_COLOR: Record<ReadinessGateStatus, string> = {
  pass: 'green',
  fail: 'red',
  pending: 'orange',
}

/**
 * 发布就绪度卡片：五道门禁 + 当前指纹 + 待办。
 *
 * 门禁集合与发布事务同源——卡片全绿却点发布报 409，是两套判定漂移的典型症状。
 */
export function ReadinessCard({ courseId }: { courseId: string }) {
  const readiness = useQuery({
    queryKey: qk.readiness(courseId),
    queryFn: () => getCourseReadiness(courseId),
  })

  return (
    <Card
      title="发布就绪度"
      extra={<FingerprintTag readiness={readiness.data} />}
    >
      {readiness.isLoading ? (
        <div className="page-loading"><Spin /></div>
      ) : readiness.isError || readiness.data === undefined ? (
        <Empty description="就绪度加载失败" />
      ) : (
        <ReadinessBody readiness={readiness.data} />
      )}
    </Card>
  )
}

function FingerprintTag({ readiness }: { readiness: CourseReadiness | undefined }) {
  if (readiness === undefined) return null
  const signed = readiness.approvedFingerprint === readiness.fingerprint
  return (
    <Tooltip title={`当前内容指纹 ${readiness.fingerprint}`}>
      <Space size={8}>
        <Typography.Text type="secondary">指纹 {readiness.fingerprint.slice(0, 16)}</Typography.Text>
        <Tag bordered={false} color={signed ? 'green' : 'orange'}>
          {signed ? '签批有效' : readiness.approvedFingerprint === null ? '未签批' : '签批已失效'}
        </Tag>
      </Space>
    </Tooltip>
  )
}

function ReadinessBody({ readiness }: { readiness: CourseReadiness }) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type={readiness.publishable ? 'success' : 'warning'}
        showIcon
        message={readiness.publishable ? '全部门禁通过，可签批发布' : '尚不可发布'}
        description={readiness.pending.length > 0 ? readiness.pending.join('；') : '无待办'}
      />
      <List
        size="small"
        dataSource={readiness.gates}
        renderItem={gate => (
          <List.Item>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space wrap>
                <Tag bordered={false} color={STATUS_COLOR[gate.status]}>{STATUS_TEXT[gate.status]}</Tag>
                <Typography.Text strong>{gate.label}</Typography.Text>
                <Typography.Text type="secondary">{gate.summary}</Typography.Text>
              </Space>
              {gate.issues.map(issue => (
                <Typography.Text key={`${gate.gate}-${issue.code}-${issue.targets?.join(',') ?? ''}`} type="secondary">
                  {gateIssueText(issue.code)}
                  {issue.targets !== undefined && issue.targets.length > 0
                    ? `（${issue.targets.join('、')}）`
                    : ''}
                </Typography.Text>
              ))}
            </Space>
          </List.Item>
        )}
      />
    </Space>
  )
}
