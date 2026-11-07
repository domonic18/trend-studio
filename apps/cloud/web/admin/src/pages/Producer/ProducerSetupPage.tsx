import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Input, Space, Spin, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getReleases } from '../../api'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader } from '../../components/PageHeader'
import { qk } from '../../lib/queryKeys'

/** 生产端默认模型位：与装机向导的默认值一致。 */
const MODEL_ID = 'MiniMax-M3.1-Flash'
const MODEL_API = 'openai-completions'

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
  student: '学员',
  producer: '生产端',
}

function Command({ children }: { children: string }) {
  return (
    <Typography.Paragraph
      copyable={{ text: children }}
      style={{ marginBottom: 0, fontSize: 13 }}
    >
      <code>{children}</code>
    </Typography.Paragraph>
  )
}

export function ProducerSetupPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const releases = useQuery({ queryKey: qk.releases, queryFn: getReleases })

  const origin = window.location.origin
  const dshVersion = releases.data?.dshVersion ?? '0.2.1-rc.5'
  const producer = releases.data?.producerPlugin
  const fileName = producer?.fileName ?? 'dsh-plugin-trend-producer-<版本号>.tgz'

  return (
    <div>
      <PageHeader
        title="生产端安装"
        subtitle="教员在自己的机器上装 harness 与生产端插件。下面是本页给出的参数与命令。"
        extra={(
          <Button
            icon={<FileTextOutlined />}
            href={`${origin}/teacher`}
            target="_blank"
            rel="noreferrer"
          >
            打开完整安装指南
          </Button>
        )}
      />

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card title="装机参数（已按本站与当前账号回填）">
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="云端地址">
              <Input defaultValue={origin} style={{ maxWidth: 360 }} />
            </Descriptions.Item>
            <Descriptions.Item label="当前账号">
              {user === null
                ? '—'
                : `${user.displayName ?? user.username}（${ROLE_LABELS[user.role] ?? user.role}）`}
            </Descriptions.Item>
            <Descriptions.Item label="模型要求">
              {MODEL_ID} · 协议 {MODEL_API}（也支持 anthropic-messages）
            </Descriptions.Item>
            <Descriptions.Item label="harness 版本">
              <Tag color="blue">dsh {dshVersion}</Tag>（版本必须精确匹配）
            </Descriptions.Item>
          </Descriptions>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            装完跑 <code>node scripts/setup.mjs</code>，脚本会问云端地址、模型 id、模型 base url、
            模型协议和模型 key——把上面这些填进去即可。
          </Typography.Paragraph>
        </Card>

        <Card title="第一步：下载生产端插件">
          {releases.isPending && <Spin />}

          {releases.isError && (
            <Alert type="error" showIcon message="版本信息加载失败" description="请稍后刷新重试。" />
          )}

          {releases.data !== undefined && producer === null && (
            <Alert
              type="warning"
              showIcon
              message="生产端插件暂未发布"
              description="发布后本页会自动出现下载入口。"
            />
          )}

          {producer !== undefined && producer !== null && (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="包名">{producer.name}</Descriptions.Item>
                <Descriptions.Item label="版本">
                  <Tag color="purple">v{producer.version}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="文件名">{producer.fileName}</Descriptions.Item>
                <Descriptions.Item label="校验值（SHA-256）">
                  {producer.sha256 === null ? '未提供' : <code>{producer.sha256}</code>}
                </Descriptions.Item>
              </Descriptions>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                href={`/downloads/${encodeURIComponent(producer.fileName)}`}
                style={{ marginTop: 12 }}
              >
                下载生产端安装包
              </Button>
            </>
          )}
        </Card>

        <Card title="第二步：三条命令装完">
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>1. 装 harness</strong>
          </Typography.Paragraph>
          <Command>{`npm i -g @deepseek-ai/dsh@${dshVersion}`}</Command>

          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 4 }}>
            <strong>2. 校验并解压</strong>
          </Typography.Paragraph>
          <Command>{`shasum -a 256 ${fileName}`}</Command>
          <Command>{`tar -xzf ${fileName} && cd package`}</Command>

          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 4 }}>
            <strong>3. 跑装机脚本</strong>
          </Typography.Paragraph>
          <Command>node scripts/setup.mjs</Command>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            脚本会写 dsh profile、复制九个工艺包进 profile、装依赖、换发云端会话令牌，最后跑完七项自检。
          </Typography.Paragraph>
        </Card>

        <Card title="第三步：做第一节课">
          <Command>{'dsh --profile trend-producer "用 ~/Movies/课程1.mp4 做第一节"'}</Command>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 12 }}>
            生产端按引擎强制的九步顺序跑（案例股 → 行情同步 → 行情读回 → 图示 → 回放课件 → 正文 →
            其余课件 → 评审 → 溯源）。评审打回会回灌重写，上限三轮；产出的一律是草稿，签批发布由运营完成。
          </Typography.Paragraph>
          <Space wrap>
            <Button type="primary" onClick={() => navigate('/courses')}>去生产看板</Button>
            <Button onClick={() => navigate('/segments')}>看片段管理</Button>
          </Space>
        </Card>
      </Space>
    </div>
  )
}
