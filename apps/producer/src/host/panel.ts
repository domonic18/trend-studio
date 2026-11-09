/**
 * 生产面板的宿主侧 API：右侧栏面板经 /api/trend-producer/* 读状态、课程与
 * 看板，并发起登录。
 *
 * 浏览器半不碰云端令牌与模型密钥——两者只在宿主进程里；面板拿到的都是脱敏
 * 后的结论（登录态、课程清单、看板计数）。面板因此不需要任何凭据即可渲染。
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { PRODUCTION_STEP_LABELS } from '@trend/contracts'
import { beginConsoleLogin, isConsoleLoginInFlight, type HostLoggerLike } from './authorization.js'
import type { TrendCloudClient } from './cloud-client.js'
import type { Config } from './config.js'
import { isConsoleGrantFresh, readConsoleGrant } from './console-grant.js'
import {
  PRODUCER_PANEL_PATHS,
  type ProducerPanelBoard,
  type ProducerPanelCourses,
  type ProducerPanelLogin,
  type ProducerPanelLoginAck,
  type ProducerPanelStatus,
} from '../shared/panel-contract.js'

const JSON_HEADERS = { 'content-type': 'application/json' }

/**
 * 宿主 connection 服务的最小面：面板只用到「精确 Fetch 路由注册」这一件事。
 * dsh-client-connection 不声明 Context 增强，所以这里自述用到的那一小块。
 */
interface ConnectionFetchRegistry {
  register(route: {
    path: string
    methods: readonly ('GET' | 'HEAD' | 'POST')[]
    requestBody: 'buffered' | 'streaming'
    fetch: (request: Request) => Promise<Response>
  }): () => Promise<void>
}

interface ConnectionService {
  readonly fetch: ConnectionFetchRegistry
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** 面板读接口的失败载荷：浏览器只呈现 message，不做错误码分支。 */
function failure(status: number, message: string): Response {
  return json({ error: { message } }, status)
}

/** 登录态：无记录=未登录，记录过期=已过期，其余=已登录。 */
async function loginState(
  credentials: CredentialProvider | undefined,
  pending: boolean,
): Promise<ProducerPanelLogin> {
  const grant = credentials === undefined ? null : await readConsoleGrant(credentials)
  if (grant === null) {
    return { state: 'none', username: null, role: null, expiresAt: null, pending }
  }
  const fresh = isConsoleGrantFresh(grant)
  return {
    state: fresh ? 'active' : 'expired',
    username: grant.user.username,
    role: grant.user.role,
    expiresAt: grant.expiresAt,
    pending,
  }
}

/** 云端健康：面板顶部的「云端可达」一行；探不通不抛错，只报不可达。 */
async function probeCloud(baseUrl: string): Promise<{ reachable: boolean; error: string | null }> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) })
    if (response.ok) return { reachable: true, error: null }
    return { reachable: false, error: `云端健康检查返回 HTTP ${response.status}` }
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 面板控制器：持有「授权进行中」这一个人会话态，其余状态都从凭据与云端现读。 */
export class ProducerPanel {
  private pending = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly client: TrendCloudClient,
    private readonly logger: HostLoggerLike,
  ) {}

  /** 登录态快照：面板轮询它就知道登录有没有变成「已登录」。 */
  async status(): Promise<ProducerPanelStatus> {
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    const keyRef = this.config.understanding.apiKeyEnv
    const modelKey = credentials === undefined
      ? { ref: keyRef, configured: false }
      : { ref: keyRef, configured: (await credentials.describe(credentialRef(keyRef))).configured }
    return {
      environment: this.config.environment,
      baseUrl: this.config.baseUrl,
      cloud: await probeCloud(this.config.baseUrl),
      login: await loginState(credentials, this.pending),
      modelKey,
    }
  }

  /** 课程清单：面板据此给出「选哪门课看看板」的选择器。 */
  async courses(): Promise<ProducerPanelCourses> {
    const output = await this.client.readCourses({})
    return {
      courses: output.courses.map(course => ({
        courseId: course.courseId,
        title: course.title,
        status: course.status,
        chapterCount: course.chapterCount ?? 0,
      })),
    }
  }

  /** 生产看板：每节一行（步骤状态 + 产出计数 + 最近评审结论）。 */
  async board(courseId: string): Promise<ProducerPanelBoard> {
    const output = await this.client.readProductionBoard({ courseId })
    return {
      courseId: output.courseId,
      courseTitle: output.courseTitle,
      stepLabels: { ...PRODUCTION_STEP_LABELS },
      sections: output.sections.map(section => ({
        sectionId: section.sectionId,
        title: section.title,
        position: section.position,
        steps: section.steps.map(step => ({ step: step.step, status: step.status, note: step.note })),
        articleVersion: section.articleVersion,
        widgetCount: section.widgetCount,
        figureCount: section.figureCount,
        caseStockCount: section.caseStockCount,
        reviewVerdict: section.reviewVerdict,
      })),
    }
  }

  /**
   * 发起一轮登录：设备码流程在后台跑，接口立刻返回，浏览器那边已经打开授权页。
   * 已经有授权在跑时不重复开——两次流程会问两个人同一件事。
   */
  async startLogin(): Promise<ProducerPanelLoginAck> {
    if (this.pending || isConsoleLoginInFlight()) {
      return { started: false, message: '已有一轮登录在进行中，请在浏览器完成授权。' }
    }
    this.pending = true
    const controller = new AbortController()
    void beginConsoleLogin(this.ctx, controller.signal, this.logger)
      .then(outcome => {
        this.logger.info('面板登录结束：%s', outcome.status)
      })
      .catch((error: unknown) => {
        this.logger.warn('面板登录失败：%s', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        this.pending = false
      })
    return { started: true, message: '已在浏览器打开教员端授权页，用教员账号登录并批准即可。' }
  }
}

/** 把四个面板路由挂到宿主的 /api 通道上。 */
function registerRoutes(ctx: Context, panel: ProducerPanel): void {
  const fetchRoutes = (ctx.get('connection') as ConnectionService | undefined)?.fetch
  if (fetchRoutes === undefined) return
  void fetchRoutes.register({
    path: PRODUCER_PANEL_PATHS.status,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(await panel.status()),
  })
  void fetchRoutes.register({
    path: PRODUCER_PANEL_PATHS.courses,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json(await panel.courses())
      } catch (error) {
        return failure(502, error instanceof Error ? error.message : String(error))
      }
    },
  })
  void fetchRoutes.register({
    path: PRODUCER_PANEL_PATHS.board,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const courseId = new URL(request.url).searchParams.get('courseId') ?? ''
      if (courseId === '') return failure(400, '缺少 courseId 参数')
      try {
        return json(await panel.board(courseId))
      } catch (error) {
        return failure(502, error instanceof Error ? error.message : String(error))
      }
    },
  })
  void fetchRoutes.register({
    path: PRODUCER_PANEL_PATHS.login,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => json(await panel.startLogin()),
  })
}

/**
 * 注册面板 API。
 *
 * 走 `ctx.inject(['connection'])` 而不是插件顶层依赖：headless 应用面没有
 * connection 服务，注入回调不会触发，插件照常激活——web 应用面才有面板。
 */
export function registerPanelApi(
  ctx: Context,
  config: Config,
  client: TrendCloudClient,
  logger: HostLoggerLike,
): void {
  const panel = new ProducerPanel(ctx, config, client, logger)
  ctx.inject(['connection'], (connectionCtx) => {
    registerRoutes(connectionCtx, panel)
  })
}
