/**
 * 理解阶段执行器（F2 阶段 1）：确定性循环——分块规划 → 帧 + 转写 → VLM →
 * 归一化 → 写库 → 溯源。帧字节在 Host 内直连视觉模型，不进 agent 上下文
 * （dsh 只有 user 消息可带图，工具结果回图会撑爆对话）。
 * 模型选型与红线见架构 §6.5.2 与 skills/transcript-understanding。
 */
import { UpstreamError, errorPayload } from '../errors.js'
import type { TrendCloudClient } from './cloud-client.js'
import type { UnderstandingConfig } from './config.js'
import { diffUnderstandingTodos, normalizeKeyframes, planUnderstandingChunks, type ChunkTodo, type TranscriptSegment } from './orchestrator.js'
import type { ModelKeyResolver } from './model-key.js'

const CHART_TYPES = new Set(['kline', 'indicator', 'annotation', 'talking-head', 'text-slide', 'other'])

export const UNDERSTANDING_SYSTEM_PROMPT = (
  '你是趋势交易课程的理解 Agent。给定一段课时的转写文本与该时段的关键帧序列，产出结构化理解产物。要求：\n'
  + '1. 画面描述必须写清屏幕上实际出现的内容：K线/均线/指标名称/形态标注/文字标题与具体数值，'
  + '转写里没有而画面里有的信息必须写进画面描述。\n'
  + '2. 图表类型从枚举中选：kline(行情K线) | indicator(指标面板) | annotation(形态标注) '
  + '| talking-head(讲师口播) | text-slide(文字板书) | other，按该段主要画面判定。\n'
  + '3. summary 是 100 字内本段讲解要点，中文短句。\n'
  + '4. 严格输出 JSON 数组，每段讲解一个对象：'
  + '{"startMs":整数,"endMs":整数,"transcriptText":"原文摘录","visual":{"description":"画面描述",'
  + '"chartType":"枚举值","keyframes":[{"sec":整数}]},"summary":"要点"}。'
  + 'startMs/endMs 是素材绝对毫秒，必须落在给定窗口内且 endMs 大于 startMs；'
  + 'keyframes.sec 取本窗口提供的真实帧秒值，统一写对象形态 {"sec":秒}。只输出 JSON 数组，不要解释。'
)

export interface UnderstandingRunOptions {
  assetId: string
  /** 只跑指定窗口（断点续跑入口）；缺省 = 全量差集。 */
  window?: { startMs: number; endMs: number }
  signal?: AbortSignal
}

export interface ChunkResult {
  index: number
  startMs: number
  endMs: number
  units: number
  deduped: number
  inTokens: number
  outTokens: number
  latencyMs: number
}

export interface UnderstandingRunResult {
  planned: number
  ran: number
  skipped: number
  chunks: (ChunkResult & { unitIds: string[] })[]
  unitIds: string[]
  /** A6：转写未完成——本次只覆盖已转写前缀，素材其余部分需后续再跑一次。 */
  partial: boolean
}

interface VlmResponse {
  content: string
  inTokens: number
  outTokens: number
}

/** 中立的多模态输入片段——两种协议的线格式由各自适配层展开。 */
export interface VlmPart {
  text?: string
  imageDataUrl?: string
  label?: string
}

function timeoutSignal(ms: number, extra?: AbortSignal): AbortSignal {
  return extra === undefined ? AbortSignal.timeout(ms) : AbortSignal.any([extra, AbortSignal.timeout(ms)])
}

/** `data:image/jpeg;base64,xxx` → Anthropic 要的 `{ media_type, data }`。 */
function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (match === null) throw new Error('帧图不是 base64 data URL')
  return { mediaType: match[1], data: match[2] }
}

/** Anthropic 消息体：system 独立字段，图片走 base64 source 块。 */
function anthropicContent(parts: VlmPart[]): Record<string, unknown>[] {
  return parts.flatMap(part => {
    if (part.imageDataUrl === undefined) return [{ type: 'text', text: part.text ?? '' }]
    const { mediaType, data } = splitDataUrl(part.imageDataUrl)
    return [
      ...(part.label === undefined ? [] : [{ type: 'text', text: part.label }]),
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    ]
  })
}

