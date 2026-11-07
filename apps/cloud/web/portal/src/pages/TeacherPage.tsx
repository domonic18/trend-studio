import { DownloadOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Spin, Tag } from 'antd'
import { Link } from 'react-router-dom'
import { getReleases } from '../api'
import { CodeBlock } from '../components/CodeBlock'
import { PageHero } from '../components/PageHero'
import { PageMarkdown } from '../components/PageMarkdown'
import { content } from '../content'
import { formatBytes, formatDate } from '../lib/format'
import { usePageMeta } from '../usePageMeta'

const PREREQUISITES = [
  { title: 'Node.js 22 或更高版本', text: '在终端跑 node -v，能打印版本号即可。装不动先装 Node.js。' },
  { title: '生产端账号（角色 producer）', text: '学员账号装不了生产端插件——它会写课程草稿并推到云端，账号角色必须对得上。' },
  { title: '模型 API key', text: '生产端要跑模型理解视频、生成图示与课件。这把 key 只写进你自己机器上的凭据库，不上传云端。' },
]

/** 引擎强制的生产顺序：九步，不能跳。 */
const PRODUCTION_STEPS = [
  { step: '01', title: '选案例股', text: '定下这一节讲哪只股票、哪个事件窗。' },
  { step: '02', title: '同步行情', text: '拉取案例股与大盘的行情数据。' },
  { step: '03', title: '读回行情', text: '确认数据真的落库了，不对就重同步。' },
  { step: '04', title: '出图示', text: '生成关键帧与标注图示。' },
  { step: '05', title: '回放课件', text: '按片段做 K 线回放课件。' },
  { step: '06', title: '写正文', text: '生成本节正文草稿。' },
  { step: '07', title: '其余课件', text: '补齐其余交互课件。' },
  { step: '08', title: '评审', text: '自检断言与文案；被打回会回灌重写，最多三轮。' },
  { step: '09', title: '溯源', text: '核对每一处引用可回到原始片段。' },
]

