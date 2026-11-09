import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
} from 'fastify'
import type { Pool } from 'pg'
import { AiRouter } from './ai/routing.js'
import { registerAiRoutes } from './ai/routes.js'
import { AiUsageService } from './ai/usage.js'
import { AccountService } from './accounts/service.js'
import { registerAccountRoutes } from './accounts/routes.js'
import { createAsrProvider, type AsrProvider } from './asr/provider.js'
import { registerAsrRoutes } from './asr/routes.js'
import { AuthService } from './auth/service.js'
import { registerAuthRoutes } from './auth/routes.js'
import { safeEqual } from './auth/tokens.js'
import { CatalogService } from './catalog/service.js'
import { registerCatalogRoutes } from './catalog/routes.js'
import type { AppConfig } from './config.js'
import { ContentService } from './content/service.js'
import { registerContentRoutes } from './content/routes.js'
import { EventService } from './events/service.js'
import { registerEventRoutes } from './events/routes.js'
import { CodedHttpError, HttpError } from './errors.js'
import { createMetrics, type Metrics } from './metrics.js'
import { RateLimiter } from './rate-limit.js'
import type { EmbeddingResolver } from './kb/embedding.js'
import { KnowledgeService } from './kb/service.js'
import { ModelConfigService } from './model-config/service.js'
import { registerModelConfigRoutes } from './model-config/routes.js'
import { registerKbRoutes } from './kb/routes.js'
import { signFigureUrl } from './media/figure-sign.js'
import { createCosStore } from './media/cos-store.js'
import { registerMediaRoutes } from './media/routes.js'
import { PlaybackService } from './playback/service.js'
import { registerPlaybackRoutes } from './playback/routes.js'
import { ProgressService } from './progress/service.js'
import { registerProgressRoutes } from './progress/routes.js'
import { registerPipelineRoutes } from './pipeline/routes.js'
import { createPipelineRuntime, type PipelineRuntime } from './pipeline/runtime.js'
import { createLocalMediaProcessor } from './pipeline/media-processor.js'
import { createLocalMediaStore } from './pipeline/media-store.js'
import type { QuoteFetcher } from './pipeline/quotes/tencent.js'
import { createFigureStore } from './illustration/store.js'
import { registerPortalRoutes } from './portal/routes.js'
import { ProductionService } from './production/service.js'
import { registerProductionRoutes } from './production/routes.js'

export interface BuildAppOptions {
  config: AppConfig
  pool: Pool
  /** 测试用：注入 fake provider，不访问真实 ASR。 */
  asr?: AsrProvider
  /** 测试用：替换数据库模型配置服务（如固定 embedding provider）。 */
  models?: ModelConfigService
  /** 测试用：收集已注册路由，与 OpenAPI 做一致性校验。 */
  onRoute?: (method: string, url: string) => void
  /** 测试用：注入已装配的管线运行时（可带假处理器/假 ASR）。 */
  pipeline?: PipelineRuntime
  /** 测试用：假的行情拉取器（默认走腾讯前复权日K）。 */
  quotes?: QuoteFetcher
  /** 测试用：与注入的管线运行时共用同一注册表。 */
  metrics?: Metrics
  /** 仅生产入口启动 worker；测试默认不启动，避免后台轮询干扰断言。 */
  startPipeline?: boolean
}

