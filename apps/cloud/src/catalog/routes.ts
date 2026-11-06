import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AuthService, Principal } from '../auth/service.js'
import type { AppConfig } from '../config.js'
import { HttpError, tooManyRequests } from '../errors.js'
import { requirePrincipal } from '../http/principal.js'
import type { RateLimiter } from '../rate-limit.js'
import { parseQuoteCodes, parseQuoteDate, parseQuotePeriod } from './quotes.js'
import { CatalogService } from './service.js'

export interface CatalogRouteDeps {
  catalog: CatalogService
  auth: AuthService
  config: AppConfig
  limiter: RateLimiter
}

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  const { catalog, auth, config, limiter } = deps

  const guard = async (request: FastifyRequest): Promise<Principal> => {
    const principal = await requirePrincipal(request, auth)
    if (!limiter.take(`catalog:${principal.deviceId}`, config.rateLimitCatalogPerMinute)) {
      throw tooManyRequests()
    }
    return principal
  }

  app.get('/v1/catalog/courses', async request => {
    const principal = await guard(request)
    return catalog.listCourses(principal.userId)
  })

  app.get('/v1/catalog/courses/:courseId', async request => {
    const principal = await guard(request)
    const { courseId } = request.params as { courseId: string }
    return catalog.getCourse(courseId, principal.userId)
  })

  app.get('/v1/catalog/courses/:courseId/quotes', async request => {
    await guard(request)
    const { courseId } = request.params as { courseId: string }
    const query = (request.query ?? {}) as Record<string, unknown>
    const codes = typeof query.codes === 'string' ? parseQuoteCodes(query.codes) : undefined
    const from = typeof query.from === 'string' ? parseQuoteDate(query.from, 'from') : undefined
    const to = typeof query.to === 'string' ? parseQuoteDate(query.to, 'to') : undefined
    const period = typeof query.period === 'string' ? parseQuotePeriod(query.period) : undefined
    if (from !== undefined && to !== undefined && from > to) {
      throw new HttpError(400, 'from must not be after to')
    }
    return catalog.getQuotes(courseId, {
      ...(codes === undefined ? {} : { codes }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(period === undefined ? {} : { period }),
    })
  })

  app.get('/v1/catalog/courses/:courseId/chapters/:chapterId', async request => {
    await guard(request)
    const { courseId, chapterId } = request.params as { courseId: string; chapterId: string }
    return catalog.getChapter(courseId, chapterId)
  })

  /** v3 节级学习契约：正文 + 课件 + 图示 + 案例股。 */
  app.get('/v1/catalog/courses/:courseId/sections/:sectionId', async request => {
    await guard(request)
    const { courseId, sectionId } = request.params as { courseId: string; sectionId: string }
    return catalog.getSection(courseId, sectionId)
  })

  /** 学员播放会话：请求窗必须完整落在该节已发布正文的 clip 窗内，否则 409。 */
  app.post('/v1/catalog/sections/:sectionId/playback', async request => {
    const principal = await guard(request)
    const { sectionId } = request.params as { sectionId: string }
    return catalog.createPlayback(principal, sectionId, request.body)
  })

  app.get('/v1/catalog/knowledge-points/:knowledgePointId', async request => {
    await guard(request)
    const { knowledgePointId } = request.params as { knowledgePointId: string }
    return catalog.getKnowledgePoint(knowledgePointId)
  })
}