/** OpenAI 兼容消息体：图片走 image_url 块。 */
function openaiContent(parts: VlmPart[]): Record<string, unknown>[] {
  return parts.map(part => part.imageDataUrl === undefined
    ? { type: 'text', text: part.text ?? '' }
    : { type: 'image_url', image_url: { url: part.imageDataUrl }, text: part.label })
}

/**
 * 按协议拼出视觉模型请求。
 *
 * 两种协议的路径与鉴权头都不一样：OpenAI 兼容走 `/chat/completions` + `Bearer`，
 * Anthropic 走 `/v1/messages` + `x-api-key`。**拿错协议去打会直接 404**——
 * 装机向导允许两种协议，必须按配置走，不能写死一种。
 */
export function buildVlmRequest(
  config: UnderstandingConfig,
  apiKey: string,
  parts: VlmPart[],
  system: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  if (config.api === 'anthropic-messages') {
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: config.model,
        max_tokens: config.maxTokens,
        system,
        messages: [{ role: 'user', content: anthropicContent(parts) }],
      },
    }
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: openaiContent(parts) },
      ],
      temperature: 0.2,
      max_tokens: config.maxTokens,
    },
  }
}

/** 按协议解析视觉模型响应。 */
export function parseVlmResponse(config: UnderstandingConfig, payload: unknown): VlmResponse {
  const record = payload as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[]
    content?: { type?: string; text?: string }[]
    stop_reason?: string
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
  }
  if (config.api === 'anthropic-messages') {
    // Anthropic 会先回 thinking 块再回 text 块——只取 text，别把思考当答案。
    const text = (record.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('')
    if (text === '') {
      throw new Error(`视觉模型返回空内容 stop=${record.stop_reason ?? 'unknown'}`)
    }
    return {
      content: text,
      inTokens: record.usage?.input_tokens ?? 0,
      outTokens: record.usage?.output_tokens ?? 0,
    }
  }
  const choice = record.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || content === '') {
    throw new Error(`视觉模型返回空内容 finish=${choice?.finish_reason ?? 'unknown'}`)
  }
  return {
    content,
    inTokens: record.usage?.prompt_tokens ?? 0,
    outTokens: record.usage?.completion_tokens ?? 0,
  }
}

async function callVlm(
  request: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
  config: UnderstandingConfig,
  signal?: AbortSignal,
): Promise<VlmResponse> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: timeoutSignal(300_000, signal),
  })
  const payload = await response.json().catch(() => undefined) as unknown
  if (!response.ok) {
    const { code, message } = errorPayload(payload)
    throw new UpstreamError(response.status, code, {}, message === '' ? `视觉模型 HTTP ${response.status}` : message)
  }
  return parseVlmResponse(config, payload)
}

function extractUnits(text: string): unknown[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('视觉模型输出不含 JSON 数组')
  const units = JSON.parse(text.slice(start, end + 1)) as unknown[]
  if (!Array.isArray(units) || units.length === 0) throw new Error('视觉模型输出为空数组')
  return units
}

