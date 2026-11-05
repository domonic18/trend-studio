/** 云端 /v1/admin/content/* 客户端：入参 zod 白名单 → Bearer 请求 → 状态码映射 → 出参边界校验。 */
import { readJsonResponse, UpstreamError, errorPayload } from '../errors.js'
import type { AuthRequester } from './auth.js'
import {
  caseStocksWriteInput,
  caseStocksWriteOutput,
  conceptEdgeWriteInput,
  conceptEdgeWriteOutput,
  conceptWriteInput,
  conceptWriteOutput,
  conceptsListInput,
  conceptsListOutput,
  figureWriteInput,
  figureWriteOutput,
  framesInput,
  framesOutput,
  parseInput,
  parseOutput,
  pipelineStatusInput,
  pipelineStatusOutput,
  transcriptOutput,
  provenanceEntry,
  provenanceOutput,
  sectionArticleWriteInput,
  sectionArticleWriteOutput,
  sectionPreviewInput,
  sectionPreviewOutput,
  sectionsListInput,
  sectionsListOutput,
  sectionWriteInput,
  sectionWriteOutput,
  sourceUnitsSearchInput,
  sourceUnitsSearchOutput,
  sourceUnitsReadInput,
  sourceUnitsReadOutput,
  sourceUnitsWriteInput,
  sourceUnitsWriteOutput,
  widgetWriteInput,
  widgetWriteOutput,
  type CaseStocksWriteOutput,
  type ConceptEdgeWriteOutput,
  type ConceptWriteOutput,
  type ConceptsListOutput,
  type FigureWriteOutput,
  type FramesOutput,
  type PipelineStatusOutput,
  type ProvenanceOutput,
  type SectionArticleWriteOutput,
  type SectionPreviewOutput,
  type SectionsListOutput,
  type SectionWriteOutput,
  type SourceUnitsSearchOutput,
  type SourceUnitsReadOutput,
  type SourceUnitsWriteOutput,
  type TranscriptOutput,
  type WidgetWriteOutput,
} from './contracts.js'

const CONTENT_BASE = '/v1/admin/content'

export class TrendCloudClient {
  constructor(private readonly auth: AuthRequester) {}