export async function buildApp({
  config,
  pool,
  onRoute,
  asr: injectedAsr,
  models: injectedModels,
  pipeline: injectedPipeline,
  metrics: injectedMetrics,
  quotes: injectedQuotes,
  startPipeline = false,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers["x-device-id"]'],
    },
    bodyLimit: 128 * 1024,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
  })

  if (onRoute !== undefined) {
    app.addHook('onRoute', route => {
      const methods = Array.isArray(route.method) ? route.method : [route.method]
      for (const method of methods) onRoute(method, route.url)
    })
  }

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-device-id'],
  })

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    reply.header('x-content-type-options', 'nosniff')
    return payload
  })

  const metrics = injectedMetrics ?? createMetrics()

  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: String(reply.statusCode),
    }
    metrics.httpRequests.inc(labels)
    metrics.httpDuration.observe(labels, reply.elapsedTime / 1000)
    request.log.info({
      requestId: request.id,
      method: request.method,
      path: request.url.split('?')[0],
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    }, 'request completed')
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof CodedHttpError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...error.details },
        requestId: request.id,
      })
      return
    }
    if (error instanceof HttpError) {
      if (error.statusCode === 429) reply.header('retry-after', '60')
      reply.code(error.statusCode).send({ error: error.message, requestId: request.id })
      return
    }
    if (error.statusCode === 413) {
      reply.code(413).send({ error: 'payload too large', requestId: request.id })
      return
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      reply.code(error.statusCode).send({ error: 'invalid request', requestId: request.id })
      return
    }
    request.log.error({ err: error, requestId: request.id }, 'unhandled error')
    reply.code(500).send({ error: 'internal error', requestId: request.id })
  })

  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1')
      return { ok: true, commit: config.gitSha, buildTime: config.buildTime }
    } catch {
      return reply.code(503).send({ ok: false, commit: config.gitSha, buildTime: config.buildTime })
    }
  })

  app.get('/metrics', async (request, reply) => {
    const authorization = request.headers.authorization
    if (authorization === undefined || !safeEqual(authorization, `Bearer ${config.metricsToken}`)) {
      return reply.code(401).send({ error: 'unauthorized', requestId: request.id })
    }
    return reply.type(metrics.registry.contentType).send(await metrics.registry.metrics())
  })

  const limiter = new RateLimiter()
  const timer = setInterval(() => limiter.prune(), 60_000)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))

  const auth = new AuthService(pool, config)
  const accounts = new AccountService(pool, config)
  const bootstrap = await accounts.bootstrapAdmin()
  if (bootstrap.created) app.log.info('bootstrap admin created')
  const models = injectedModels ?? new ModelConfigService(pool, {
    encryptionKey: config.credentialEncryptionKey,
    asrTimeoutMs: config.asrTimeoutMs,
    llmTuning: config.llmTuning,
  })
  const aiUsage = new AiUsageService(pool)
  const aiRouter = new AiRouter({ pool, models, usage: aiUsage })
  // 每次检索/建索引时回数据库解析，后台保存后无需重启；检索与建库分别计量。
  const embedding: EmbeddingResolver = {
    resolve: task => aiRouter.embeddingProvider(task ?? 'embedding.segment'),
  }
  const kb = new KnowledgeService(pool, config, embedding)
  const playback = new PlaybackService(pool, config, auth)
  const events = new EventService(pool)
  const catalog = new CatalogService(
    pool,
    relPath => signFigureUrl(config.mediaSigningSecret, config.mediaBaseUrl, relPath, config.figureSigningTtlSec),
    playback,
  )
  const progress = new ProgressService(pool)
  const content = new ContentService(pool, embedding)
  const resolveAsr = async (): Promise<AsrProvider | undefined> => {
    if (injectedAsr !== undefined) return injectedAsr
    const resolved = await models.resolveAsr()
    return resolved === undefined ? undefined : createAsrProvider(resolved)
  }
  const pipeline = injectedPipeline ?? await createPipelineRuntime({
    pool,
    config,
    metrics,
    log: app.log,
    models,
    ai: aiRouter,
    reindex: (courseId: string) => content.reindex(courseId),
    ...(injectedQuotes === undefined ? {} : { quotes: injectedQuotes }),
  })

  // 对象存储后端（生产媒体走 COS）：只建一次，播放与图示共用
  const cos = config.cos === undefined ? undefined : createCosStore(config.cos)

  registerAuthRoutes(app, { auth, accounts, config, limiter })
  registerAccountRoutes(app, { accounts, config, limiter })
  registerPortalRoutes(app, { accounts, config, limiter, pool })
  registerModelConfigRoutes(app, { models, accounts, config, limiter })
  registerAiRoutes(app, { pool, models, accounts, config, limiter })
  registerKbRoutes(app, { kb, auth, config, limiter })
  registerPlaybackRoutes(app, { playback, auth })
  registerEventRoutes(app, { events, auth, config, limiter })
  registerCatalogRoutes(app, { catalog, auth, config, limiter })
  registerProgressRoutes(app, { progress, auth, config, limiter })
  registerAsrRoutes(app, {
    ...(injectedAsr === undefined ? {} : { asr: injectedAsr }),
    resolveAsr,
    auth,
    config,
    limiter,
  })
  registerContentRoutes(app, { content, accounts, config, limiter })
  const pipelineConfig = config.pipeline
  const production = new ProductionService({
    pool,
    embedding,
    usage: aiUsage,
    searchMinConfidence: config.searchMinConfidence,
    recallWindow: 60,
    ...(pipelineConfig === undefined
      ? {}
      : {
          keyframeRoot: join(pipelineConfig.storageDir, 'work'),
          extractKeyframe: (assetId: string, sec: number) => createLocalMediaProcessor({
            store: createLocalMediaStore({ storageDir: pipelineConfig.storageDir, hlsDir: pipelineConfig.hlsDir }),
            tools: { ffmpegPath: pipelineConfig.ffmpegPath, ffprobePath: pipelineConfig.ffprobePath },
            maxSourceSeconds: pipelineConfig.maxSourceSeconds,
          }).extractKeyframe(assetId, sec, { timeoutMs: pipelineConfig.ffmpegTimeoutMs }),
        }),
    ...(config.figureLocalDir === undefined ? {} : { figureStore: createFigureStore(config.figureLocalDir) }),
  })
  registerProductionRoutes(app, { service: production, accounts, config, limiter, playback, pool })
  await registerPipelineRoutes(app, { api: pipeline.api, accounts, config, limiter, ...(cos === undefined ? {} : { cos }) })
  if (config.mediaLocalDir !== undefined || cos !== undefined) {
    registerMediaRoutes(app, { config, pool, ...(cos === undefined ? {} : { cos }) })
  }

  app.addHook('onClose', async () => pipeline.stop())
  if (startPipeline) await pipeline.start()

  const adminDir = join(process.cwd(), 'dist', 'admin')
  const adminStatic = existsSync(join(adminDir, 'index.html'))
  if (adminStatic) {
    await app.register(fastifyStatic, {
      root: adminDir,
      prefix: '/admin/',
      index: ['index.html'],
      cacheControl: false,
      // 入口页每次回源，避免发布后仍用旧 bundle；哈希资源可长缓存。
      setHeaders: (reply, filePath) => {
        reply.header(
          'cache-control',
          filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
        )
      },
    })
    app.get('/admin', async (_request, reply) => reply.redirect('/admin/'))
  }

  // 教员生产端一键安装脚本：脚本本体在 content/ 下（compose 挂宿主目录，
  // 改完即时生效），响应时把站点地址填进去——教员一条命令就能装。
  const installerFile = join(process.cwd(), 'content', 'install-producer.sh')
  if (existsSync(installerFile)) {
    app.get('/install-producer.sh', async (_request, reply) => {
      const template = await readFile(installerFile, 'utf8')
      return reply
        .header('cache-control', 'no-store')
        .type('text/plain; charset=utf-8')
        .send(template.replaceAll('__BASE_URL__', config.publicBaseUrl))
    })
  }

  // 公开门户：预渲染产物按文件精确注册，不做通配，避免遮蔽 /v1。
  const portalDir = join(process.cwd(), 'dist', 'portal')
  const portalStatic = existsSync(join(portalDir, 'index.html'))
  const portalRoutes = new Map<string, string>()
  const portalPages = new Map<string, string>()

  const readPortalPage = async (file: string): Promise<string | undefined> => {
    const cached = portalPages.get(file)
    if (cached !== undefined) return cached
    try {
      const html = await readFile(join(portalDir, file), 'utf8')
      portalPages.set(file, html)
      return html
    } catch {
      return undefined
    }
  }

  if (portalStatic) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(portalDir, 'routes.json'), 'utf8'))
      if (typeof raw === 'object' && raw !== null) {
        for (const [route, file] of Object.entries(raw)) {
          if (
            typeof file === 'string'
            && file.endsWith('.html')
            && !file.includes('..')
            && !file.startsWith('/')
          ) {
            portalRoutes.set(route, file)
          }
        }
      }
    } catch {
      app.log.warn('portal routes.json missing or invalid; deep links fall back to shell')
    }

    await app.register(fastifyStatic, {
      root: portalDir,
      prefix: '/',
      wildcard: false,
      decorateReply: false,
      index: false,
      cacheControl: false,
      setHeaders: (reply: FastifyReply, filePath: string) => {
        const name = filePath.split(sep).pop() ?? ''
        if (name.endsWith('.html') || name === 'routes.json') {
          reply.header('cache-control', 'no-store')
        } else if (name.endsWith('.sh')) {
          // 安装脚本随站点演进，缓存住会教员拿到旧版。
          reply.header('cache-control', 'no-store')
        } else if (name === 'sitemap.xml' || name === 'robots.txt') {
          reply.header('cache-control', 'public, max-age=3600')
        } else {
          reply.header('cache-control', 'public, max-age=31536000, immutable')
        }
      },
    })
  }

  // 下载制品：独立于门户静态（插件包不依赖门户构建），且 wildcard 必须为 true——
  // wildcard:false 时 @fastify/static 在注册那一刻 glob 目录并按文件建路由，之后发布的
  // 制品（发布脚本在服务运行中落盘）会一直 404 直到重启服务。下载目录是运行期产物。
  const downloadsDir = join(process.cwd(), 'dist', 'downloads')
  mkdirSync(downloadsDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: downloadsDir,
    prefix: '/downloads/',
    wildcard: true,
    decorateReply: false,
    index: false,
    cacheControl: false,
    setHeaders: (reply: FastifyReply, filePath: string) => {
      reply.header('cache-control', 'public, max-age=86400')
      reply.header('content-disposition', `attachment; filename="${basename(filePath).replace(/"/g, '')}"`)
    },
  })

  // 深链由前端路由处理；只接管浏览器导航，API 404 保持原样。
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = (request.raw.url ?? '').split('?')[0] ?? ''
    const acceptsHtml = (request.headers.accept ?? '').includes('text/html')
    if (
      adminStatic
      && request.method === 'GET'
      && pathname.startsWith('/admin/')
      && !/\.[^/]+$/.test(pathname)
      && acceptsHtml
    ) {
      return reply.header('cache-control', 'no-store').type('text/html').sendFile('index.html')
    }
    if (
      portalStatic
      && request.method === 'GET'
      && acceptsHtml
      && !/\.[^/]+$/.test(pathname)
      && !pathname.startsWith('/v1/')
      && !pathname.startsWith('/admin')
    ) {
      const normalized = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname
      const matched = portalRoutes.get(normalized)
      const file = matched ?? portalRoutes.get('_shell') ?? 'shell.html'
      const html = await readPortalPage(file)
      if (html !== undefined) {
        reply.header('cache-control', 'no-store')
        if (matched === undefined) reply.header('x-robots-tag', 'noindex')
        return reply.type('text/html').send(html)
      }
    }
    return reply.code(404).send({ error: 'not found', requestId: request.id })
  })

  return app
}
