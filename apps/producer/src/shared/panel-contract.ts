/**
 * 生产面板契约：宿主路由与浏览器面板共用的唯一真相源。
 *
 * 面板 API 只在插件内部流通（宿主 ↔ 自己的浏览器半），不跨进程也不跨包——
 * 跨端契约才需要进 @trend/contracts，这里没有那个必要。
 *
 * **本模块必须零运行时依赖**：浏览器半把整个模块内联进 client bundle，
 * 任何运行时 import 都会让打包脚本直接失败。类型 import 是安全的（编译期擦除）。
 */

/** 面板路由：宿主注册这些路径，浏览器按同一份常量调用。 */
export const PRODUCER_PANEL_PATHS = {
  status: '/api/trend-producer/status',
  courses: '/api/trend-producer/courses',
  board: '/api/trend-producer/board',
  login: '/api/trend-producer/login',
} as const

/** 登录态：未登录 / 已登录 / 已过期；pending 表示一轮授权正在进行。 */
export type ProducerPanelLoginState = 'none' | 'active' | 'expired'

export interface ProducerPanelLogin {
  state: ProducerPanelLoginState
  username: string | null
  role: string | null
  /** 会话过期时刻（毫秒时间戳）；未登录为 null。 */
  expiresAt: number | null
  /** 一轮授权正在进行（浏览器已打开授权页，等待教员批准）。 */
  pending: boolean
}

export interface ProducerPanelStatus {
  environment: string
  baseUrl: string
  cloud: { reachable: boolean; error: string | null }
  login: ProducerPanelLogin
  modelKey: { ref: string; configured: boolean }
}

export interface ProducerPanelLoginAck {
  started: boolean
  message: string
}

export interface ProducerPanelCourse {
  courseId: string
  title: string
  status: 'draft' | 'published' | 'archived'
  chapterCount: number
}

export interface ProducerPanelCourses {
  courses: ProducerPanelCourse[]
}

export interface ProducerPanelStep {
  step: string
  status: string
  note: string | null
}

export interface ProducerPanelSection {
  sectionId: string
  title: string
  position: number
  steps: ProducerPanelStep[]
  articleVersion: number | null
  widgetCount: number
  figureCount: number
  caseStockCount: number
  reviewVerdict: 'approve' | 'reject' | null
}

export interface ProducerPanelBoard {
  courseId: string
  courseTitle: string
  /** 步骤枚举 → 中文标签；宿主给出，浏览器不自带第二份。 */
  stepLabels: Record<string, string>
  sections: ProducerPanelSection[]
}

/** 面板读接口失败时的统一载荷；浏览器按 message 呈现。 */
export interface ProducerPanelError {
  error: { message: string }
}
