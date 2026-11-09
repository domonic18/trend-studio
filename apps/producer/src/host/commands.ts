/**
 * `/trend` 人类命令：登录与就绪度自查。
 *
 * 命令不经模型直接执行（dsh-commands seam）。login 走授权流开浏览器；
 * status 汇总云端健康、登录态与模型密钥配置，给教员一个不打扰 AI 的自查面。
 */
import type { Context } from '@deepseek-ai/cordis'
import { AuthorizationError } from '@deepseek-ai/dsh-authorization'
import type { CommandDefinition, CommandResult, CommandRuntime } from '@deepseek-ai/dsh-commands'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Config } from './config.js'
import { beginConsoleLogin, type HostLoggerLike } from './authorization.js'
import { isConsoleGrantFresh, readConsoleGrant } from './console-grant.js'

function formatRemaining(expiresAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
}

async function cloudHealth(baseUrl: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) })
    return response.ok ? '正常' : `异常（HTTP ${response.status}）`
  } catch {
    return '不可达（检查网络与 baseUrl 配置）'
  }
}

async function loginAction(ctx: Context, signal: AbortSignal, logger: HostLoggerLike): Promise<CommandResult> {
  try {
    const outcome = await beginConsoleLogin(ctx, signal, logger)
    if (outcome.status === 'cancelled') return { kind: 'success', text: '已取消登录。' }
    const credentials = ctx.get('credentials') as CredentialProvider | undefined
    const grant = credentials === undefined ? null : await readConsoleGrant(credentials)
    if (grant !== null) {
      const who = `${grant.user.username}（${grant.user.role}）`
      return { kind: 'success', text: `登录成功：${who}，会话约剩 ${formatRemaining(grant.expiresAt)}。` }
    }
    return { kind: 'success', text: '登录成功。' }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.code === 'ALREADY_IN_FLIGHT') return { kind: 'error', text: '已有一轮登录在进行中，请到浏览器完成授权或稍后再试。' }
      if (error.code === 'NOT_COMMITTED') return { kind: 'error', text: '授权流程未能保存登录态，请重试 /trend login。' }
    }
    const message = error instanceof Error ? error.message : '未知错误'
    return { kind: 'error', text: `登录失败：${message}` }
  }
}

async function statusAction(ctx: Context, config: Config): Promise<CommandResult> {
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  const lines: string[] = [`云端（${config.baseUrl}）：${await cloudHealth(config.baseUrl)}`]

  const grant = credentials === undefined ? null : await readConsoleGrant(credentials)
  if (grant === null) {
    lines.push('登录态：未登录——运行 /trend login 打开浏览器授权。')
  } else if (isConsoleGrantFresh(grant)) {
    lines.push(`登录态：${grant.user.username}（${grant.user.role}），会话约剩 ${formatRemaining(grant.expiresAt)}。`)
  } else {
    lines.push(`登录态：已过期（${grant.user.username}）——运行 /trend login 重新授权。`)
  }

  const keyRef = config.understanding.apiKeyEnv
  if (credentials === undefined) {
    lines.push(`模型密钥（${keyRef}）：凭据服务未加载，无法确认。`)
  } else {
    const info = await credentials.describe(credentialRef(keyRef))
    lines.push(`模型密钥（${keyRef}）：${info.configured ? '已配置' : '未配置——在 dsh 设置 → 模型里填写。'}`)
  }
  return { kind: 'success', text: lines.join('\n') }
}

export function trendCommandDefinition(ctx: Context, config: Config, logger: HostLoggerLike): CommandDefinition {
  return {
    name: 'trend',
    description: '趋势教员端登录与就绪度自查（/trend login、/trend status）',
    input: { hint: 'login 或 status，留空等于 status' },
    handler: async invocation => {
      const sub = invocation.rawInput.trim().toLowerCase()
      if (sub === '' || sub === 'status') return await statusAction(ctx, config)
      if (sub === 'login') return await loginAction(ctx, invocation.signal, logger)
      return { kind: 'error', text: `未知子命令「${invocation.rawInput.trim()}」：支持 /trend login 与 /trend status。` }
    },
  }
}

/** 注册 /trend 命令；commands 服务未加载时跳过并告警（不阻塞插件激活）。 */
export function registerTrendCommands(ctx: Context, config: Config, logger: HostLoggerLike): void {
  const commands = ctx.get('commands') as CommandRuntime | undefined
  if (commands === undefined) {
    logger.warn('dsh 未加载 commands 服务，/trend 命令不可用')
    return
  }
  ctx.effect(() => commands.register(trendCommandDefinition(ctx, config, logger)))
}