export function TeacherPage() {
  usePageMeta('/teacher')
  const releases = useQuery({ queryKey: ['portal', 'releases'], queryFn: getReleases })
  const producer = releases.data?.producerPlugin

  return (
    <>
      <PageHero
        kicker="教员生产端"
        title="装生产端插件，做第一节课"
        description="生产端把一段课程视频变成图文课程与交互课件。这一页写清楚：装什么、怎么装、装完怎么用。"
      >
        <a href="#producer-download"><Button type="primary">下载生产端插件</Button></a>
        <Link to="/guide"><Button>先看学员端安装</Button></Link>
      </PageHero>

      <section className="content-section" id="producer-download">
        <h2 className="content-section-title">第一步：下载生产插件</h2>

        {releases.isPending && (
          <div className="portal-loading">
            <Spin />
            <span>正在加载版本信息…</span>
          </div>
        )}

        {releases.isError && (
          <Alert
            type="error"
            showIcon
            message="版本信息加载失败"
            description="请稍后刷新页面重试；如持续失败，请联系管理员。"
          />
        )}

        {releases.data !== undefined && producer === null && (
          <Alert
            type="warning"
            showIcon
            message="生产端插件暂未发布"
            description="当前还没有发布生产端安装包。发布后本页会更新下载入口。"
          />
        )}

        {producer !== undefined && producer !== null && (
          <article className="download-card">
            <div className="download-card-head">
              <div>
                <h2>{producer.name}</h2>
                <div className="download-meta">
                  <Tag color="blue">v{producer.version}</Tag>
                  <span>发布于 {formatDate(producer.publishedAt)}</span>
                  <span>文件大小 {formatBytes(producer.sizeBytes)}</span>
                </div>
              </div>
              <a href={`/downloads/${encodeURIComponent(producer.fileName)}`} download>
                <Button type="primary" size="large" icon={<DownloadOutlined />}>
                  下载安装包
                </Button>
              </a>
            </div>

            <Descriptions column={1} size="small" className="download-detail">
              <Descriptions.Item label="文件名">{producer.fileName}</Descriptions.Item>
              <Descriptions.Item label="校验值（SHA-256）">
                {producer.sha256 === null
                  ? '未提供'
                  : <code className="download-sha">{producer.sha256}</code>}
              </Descriptions.Item>
              <Descriptions.Item label="内容">九个工艺包与装机脚本都在安装包里，解压即用，不碰仓库。</Descriptions.Item>
            </Descriptions>

            {producer.notes.length > 0 && (
              <div className="download-notes">
                <h3>更新说明</h3>
                <ul>
                  {producer.notes.map(note => <li key={note}>{note}</li>)}
                </ul>
              </div>
            )}
          </article>
        )}
      </section>

      <section className="content-section">
        <h2 className="content-section-title">第二步：装 harness 与插件</h2>
        <p>先装 harness（本地客户端本体），再装插件。版本号必须和页面给出的一致，版本不匹配插件会起不来。</p>

        <ol className="guide-steps">
          <li className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-index">01</span>
              <h2>装 harness</h2>
            </div>
            <p>全局装一次即可；想免预装就把命令换成 <code>npx --yes @deepseek-ai/dsh@版本号</code>，其余步骤不变。</p>
            <CodeBlock
              label="终端"
              code={`npm i -g @deepseek-ai/dsh@${releases.data?.dshVersion ?? '0.2.1-rc.5'}`}
            />
          </li>

          <li className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-index">02</span>
              <h2>校验并解压安装包</h2>
            </div>
            <p>先核对校验值，确认文件完整，再解压。解压后进入 <code>package</code> 目录。</p>
            <CodeBlock
              label="macOS / Linux"
              code={[
                `shasum -a 256 ${producer?.fileName ?? 'dsh-plugin-trend-producer-0.1.4.tgz'}`,
                `tar -xzf ${producer?.fileName ?? 'dsh-plugin-trend-producer-0.1.4.tgz'}`,
                'cd package',
              ].join('\n')}
            />
            <p className="guide-step-expect"><strong>你会看到：</strong>校验值和上面卡片里的一致；解压后当前目录下出现 <code>package</code> 文件夹。</p>
          </li>

          <li className="guide-step">
            <div className="guide-step-head">
              <span className="guide-step-index">03</span>
              <h2>跑装机脚本</h2>
            </div>
            <p>
              脚本会写 dsh profile、把九个工艺包复制进 profile、装依赖、换发云端会话令牌，最后跑完七项自检。
              过程中它会问云端地址、模型 id、模型 base url、模型协议和模型 key——每项都能直接回车取默认值。
            </p>
            <CodeBlock label="终端" code="node scripts/setup.mjs" />
            <p className="guide-step-expect"><strong>你会看到：</strong>七项自检全绿（✓）。哪一项不过就按那一项的提示处理，别跳到下一步。</p>
            <p className="guide-step-tip"><strong>小提示：</strong>脚本可重复运行。重装时它会重写托管配置，不会吞掉你手改过的条目。</p>
          </li>
        </ol>
      </section>

      <section className="content-section">
        <h2 className="content-section-title">第三步：装之前先确认这三样</h2>
        <div className="capability-grid">
          {PREREQUISITES.map(item => (
            <article key={item.title} className="capability-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section">
        <h2 className="content-section-title">日常使用：丢一段视频进去</h2>
        <p>生产端在终端里跑。把课程视频的路径交给它，它会按引擎强制的顺序走完九步：</p>
        <CodeBlock
          label="终端"
          code={'dsh --profile trend-producer "用 ~/Movies/课程1.mp4 做第一节"'}
        />
        <ol className="path-list">
          {PRODUCTION_STEPS.map(item => (
            <li key={item.step} className="path-item">
              <span className="path-step">{item.step}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="download-side-grid">
          <article className="info-card">
            <h3>看进度</h3>
            <p>管理台的「生产看板」看整条生产线的实时状态；「课程预览」看这一节的成品效果。</p>
          </article>
          <article className="info-card">
            <h3>被打回怎么办</h3>
            <p>评审不通过会回灌重写，上限三轮。三轮还不过，说明素材本身有问题，改素材再跑。</p>
          </article>
          <article className="info-card">
            <h3>发布不是教员的事</h3>
            <p>生产端产出的一律是草稿。签批发布由运营在管理台完成——上线前总有一道人工复核。</p>
          </article>
        </div>
      </section>

      <section className="content-section content-section-narrow">
        <h2 className="content-section-title">自检、排障与卸载</h2>
        <PageMarkdown value={content('teacher')} />
      </section>
    </>
  )
}
