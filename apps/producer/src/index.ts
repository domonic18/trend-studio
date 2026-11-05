import type { Context } from '@deepseek-ai/cordis'
import { CloudAuth } from './host/auth.js'
import { Config, resolveConfig } from './host/config.js'
import { TrendCloudClient } from './host/cloud-client.js'
import { UnderstandingRunner } from './host/understanding.js'
import { createHostLogger, type HostLogger } from './host/log.js'
import { registerCloudTools } from './host/tools.js'

export { Config }

export const name = 'trend-producer'

export const inject = ['tools', 'credentials']

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const logger = createHostLogger(ctx.logger('trend-producer') as HostLogger, resolved.logLevel)
  const auth = new CloudAuth(ctx, resolved)
  const client = new TrendCloudClient(auth)
  const runner = new UnderstandingRunner(client, resolved.understanding)

  // 生产编排（T2/T3）在工具集之上装配；凭据缺失不阻止激活，首次工具调用才要求配置。
  registerCloudTools(ctx, client, runner)
  logger.info(
    'trend-producer 已激活: environment=%s baseUrl=%s timeoutMs=%d logLevel=%s',
    resolved.environment,
    resolved.baseUrl,
    resolved.timeoutMs,
    resolved.logLevel,
  )
}