/** 语义校验 + 归一化；不合法抛错（错误消息回灌一次后仍失败即整窗失败，进人工待办）。 */
export function normalizeUnits(raw: unknown[], assetId: string, model: string, window: { startMs: number; endMs: number }): {
  assetId: string
  startMs: number
  endMs: number
  transcriptText: string
  summary: string
  visual: Record<string, unknown>
  conceptRefs: string[]
  producedBy: { taskKey: string; model: string }
}[] {
  return raw.map(entry => {
    if (typeof entry !== 'object' || entry === null) throw new Error('unit 非对象')
    const unit = entry as Record<string, unknown>
    const startMs = unit.startMs
    const endMs = unit.endMs
    if (typeof startMs !== 'number' || typeof endMs !== 'number' || endMs <= startMs) {
      throw new Error(`时间字段非法: ${JSON.stringify([startMs, endMs])}（窗口 ${window.startMs}–${window.endMs}）`)
    }
    if (startMs < window.startMs - 1_000 || endMs > window.endMs + 60_000) {
      throw new Error(`时间越窗: ${startMs}–${endMs}`)
    }
    const visual = (typeof unit.visual === 'object' && unit.visual !== null ? unit.visual : {}) as Record<string, unknown>
    if (typeof visual.chartType !== 'string' || !CHART_TYPES.has(visual.chartType)) {
      throw new Error(`chartType 非法: ${String(visual.chartType)}`)
    }
    const keyframes = normalizeKeyframes(visual.keyframes)
    return {
      assetId,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      transcriptText: String(unit.transcriptText ?? '').slice(0, 8000) || '（无转写摘录）',
      summary: String(unit.summary ?? '').slice(0, 2000),
      visual: { ...visual, ...(keyframes === undefined ? {} : { keyframes }) },
      conceptRefs: [],
      producedBy: { taskKey: 'content.chunk_summary', model },
    }
  })
}

async function fetchFrameDataUrls(client: TrendCloudClient, assetId: string, todo: ChunkTodo, everyNth: number, signal?: AbortSignal): Promise<{ dataUrl: string; label: string }[]> {
  let cursor: number | null = todo.startMs
  let pool: { sec: number; url: string }[] = []
  while (cursor !== null) {
    const page = await client.frames({ assetId, from: cursor, to: todo.endMs }, signal)
    pool = pool.concat(page.frames.map(frame => ({ sec: frame.sec, url: frame.url })))
    // 云端 nextFrom 语义是"窗口末尾还有更晚帧"（对接清单 §3.13）：该页已覆盖整窗，
    // 继续翻页会得到 from==to 的非法区间被云端 400 拒绝
    cursor = page.nextFrom !== null && page.nextFrom < todo.endMs ? page.nextFrom : null
  }
  const picked = pool.filter((_, i) => i % everyNth === 0)
  const frames: { dataUrl: string; label: string }[] = []
  for (const frame of picked) {
    const response = await fetch(frame.url, { signal: timeoutSignal(20_000, signal) })
    if (!response.ok) throw new Error(`帧拉取失败 HTTP ${response.status} t=${frame.sec}s`)
    const buffer = await response.arrayBuffer()
    frames.push({
      dataUrl: `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`,
      label: `帧 t=${frame.sec}s`,
    })
  }
  return frames
}

export class UnderstandingRunner {
  constructor(
    private readonly client: TrendCloudClient,
    private readonly config: UnderstandingConfig,
    private readonly resolveApiKey: ModelKeyResolver = async (ref: string) => {
      const fromEnv = process.env[ref]
      return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined
    },
  ) {}

