/** /v1/admin/content 语料级生产接口（M9/M10/M3b）：operator/admin/producer 会话；发布与审批仍在 pipeline 命名空间（operator/admin）。 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AccountService } from '../accounts/service.js'
import type { AppConfig } from '../config.js'
import { parseContentId, titleField } from '../content/service.js'
import { badRequest, tooManyRequests } from '../errors.js'
import { requireSession } from '../http/principal.js'
import { asObject, intField, jsonObjectField, optionalStringField, stringField } from '../http/validation.js'
import { signKeyframeUrl } from '../media/keyframe-sign.js'
import { readQuotes, parseQuoteCodes, parseQuoteDate } from '../quotes/read.js'
import type { PlaybackService } from '../playback/service.js'
import { RateLimiter } from '../rate-limit.js'
import { parseSectionId, parseSourceUnitId, ProductionService } from './service.js'
import { stringRecord } from './widgets/schema.js'

export interface ProductionRouteDeps {
  service: ProductionService
  accounts: AccountService
  config: AppConfig
  limiter: RateLimiter
  playback: PlaybackService
}

function queryText(query: Record<string, unknown>, key: string): string | undefined {
  return typeof query[key] === 'string' && query[key] !== '' ? String(query[key]) : undefined
}

function queryInt(query: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const raw = query[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

export async function registerProductionRoutes(app: FastifyInstance, deps: ProductionRouteDeps): Promise<void> {
  const { service, accounts, config, limiter, playback } = deps

  const guard = async (request: FastifyRequest) => {
    const principal = await requireSession(request, accounts, ['operator', 'admin', 'producer'])
    if (!limiter.take(`production:${principal.userId}`, config.rateLimitContentPerMinute)) {
      throw tooManyRequests()
    }
    return principal
  }

  function optionalInt(body: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
    if (body[key] === undefined) return undefined
    return intField(body, key, { min, max })
  }

  app.get('/v1/admin/content/media-assets/:assetId/frames', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const assetId = stringField(params, 'assetId', { max: 22, pattern: /^asset_[0-9a-f]{16}$/ })
    const query = asObject(request.query as unknown)
    const fromMs = queryInt(query, 'from', 0, 0, 86_400_000)
    const toMs = queryInt(query, 'to', 3_600_000, 1, 86_400_000)
    if (toMs <= fromMs || toMs - fromMs > 3_600_000) {
      throw badRequest('frames range must be within one hour and ascending')
    }
    await service.assertAssetExists(assetId)
    const frames = await service.listKeyframes(assetId, fromMs, toMs)
    const hasLater = await service.hasKeyframesFrom(assetId, toMs)
    return reply.send({
      frames: frames.map(frame => ({
        ...frame,
        url: signKeyframeUrl(config.mediaSigningSecret, config.mediaBaseUrl, `${assetId}/keyframes/${frame.sec}.jpg`, config.keyframeSigningTtlSec),
      })),
      nextFrom: hasLater ? toMs : null,
    })
  })

  app.post('/v1/admin/content/media-assets/:assetId/playback-sessions', async (request, reply) => {
    const principal = await guard(request)
    const params = asObject(request.params as unknown)
    const assetId = stringField(params, 'assetId', { max: 22, pattern: /^asset_[0-9a-f]{16}$/ })
    const body = asObject(request.body ?? {})
    const fromSec = optionalInt(body, 'fromSec', 0, 86_400)
    const toSec = optionalInt(body, 'toSec', 0, 86_400)
    return reply.code(201).send(await playback.createAssetSession(principal, assetId, {
      ...(fromSec === undefined ? {} : { fromSec }),
      ...(toSec === undefined ? {} : { toSec }),
    }))
  })

  app.post('/v1/admin/content/source-units', async (request, reply) => {
    await guard(request)
    const body = asObject(request.body)
    const units = body.units
    if (!Array.isArray(units)) throw badRequest('units must be an array')
    return reply.send(await service.createSourceUnits(units))
  })

  app.get('/v1/admin/content/source-units', async (request, reply) => {
    await guard(request)
    const query = asObject(request.query as unknown)
    const assetId = stringField(query, 'assetId', { max: 22, pattern: /^asset_[0-9a-f]{16}$/ })
    const q = queryText(query, 'q')
    const conceptId = queryText(query, 'conceptId')
    const cursor = queryText(query, 'cursor')
    return reply.send(await service.searchSourceUnits({
      assetId,
      ...(q === undefined ? {} : { q: stringField({ q }, 'q', { min: 1, max: 500 }) }),
      ...(conceptId === undefined ? {} : { conceptId }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: queryInt(query, 'limit', 20, 1, 50),
    }))
  })

  app.post('/v1/admin/content/source-units/read', async (request, reply) => {
    const principal = await guard(request)
    const body = asObject(request.body ?? {})
    const evidence = await service.readSourceUnits(body.unitIds)
    const units = []
    for (const unit of evidence.units) {
      const fromSec = Math.floor(unit.startMs / 1000)
      const toSec = Math.min(Math.ceil(unit.endMs / 1000), fromSec + 3600)
      const session = await playback.createAssetSession(principal, unit.assetId, { fromSec, toSec })
      units.push({
        unitId: unit.unitId,
        assetId: unit.assetId,
        startMs: unit.startMs,
        endMs: unit.endMs,
        transcriptText: unit.transcriptText,
        visual: unit.visual,
        keyframes: unit.keyframes.map(frame => ({
          ...frame,
          url: signKeyframeUrl(
            config.mediaSigningSecret,
            config.mediaBaseUrl,
            `${unit.assetId}/keyframes/${frame.sec}.jpg`,
            config.keyframeSigningTtlSec,
          ),
        })),
        playback: {
          playlistUrl: session.playlistUrl,
          fromSec: session.fromSec ?? fromSec,
          toSec: session.toSec ?? toSec,
          expiresAt: session.expiresAt,
        },
      })
    }
    return reply.send({ units })
  })

  app.post('/v1/admin/content/source-units/reindex', async (request, reply) => {
    await guard(request)
    const body = request.body === undefined ? {} : asObject(request.body)
    return reply.send(await service.reindexSourceUnits(
      intField(body, 'limit', { min: 1, max: 500, fallback: 200 }),
    ))
  })

  app.get('/v1/admin/content/concepts', async (request, reply) => {
    await guard(request)
    const query = asObject(request.query as unknown)
    return reply.send(await service.listConcepts(
      parseContentId(stringField(query, 'courseId', { max: 64 }), 'courseId'),
    ))
  })

  app.put('/v1/admin/content/concepts', async (request, reply) => {
    await guard(request)
    const body = asObject(request.body)
    const definition = optionalStringField(body, 'definition', { min: 1, max: 2000 })
    const result = await service.putConcept({
      courseId: parseContentId(stringField(body, 'courseId', { max: 64 }), 'courseId'),
      name: stringField(body, 'name', { min: 1, max: 200 }),
      ...(body.aliases === undefined ? {} : { aliases: body.aliases }),
      ...(definition === undefined ? {} : { definition }),
    })
    return reply.send(result)
  })

  app.post('/v1/admin/content/concept-edges', async (request, reply) => {
    await guard(request)
    const body = asObject(request.body)
    const kind = stringField(body, 'kind', { min: 1, max: 20 })
    if (kind !== 'prerequisite' && kind !== 'related') throw badRequest('kind must be prerequisite or related')
    return reply.send(await service.createConceptEdge({
      courseId: parseContentId(stringField(body, 'courseId', { max: 64 }), 'courseId'),
      fromConceptId: stringField(body, 'fromConceptId', { max: 20, pattern: /^cpt_[0-9a-f]{16}$/ }),
      toConceptId: stringField(body, 'toConceptId', { max: 20, pattern: /^cpt_[0-9a-f]{16}$/ }),
      kind,
    }))
  })

  app.get('/v1/admin/content/courses/:courseId/preview', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const courseId = parseContentId(stringField(params, 'courseId', { max: 64 }), 'courseId')
    return reply.send(await service.getCoursePreview(courseId))
  })

  app.get('/v1/admin/content/courses/:courseId/quotes', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const courseId = parseContentId(stringField(params, 'courseId', { max: 64 }), 'courseId')
    const query = asObject(request.query as unknown)
    const codes = queryText(query, 'codes')
    const from = queryText(query, 'from')
    const to = queryText(query, 'to')
    return reply.send(await service.getCourseQuotes(courseId, {
      ...(codes === undefined ? {} : { codes: parseQuoteCodes(codes) }),
      ...(from === undefined ? {} : { from: parseQuoteDate(from, 'from') }),
      ...(to === undefined ? {} : { to: parseQuoteDate(to, 'to') }),
    }))
  })

  app.get('/v1/admin/content/sections', async (request, reply) => {
    await guard(request)
    const query = asObject(request.query as unknown)
    const courseId = parseContentId(stringField(query, 'courseId', { max: 64 }), 'courseId')
    const chapterId = queryText(query, 'chapterId')
    return reply.send({
      sections: await service.listSections(
        courseId,
        chapterId === undefined ? undefined : parseContentId(chapterId, 'chapterId'),
      ),
    })
  })

  app.put('/v1/admin/content/sections', async (request, reply) => {
    await guard(request)
    const body = asObject(request.body)
    const sectionId = body.sectionId === undefined ? undefined : parseSectionId(String(body.sectionId))
    const summary = optionalStringField(body, 'summary', { min: 1, max: 2000 })
    const section = await service.putSection({
      ...(sectionId === undefined ? {} : { sectionId }),
      courseId: parseContentId(stringField(body, 'courseId', { max: 64 }), 'courseId'),
      chapterId: parseContentId(stringField(body, 'chapterId', { max: 64 }), 'chapterId'),
      title: titleField(body),
      position: intField(body, 'position', { min: 1, max: 10_000 }),
      ...(summary === undefined ? {} : { summary }),
      ...(body.sourceAssetIds === undefined ? {} : { sourceAssetIds: body.sourceAssetIds }),
      ...(body.conceptRefs === undefined ? {} : { conceptRefs: body.conceptRefs }),
    })
    return reply.send({ section })
  })

  app.put('/v1/admin/content/sections/:sectionId/article', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    const body = asObject(request.body)
    const citations = body.citations
    if (!Array.isArray(citations)) throw badRequest('citations must be an array')
    if (citations.length > 100) throw badRequest('citations must contain at most 100 ids')
    const markdown = stringField(body, 'markdown', { min: 1, max: 20_000 })
    return reply.send(await service.putArticle(sectionId, markdown, citations.map((entry, index) => {
      if (typeof entry !== 'string') throw badRequest(`citations[${index}] must be a string`)
      return parseSourceUnitId(entry)
    })))
  })

  app.get('/v1/admin/content/sections/:sectionId/widgets', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.listWidgets(sectionId))
  })

  app.get('/v1/admin/content/sections/:sectionId/preview', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.getSectionPreview(sectionId))
  })

  app.post('/v1/admin/content/sections/:sectionId/widgets', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.createWidget(sectionId, request.body))
  })

  app.delete('/v1/admin/content/sections/:sectionId/widgets/:widgetId', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    const widgetId = stringField(params, 'widgetId', { max: 20, pattern: /^wgt_[0-9a-f]{16}$/ })
    await service.deleteWidget(sectionId, widgetId)
    return reply.code(204).send()
  })

  app.get('/v1/admin/content/sections/:sectionId/figures', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.listSectionFigures(sectionId))
  })

  app.post('/v1/admin/content/sections/:sectionId/figures', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.code(201).send(await service.createSectionFigure(sectionId, request.body))
  })

  app.get('/v1/admin/content/sections/:sectionId/case-stocks', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.listSectionCaseStocks(sectionId))
  })

  app.put('/v1/admin/content/sections/:sectionId/case-stocks', async (request, reply) => {
    await guard(request)
    const params = asObject(request.params as unknown)
    const sectionId = parseSectionId(stringField(params, 'sectionId', { max: 20 }))
    return reply.send(await service.upsertSectionCaseStocks(sectionId, request.body))
  })

  app.post('/v1/admin/content/provenance', async (request, reply) => {
    await guard(request)
    const body = asObject(request.body)
    const status = stringField(body, 'status', { min: 1, max: 10 })
    if (status !== 'success' && status !== 'error') throw badRequest('status must be success or error')
    const skillVersions = body.skillVersions === undefined
      ? undefined
      : stringRecord(body.skillVersions, 'skillVersions', 20)
    const provider = optionalStringField(body, 'provider', { min: 1, max: 32 })
    const errorCode = optionalStringField(body, 'errorCode', { min: 1, max: 64 })
    const targetId = optionalStringField(body, 'targetId', { min: 1, max: 200 })
    const summary = jsonObjectField(body, 'summary')
    const result = await service.reportProvenance({
      taskKey: stringField(body, 'taskKey', { min: 1, max: 64 }),
      model: stringField(body, 'model', { min: 1, max: 200 }),
      ...(provider === undefined ? {} : { provider }),
      ...(body.inputTokens === undefined ? {} : { inputTokens: intField(body, 'inputTokens', { min: 0, max: 10_000_000 }) }),
      ...(body.outputTokens === undefined ? {} : { outputTokens: intField(body, 'outputTokens', { min: 0, max: 10_000_000 }) }),
      ...(body.cachedTokens === undefined ? {} : { cachedTokens: intField(body, 'cachedTokens', { min: 0, max: 10_000_000 }) }),
      ...(body.latencyMs === undefined ? {} : { latencyMs: intField(body, 'latencyMs', { min: 0, max: 3_600_000 }) }),
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(skillVersions === undefined ? {} : { skillVersions }),
      ...(targetId === undefined ? {} : { targetId }),
      ...(summary === undefined ? {} : { summary }),
    })
    return reply.code(202).send(result)
  })
}
