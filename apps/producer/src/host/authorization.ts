/**
 * 教员端登录授权流：dsh authorization seam 上的设备码流程。
 *
 * rc.5 的 web 客户端没有通用 flow UI，所以 flow 自理交互——notify 上报进度、
 * 宿主侧直接开浏览器、按云端节奏轮询，拿到 console 会话即 commit GrantRecord。
 * 流程必须 commit 或抛错（seam 契约），凭据 record 的解释权在 console-grant.ts。
 */
import { exec } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  type AuthorizationInteraction,
  type AuthorizationOutcome,
  type AuthorizationService,
  type AuthorizationSession,
} from '@deepseek-ai/dsh-authorization'
import { errorPayload } from '../errors.js'
import { CONSOLE_GRANT_KEY, toConsoleGrantRecord, type ConsoleGrantPayload } from './console-grant.js'

export const PRODUCER_CLIENT_ID = 'dsh-plugin-trend-producer'

interface DeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

type DevicePoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'authorized'; session: ConsoleGrantPayload }

export interface HostLoggerLike {
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
}

/** darwin `open` / win32 `start` / 其余 `xdg-open`；开不了只告警——notify 里的 URL 仍是人工兜底。 */
export function openBrowser(url: string, logger: HostLoggerLike): void {
  const command = process.platform === 'darwin' ? `open ${JSON.stringify(url)}`
    : process.platform === 'win32' ? `start "" ${JSON.stringify(url)}`
      : `xdg-open ${JSON.stringify(url)}`
  exec(command, { timeout: 5_000 }, error => {
    if (error !== null) logger.warn('打开浏览器失败（可手动访问授权页）：%s', error.message)
  })
}

async function postCloudJson(baseUrl: string, path: string, body: unknown, timeoutMs: number, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok) {
    const payload = errorPayload(await response.json().catch(() => undefined))
    throw new Error(`云端 ${path} 失败（${response.status}）：${payload.message || '请稍后重试'}`)
  }
  return await response.json()
}

function parseStart(payload: unknown): DeviceCodeStart {
  if (typeof payload !== 'object' || payload === null) throw new Error('云端返回的设备码回执无法识别')
  const raw = payload as Record<string, unknown>
  if (typeof raw.deviceCode !== 'string' || typeof raw.userCode !== 'string' || typeof raw.verificationUri !== 'string') {
    throw new Error('云端返回的设备码回执缺少字段')
  }
  return {
    deviceCode: raw.deviceCode,
    userCode: raw.userCode,
    verificationUri: raw.verificationUri,
    expiresIn: typeof raw.expiresIn === 'number' ? raw.expiresIn : 300,
    interval: typeof raw.interval === 'number' ? raw.interval : 5,
  }
}

function parsePoll(payload: unknown): DevicePoll {
  if (typeof payload !== 'object' || payload === null) throw new Error('云端返回的轮询回执无法识别')
  const raw = payload as Record<string, unknown>
  if (raw.status === 'pending') return { status: 'pending' }
  if (raw.status === 'expired') return { status: 'expired' }
  if (raw.status === 'authorized' && typeof raw.session === 'object' && raw.session !== null) {
    const session = raw.session as Record<string, unknown>
    const user = typeof session.user === 'object' && session.user !== null ? session.user as Record<string, unknown> : null
    if (typeof session.token === 'string' && typeof session.expiresAt === 'number' && user !== null
      && typeof user.userId === 'string' && typeof user.username === 'string' && typeof user.role === 'string') {
      return {
        status: 'authorized',
        session: {
          token: session.token,
          expiresAt: session.expiresAt,
          user: { userId: user.userId, username: user.username, displayName: typeof user.displayName === 'string' ? user.displayName : null, role: user.role },
        },
      }
    }
  }
  throw new Error('云端返回的轮询回执无法识别')
}

/** 双出口睡眠：到点或 signal 取消都 resolve，由调用方统一检查 aborted。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 设备码授权一次尝试：开码 → notify + 开浏览器 → 轮询 → commit console 会话。open 可注入（测试）。 */
export async function runConsoleLogin(
  session: AuthorizationSession,
  baseUrl: string,
  logger: HostLoggerLike,
  open: (url: string, logger: HostLoggerLike) => void = openBrowser,
): Promise<void> {
  const deviceId = `dsh-${randomBytes(12).toString('hex')}`
  const start = parseStart(
    await postCloudJson(baseUrl, '/v1/auth/device/code', { clientId: PRODUCER_CLIENT_ID, deviceId }, 15_000, session.signal),
  )
  session.notify({
    message: '浏览器已打开趋势教员端授权页，请用教员账号登录并批准；未自动打开时请访问通知里的链接。',
    url: start.verificationUri,
    code: start.userCode,
  })
  open(start.verificationUri, logger)

  const intervalMs = Math.min(Math.max(start.interval, 1), 30) * 1000
  const deadline = Date.now() + (start.expiresIn + 60) * 1000
  for (;;) {
    await sleep(intervalMs, session.signal)
    if (session.signal.aborted) throw new Error('登录已取消')
    const poll = parsePoll(
      await postCloudJson(baseUrl, '/v1/auth/device/token', { deviceCode: start.deviceCode }, 15_000, session.signal),
    )
    if (poll.status === 'pending') {
      if (Date.now() > deadline) throw new Error('设备码已过期，请重新执行 /trend login')
      continue
    }
    if (poll.status === 'expired') throw new Error('设备码已过期或在别处完成授权，请重新执行 /trend login')
    session.notify({ message: `已授权：${poll.session.user.username}（${poll.session.user.role}），正在保存登录态。` })
    await session.commit(toConsoleGrantRecord(poll.session))
    return
  }
}

/** 注册授权流；authorization 服务未加载时跳过并告警（不阻塞插件激活）。 */
export function registerConsoleLoginFlow(ctx: Context, baseUrl: string, logger: HostLoggerLike): void {
  const authorization = ctx.get('authorization') as AuthorizationService | undefined
  if (authorization === undefined) {
    logger.warn('dsh 未加载 authorization 服务，/trend login 不可用')
    return
  }
  ctx.effect(() => authorization.registerFlow({
    key: CONSOLE_GRANT_KEY,
    label: '趋势云端 · 教员账号',
    methods: [{ id: 'browser', label: '浏览器授权登录' }],
    run: session => runConsoleLogin(session, baseUrl, logger),
  }))
}

/** /trend login 的执行面：开一次授权尝试，交互面只记日志（浏览器已在宿主侧打开）。 */
export async function beginConsoleLogin(ctx: Context, signal: AbortSignal, logger: HostLoggerLike): Promise<AuthorizationOutcome> {
  const authorization = ctx.get('authorization') as AuthorizationService | undefined
  if (authorization === undefined) throw new Error('dsh 未加载 authorization 服务，无法登录')
  const interaction: AuthorizationInteraction = {
    notify: notice => {
      logger.info('授权进度：%s%s', notice.message, notice.url === undefined ? '' : `（${notice.url}）`)
    },
    prompt: () => {
      throw new AuthorizationDeclinedError('命令面板无法回答授权问题')
    },
  }
  return await authorization.begin({ key: CONSOLE_GRANT_KEY, interaction, signal })
}