  /** 全量或指定窗口的理解执行；返回窗口级摘要供 agent 监督汇报。 */
  async run(options: UnderstandingRunOptions): Promise<UnderstandingRunResult> {
    const { assetId, signal } = options
    const { segments, partial } = await this.readSegments(assetId, signal)
    if (segments.length === 0) throw new Error('素材暂无就绪转写，无法进入理解阶段')

    const durationMs = Math.max(...segments.map(seg => seg.endMs))
    const plans = planUnderstandingChunks(durationMs, segments)
    const existing: number[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await this.client.searchSourceUnits({
        assetId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 50,
      }, signal)
      existing.push(...page.units.map(unit => unit.startMs))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    let todos = diffUnderstandingTodos({ plans, existingStartMs: existing })
    if (options.window !== undefined) {
      todos = todos.filter(todo => todo.startMs >= options.window!.startMs && todo.endMs <= options.window!.endMs)
    }

    const result: UnderstandingRunResult = { planned: plans.length, ran: 0, skipped: plans.length - todos.length, chunks: [], unitIds: [], partial }
    for (const todo of todos) {
      const chunk = await this.runChunk(assetId, todo, signal)
      result.chunks.push(chunk)
      result.unitIds.push(...chunk.unitIds)
      result.ran += 1
    }
    return result
  }

  /**
   * A6 增量产出：转写可能仍在进行，total 会随转写推进增长——
   * 翻页以「本页读满 limit」为准，不能拿会移动的 total 当终止条件。
   */
  private async readSegments(
    assetId: string,
    signal?: AbortSignal,
  ): Promise<{ segments: TranscriptSegment[]; partial: boolean }> {
    const limit = 500
    const segments: TranscriptSegment[] = []
    let partial = false
    for (;;) {
      const page = await this.client.getTranscript({ assetId, offset: segments.length, limit }, signal)
      partial = partial || page.transcript.partial
      if (page.segments.length === 0) break
      segments.push(...page.segments)
      if (page.segments.length < limit) break
    }
    return { segments, partial }
  }

  private async runChunk(assetId: string, todo: ChunkTodo, signal?: AbortSignal): Promise<ChunkResult & { unitIds: string[] }> {
    const frames = await fetchFrameDataUrls(this.client, assetId, todo, this.config.frameEveryNth, signal)
    const transcript = await this.transcriptText(assetId, todo, signal)
    const parts: VlmPart[] = [
      { text: `转写文本（时段 ${todo.startMs}–${todo.endMs} 毫秒）：\n${transcript}\n\n关键帧序列：` },
      ...frames.map(frame => ({ imageDataUrl: frame.dataUrl, label: frame.label })),
    ]

    let lastError = ''
    const apiKey = await this.resolveApiKey(this.config.apiKeyEnv)
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`视觉模型密钥缺失：凭据库里没有 ${this.config.apiKeyEnv}——跑 setup install 写入模型密钥`)
    }
    const request = buildVlmRequest(this.config, apiKey, parts, UNDERSTANDING_SYSTEM_PROMPT)
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now()
      const response = await callVlm(request, this.config, signal)
      try {
        const units = normalizeUnits(extractUnits(response.content), assetId, this.config.model, todo)
        const saved = await this.client.writeSourceUnits({ units }, signal)
        await this.client.reportProvenance({
          taskKey: 'content.chunk_summary',
          model: this.config.model,
          inputTokens: response.inTokens,
          outputTokens: response.outTokens,
          latencyMs: Date.now() - started,
          status: 'success',
          skillVersions: { 'transcript-understanding': '0.1.0' },
          targetId: assetId,
        }, signal)
        return {
          index: todo.index,
          startMs: todo.startMs,
          endMs: todo.endMs,
          units: saved.saved.length,
          deduped: saved.saved.filter(unit => unit.deduped).length,
          inTokens: response.inTokens,
          outTokens: response.outTokens,
          latencyMs: Date.now() - started,
          unitIds: saved.saved.map(unit => unit.unitId),
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        // 一次修正回灌：把校验错误喂回去重写（对齐三层校验收敛规则）
        ;(request.body.messages as Record<string, unknown>[]).push({
          role: 'assistant',
          content: response.content,
        }, {
          role: 'user',
          content: `上一轮输出校验失败：${lastError}。请修正后重新只输出 JSON 数组。`,
        })
      }
    }
    throw new Error(`窗口 ${todo.index}（${todo.startMs}–${todo.endMs}ms）两次校验未收敛：${lastError}；转人工待办`)
  }

  private async transcriptText(assetId: string, todo: ChunkTodo, signal?: AbortSignal): Promise<string> {
    const { segments } = await this.readSegments(assetId, signal)
    const lines: string[] = []
    for (const seg of segments) {
      if (seg.endMs > todo.startMs && seg.startMs < todo.endMs) {
        lines.push(`[${seg.startMs}–${seg.endMs}ms] ${seg.text}`)
      }
    }
    return lines.join('\n').slice(0, 24_000)
  }
}
