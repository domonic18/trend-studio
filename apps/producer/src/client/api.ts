/**
 * 面板与宿主之间的唯一通道：四条 /api/trend-producer/* 精确 Fetch 路由。
 *
 * 浏览器半不持有任何凭据——云端令牌与模型密钥都只在宿主进程里；这里读到的
 * 只是脱敏后的结论（登录态、课程清单、看板计数），登录动作也只由宿主执行。
 */
import {
  PRODUCER_PANEL_PATHS,
  type ProducerPanelBoard,
  type ProducerPanelCourses,
  type ProducerPanelError,
  type ProducerPanelLoginAck,
  type ProducerPanelStatus,
} from '../shared/panel-contract.js'

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const error = (payload as ProducerPanelError).error
  return typeof error?.message === 'string' && error.message !== '' ? error.message : fallback
}

/** 面板所有读接口的统一取数：失败抛错，错误文案来自宿主载荷。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(errorMessage(payload, `请求失败（HTTP ${response.status}）`))
  }
  return payload as T
}

/** 面板 API：状态、课程、看板与登录。路径真相源在共享契约里，宿主与浏览器同源。 */
export const panelApi = {
  status: (): Promise<ProducerPanelStatus> => request<ProducerPanelStatus>(PRODUCER_PANEL_PATHS.status),
  courses: (): Promise<ProducerPanelCourses> => request<ProducerPanelCourses>(PRODUCER_PANEL_PATHS.courses),
  board: (courseId: string): Promise<ProducerPanelBoard> =>
    request<ProducerPanelBoard>(`${PRODUCER_PANEL_PATHS.board}?courseId=${encodeURIComponent(courseId)}`),
  login: (): Promise<ProducerPanelLoginAck> =>
    request<ProducerPanelLoginAck>(PRODUCER_PANEL_PATHS.login, { method: 'POST' }),
}
