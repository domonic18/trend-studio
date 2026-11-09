import type { Context } from '@deepseek-ai/cordis'
import { CloudAuth } from './host/auth.js'
import { registerConsoleLoginFlow } from './host/authorization.js'
import { registerTrendCommands } from './host/commands.js'
import { Config, resolveConfig } from './host/config.js'
import { TrendCloudClient } from './host/cloud-client.js'
import { AssetUploader } from './host/asset-upload.js'
import { UnderstandingRunner } from './host/understanding.js'
import { createHostLogger, type HostLogger } from './host/log.js'
import { createModelKeyResolver } from './host/model-key.js'
import { registerProductionTools } from './host/production-tools.js'
import { registerPanelApi } from './host/panel.js'
import { registerCloudTools } from './host/tools.js'

export { Config }

export const name = 'trend-producer'

export const inject = ['tools', 'credentials']

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const logger = createHostLogger(ctx.logger('trend-producer') as HostLogger, resolved.logLevel)
  const auth = new CloudAuth(ctx, resolved)
  const client = new TrendCloudClient(auth)
  const runner = new UnderstandingRunner(client, resolved.understanding, createModelKeyResolver(ctx))
  const uploader = new AssetUploader(client)

  // 生产编排（T2/T3）在工具集之上装配；凭据缺失不阻止激活，首次工具调用才要求配置。
  registerCloudTools(ctx, client, runner, uploader)
  registerProductionTools(ctx, client)
  // 登录授权流与 /trend 命令：dsh-base 已激活 authorization/commands 服务，未加载时降级告警。
  registerConsoleLoginFlow(ctx, resolved.baseUrl, logger)
  registerTrendCommands(ctx, resolved, logger)
  // 右侧栏生产面板的宿主 API：只在 web 应用面（有 connection 服务）挂上。
  registerPanelApi(ctx, resolved, client, logger)
  logger.info(
    'trend-producer 已激活: environment=%s baseUrl=%s timeoutMs=%d logLevel=%s',
    resolved.environment,
    resolved.baseUrl,
    resolved.timeoutMs,
    resolved.logLevel,
  )
}
