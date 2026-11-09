/**
 * 生产面板正文：右侧栏「趋势生产」tab 的四张卡——登录、模型密钥、云端、生产看板。
 *
 * 面板不持有凭据，也不直接碰云端：所有结论都从宿主的面板 API 读，登录动作
 * 也只发给宿主执行（宿主在服务器侧开浏览器、跑设备码流程）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  ProducerPanelBoard,
  ProducerPanelCourse,
  ProducerPanelStatus,
} from '../shared/panel-contract.js'
import { panelApi } from './api.js'
import { BoardView } from './board.js'
import { ensurePanelStyles } from './styles.js'

/** 状态轮询间隔：登录审批在浏览器外完成，界面靠轮询看到变化。 */
const POLL_MS = 8_000

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 登录态一句话。 */
function loginText(status: ProducerPanelStatus): string {
  switch (status.login.state) {
    case 'active':
      return `已登录：${status.login.username ?? '教员'}（${status.login.role ?? '未知角色'}）`
    case 'expired':
      return `会话已过期：${status.login.username ?? '教员'}，请重新登录`
    default:
      return '未登录：先用教员账号登录趋势云端'
  }
}

function expiryText(status: ProducerPanelStatus): string {
  if (status.login.expiresAt === null) return '—'
  return new Date(status.login.expiresAt).toLocaleString()
}

/** 面板正文。 */
export function ProducerPanel(): ReactElement {
  const [status, setStatus] = useState<ProducerPanelStatus | null>(null)
  const [courses, setCourses] = useState<ProducerPanelCourse[]>([])
  const [courseId, setCourseId] = useState<string>('')
  const [board, setBoard] = useState<ProducerPanelBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ensurePanelStyles()
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await panelApi.status())
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = setInterval(() => {
      void refreshStatus()
    }, POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [refreshStatus])

  // 课程清单只在登录态为「已登录」时有内容；登录态一变就重取一次。
  const loginState = status?.login.state
  useEffect(() => {
    if (loginState !== 'active') {
      setCourses([])
      return
    }
    let cancelled = false
    void panelApi.courses()
      .then(result => {
        if (!cancelled) setCourses(result.courses)
      })
      .catch(cause => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [loginState])

  // 选定课程后取看板。
  useEffect(() => {
    if (courseId === '') {
      setBoard(null)
      return
    }
    let cancelled = false
    void panelApi.board(courseId)
      .then(result => {
        if (!cancelled) setBoard(result)
      })
      .catch(cause => {
        if (!cancelled) {
          setBoard(null)
          setError(messageOf(cause))
        }
      })
    return () => {
      cancelled = true
    }
  }, [courseId])

  // 没选课程时默认选第一门。
  useEffect(() => {
    if (courseId !== '') return
    const first = courses[0]
    if (first !== undefined) setCourseId(first.courseId)
  }, [courses, courseId])

  const startLogin = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    try {
      const ack = await panelApi.login()
      setNotice(ack.message)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const loggedIn = status?.login.state === 'active'

  return (
    <div className="tp-panel">
      <section className="tp-card">
        <div className="tp-card-head">
          <h3 className="tp-card-title">登录</h3>
          <button className="tp-button" disabled={busy || status?.login.pending === true} onClick={startLogin}>
            {loggedIn ? '重新登录' : '登录教员账号'}
          </button>
        </div>
        <div className="tp-row">
          <span className="tp-label">状态</span>
          <span className="tp-value">{status === null ? '读取中…' : loginText(status)}</span>
        </div>
        <div className="tp-row">
          <span className="tp-label">到期时间</span>
          <span className="tp-value">{status === null ? '—' : expiryText(status)}</span>
        </div>
        {status?.login.pending === true && <p className="tp-hint">授权页已打开，请在浏览器里用教员账号批准。</p>}
        {notice !== null && <p className="tp-notice">{notice}</p>}
        {error !== null && <p className="tp-error">{error}</p>}
      </section>

      <section className="tp-card">
        <div className="tp-card-head">
          <h3 className="tp-card-title">模型密钥</h3>
          <button className="tp-button" onClick={() => void refreshStatus()}>刷新</button>
        </div>
        <div className="tp-row">
          <span className="tp-label">密钥位</span>
          <span className="tp-value">{status?.modelKey.ref ?? '—'}</span>
        </div>
        <div className="tp-row">
          <span className="tp-label">状态</span>
          <span className="tp-value">{status === null ? '读取中…' : status.modelKey.configured ? '已配置' : '未配置'}</span>
        </div>
        {status !== null && !status.modelKey.configured && (
          <p className="tp-hint">在 dsh 设置 → 模型里粘贴密钥到 {status.modelKey.ref}，保存即生效。</p>
        )}
      </section>

      <section className="tp-card">
        <div className="tp-card-head">
          <h3 className="tp-card-title">云端</h3>
        </div>
        <div className="tp-row">
          <span className="tp-label">环境</span>
          <span className="tp-value">{status?.environment ?? '—'}</span>
        </div>
        <div className="tp-row">
          <span className="tp-label">地址</span>
          <span className="tp-value">{status?.baseUrl ?? '—'}</span>
        </div>
        <div className="tp-row">
          <span className="tp-label">连通</span>
          <span className="tp-value">
            {status === null
              ? '读取中…'
              : status.cloud.reachable
                ? '可达'
                : `不可达：${status.cloud.error ?? '未知原因'}`}
          </span>
        </div>
      </section>

      <section className="tp-card">
        <div className="tp-card-head">
          <h3 className="tp-card-title">生产看板</h3>
          {courses.length > 0 && (
            <select className="tp-select" value={courseId} onChange={event => setCourseId(event.target.value)}>
              {courses.map(course => (
                <option key={course.courseId} value={course.courseId}>{course.title}</option>
              ))}
            </select>
          )}
        </div>
        {!loggedIn && <p className="tp-hint">登录后这里显示每门课的生产进度。</p>}
        {loggedIn && courses.length === 0 && <p className="tp-hint">云端还没有课程。</p>}
        {board !== null && <BoardView board={board} />}
      </section>
    </div>
  )
}