  /** 非 2xx 统一转 UpstreamError：保留状态码与业务码（assertion_unproven 等），模型按码回灌。 */
  private async send(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = body === undefined ? {} : { 'content-type': 'application/json' }
    const response = await this.auth.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      signal,
    )
    const payload = await readJsonResponse(response, '云端服务')
    if (!response.ok) {
      const { code, message, detail } = errorPayload(payload)
      throw new UpstreamError(
        response.status,
        code,
        detail,
        message === '' ? `云端请求失败（HTTP ${response.status}）` : message,
      )
    }
    // 2xx 带业务错误字段属于契约外状态：按业务冲突处理，不带病继续。
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const { code, message, detail } = errorPayload(payload)
      throw new UpstreamError(409, code, detail, message === '' ? '云端返回业务错误' : message)
    }
    return payload
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.send(path, 'GET', undefined, signal)
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.send(path, 'POST', body, signal)
  }

  private async put(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.send(path, 'PUT', body, signal)
  }

  async pipelineStatus(input: unknown, signal?: AbortSignal): Promise<PipelineStatusOutput> {
    const query = parseInput(pipelineStatusInput, input, 'pipelineStatus')
    const params = new URLSearchParams()
    if (query.assetId !== undefined) params.set('assetId', query.assetId)
    if (query.courseId !== undefined) params.set('courseId', query.courseId)
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    const payload = await this.get(`${CONTENT_BASE}/pipeline/jobs?${params.toString()}`, signal)
    const parsed = parseOutput(pipelineStatusOutput, payload, 'pipelineStatus')
    return { jobs: parsed.jobs, total: parsed.total }
  }

  /** 转写分页拉取：理解阶段的文本原料；分段带全局毫秒时间戳。 */
  async getTranscript(input: { assetId: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<TranscriptOutput> {
    const params = new URLSearchParams()
    params.set('assetId', input.assetId)
    const offset = input.offset ?? 0
    const limit = input.limit ?? 100
    params.set('offset', String(offset))
    params.set('limit', String(limit))
    const payload = await this.get(
      `${CONTENT_BASE}/media-assets/${input.assetId}/transcript?${params.toString()}`,
      signal,
    )
    return parseOutput(transcriptOutput, payload, 'transcript')
  }

  async frames(input: unknown, signal?: AbortSignal): Promise<FramesOutput> {
    const query = parseInput(framesInput, input, 'frames')
    const params = new URLSearchParams()
    if (query.from !== undefined) params.set('from', String(query.from))
    if (query.to !== undefined) params.set('to', String(query.to))
    const payload = await this.get(
      `${CONTENT_BASE}/media-assets/${query.assetId}/frames?${params.toString()}`,
      signal,
    )
    return parseOutput(framesOutput, payload, 'frames')
  }

  async writeSourceUnits(input: unknown, signal?: AbortSignal): Promise<SourceUnitsWriteOutput> {
    const body = parseInput(sourceUnitsWriteInput, input, 'sourceUnitsWrite')
    const payload = await this.post(`${CONTENT_BASE}/source-units`, body, signal)
    return parseOutput(sourceUnitsWriteOutput, payload, 'sourceUnitsWrite')
  }

  async searchSourceUnits(input: unknown, signal?: AbortSignal): Promise<SourceUnitsSearchOutput> {
    const query = parseInput(sourceUnitsSearchInput, input, 'sourceUnitsSearch')
    const params = new URLSearchParams()
    params.set('assetId', query.assetId)
    if (query.q !== undefined) params.set('q', query.q)
    if (query.conceptId !== undefined) params.set('conceptId', query.conceptId)
    if (query.cursor !== undefined) params.set('cursor', query.cursor)
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    const payload = await this.get(`${CONTENT_BASE}/source-units?${params.toString()}`, signal)
    return parseOutput(sourceUnitsSearchOutput, payload, 'sourceUnitsSearch')
  }

  /**
   * 证据读取：按 unitId 批量取转写原文、视觉描述、窗内关键帧与播放会话。
   * 全有或全无——任一 unitId 不可读即 409 unit_not_readable。
   */
  async readSourceUnits(input: unknown, signal?: AbortSignal): Promise<SourceUnitsReadOutput> {
    const body = parseInput(sourceUnitsReadInput, input, 'sourceUnitsRead')
    const payload = await this.post(`${CONTENT_BASE}/source-units/read`, body, signal)
    return parseOutput(sourceUnitsReadOutput, payload, 'sourceUnitsRead')
  }

  async writeConcept(input: unknown, signal?: AbortSignal): Promise<ConceptWriteOutput> {
    const body = parseInput(conceptWriteInput, input, 'conceptWrite')
    return parseOutput(conceptWriteOutput, await this.put(`${CONTENT_BASE}/concepts`, body, signal), 'conceptWrite')
  }

  async listConcepts(input: unknown, signal?: AbortSignal): Promise<ConceptsListOutput> {
    const query = parseInput(conceptsListInput, input, 'conceptsList')
    return parseOutput(
      conceptsListOutput,
      await this.get(`${CONTENT_BASE}/concepts?courseId=${encodeURIComponent(query.courseId)}`, signal),
      'conceptsList',
    )
  }

  async writeConceptEdge(input: unknown, signal?: AbortSignal): Promise<ConceptEdgeWriteOutput> {
    const body = parseInput(conceptEdgeWriteInput, input, 'conceptEdgeWrite')
    return parseOutput(conceptEdgeWriteOutput, await this.post(`${CONTENT_BASE}/concept-edges`, body, signal), 'conceptEdgeWrite')
  }

  async listSections(input: unknown, signal?: AbortSignal): Promise<SectionsListOutput> {
    const query = parseInput(sectionsListInput, input, 'sectionsList')
    const params = new URLSearchParams()
    params.set('courseId', query.courseId)
    if (query.chapterId !== undefined) params.set('chapterId', query.chapterId)
    return parseOutput(sectionsListOutput, await this.get(`${CONTENT_BASE}/sections?${params.toString()}`, signal), 'sectionsList')
  }

  async writeSection(input: unknown, signal?: AbortSignal): Promise<SectionWriteOutput> {
    const body = parseInput(sectionWriteInput, input, 'sectionWrite')
    return parseOutput(sectionWriteOutput, await this.put(`${CONTENT_BASE}/sections`, body, signal), 'sectionWrite')
  }

  async writeSectionArticle(input: unknown, signal?: AbortSignal): Promise<SectionArticleWriteOutput> {
    const body = parseInput(sectionArticleWriteInput, input, 'sectionArticleWrite')
    const payload = await this.put(
      `${CONTENT_BASE}/sections/${body.sectionId}/article`,
      { markdown: body.markdown, citations: body.citations },
      signal,
    )
    return parseOutput(sectionArticleWriteOutput, payload, 'sectionArticleWrite')
  }

  async writeWidget(input: unknown, signal?: AbortSignal): Promise<WidgetWriteOutput> {
    const body = parseInput(widgetWriteInput, input, 'widgetWrite')
    const payload = await this.post(
      `${CONTENT_BASE}/sections/${body.sectionId}/widgets`,
      {
        type: body.type,
        specVersion: body.specVersion,
        spec: body.spec,
        assertions: body.assertions,
        citations: body.citations,
      },
      signal,
    )
    return parseOutput(widgetWriteOutput, payload, 'widgetWrite')
  }

  /** 节预览读回：主编评审（门禁②）要看到教材正文、课件 spec 与图示，不能只写不读。 */
  async sectionPreview(input: unknown, signal?: AbortSignal): Promise<SectionPreviewOutput> {
    const query = parseInput(sectionPreviewInput, input, 'sectionPreview')
    const payload = await this.get(`${CONTENT_BASE}/sections/${query.sectionId}/preview`, signal)
    return parseOutput(sectionPreviewOutput, payload, 'sectionPreview')
  }

  async writeSectionFigure(input: unknown, signal?: AbortSignal): Promise<FigureWriteOutput> {
    const body = parseInput(figureWriteInput, input, 'figureWrite')
    const payload = await this.post(`${CONTENT_BASE}/sections/${body.sectionId}/figures`, body, signal)
    return parseOutput(figureWriteOutput, payload, 'figureWrite')
  }

  async writeSectionCaseStocks(input: unknown, signal?: AbortSignal): Promise<CaseStocksWriteOutput> {
    const body = parseInput(caseStocksWriteInput, input, 'caseStocksWrite')
    const payload = await this.put(`${CONTENT_BASE}/sections/${body.sectionId}/case-stocks`, { stocks: body.stocks }, signal)
    return parseOutput(caseStocksWriteOutput, payload, 'caseStocksWrite')
  }

  async reportProvenance(input: unknown, signal?: AbortSignal): Promise<ProvenanceOutput> {
    const body = parseInput(provenanceEntry, input, 'provenance')
    return parseOutput(provenanceOutput, await this.post(`${CONTENT_BASE}/provenance`, body, signal), 'provenance')
  }
}

