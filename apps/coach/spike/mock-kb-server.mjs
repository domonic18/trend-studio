import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'),
)

// 知识点 KP-3.2 故意不配标题，用于验证客户端缺失时回退显示 ID。
const courseTitles = { 'TC-101': '趋势交易基础', 'TC-102': '旧版章节课（v2 契约）' }
const chapterTitles = { M1: '第一章 趋势认知', M2: '第二章 结构识别', M3: '第三章 买卖时机', V1: '第一章 旧版正文' }
const knowledgePointTitles = {
  'KP-1.1': '趋势的定义与三种方向',
  'KP-1.2': '趋势结构:推动段与调整段',
  'KP-2.1': '均线的方向与排列',
  'KP-2.2': '量价配合的基本观察',
  'KP-3.1': '趋势反转的初步信号',
  'KP-V2.1': '旧版课程的知识点',
}

const articleMarkdown = {
  'KP-1.1': `# 趋势的定义与三种方向

趋势不是单根 K 线的涨跌，而是**高低点的相对关系**。

- 上升趋势：更高的高点与更高的低点
- 下降趋势：更低的高点与更低的低点
- 横盘：高低点大致处于同一区间

> 判断方向先看高低点排列，再看均线与量能。

对应视频片段：\`seg-tc101-m1-kp1-1\``,
  'KP-1.2': `# 趋势结构：推动段与调整段

一段完整的趋势由**推动段**和**调整段**交替构成。

1. 推动段顺主趋势方向运行，力度强、延续性好
2. 调整段逆主趋势方向回撤，通常幅度较浅、时间较短

识别结构的关键是区分当前走势属于推动还是调整，避免把调整误判为反转。

对应视频片段：\`seg-tc101-m1-kp1-2\``,
  'KP-2.1': `# 均线的方向与排列

观察均线重点看两点：

- 均线自身的斜率方向
- 多条均线的排列关系

短期均线在上、长期均线在下且同时向上，通常对应较强的上升趋势。

对应视频片段：\`seg-tc101-m2-kp2-1\``,
  'KP-2.2': `# 量价配合的基本观察

成交量反映参与程度，**不能单独作为买卖依据**。

- 推动段放量、调整段缩量：趋势运行健康
- 推动段缩量或调整段异常放量：需要提高警惕

对应视频片段：\`seg-tc101-m2-kp2-2\``,
  'KP-3.1': `# 趋势反转的初步信号

反转不是单一信号，而是一组证据的累积：

1. 原有高低点结构被破坏
2. 推动段力度明显减弱
3. 关键均线方向走平或转向

单个信号只能作为提醒，必须结合更大级别的结构位置综合判断。

对应视频片段：\`seg-tc101-m3-kp3-1\``,
  'KP-3.2': `# 止损与风险边界

止损位置应基于**结构**而不是主观容忍度。

常见做法是把止损放在使当前交易逻辑失效的结构之外，例如推动段的起点或最近一个有效低点。

课程只讨论风险边界的方法，不构成任何投资建议。

对应视频片段：\`seg-tc101-m3-kp3-2\``,
  'KP-V2.1': `# 旧版课程正文

这是一门 **v2 契约**的老课程：只有章节正文，没有节级课件、图示与案例股。

客户端应继续按章节模式学习，不依赖 v3 的节摘要。

对应视频片段：\`seg-tc102-v1-kp1-1\``,
}

const ARTICLE_PUBLISHED_AT = Date.parse('2026-10-01T00:00:00.000Z')
const QUIZ_PUBLISHED_AT = Date.parse('2026-10-02T00:00:00.000Z')
const chapterQuizzes = {
  M2: {
    version: 2,
    publishedAt: QUIZ_PUBLISHED_AT,
    questions: [
      {
        questionId: 'q_ma1',
        prompt: '观察均线方向时，重点看哪两项？',
        options: ['均线颜色与宽度', '均线斜率与排列关系', '成交量与换手率', 'K 线实体与影线'],
        answerIndex: 1,
        explanation: '均线自身斜率代表方向，多条均线的排列关系代表强弱。',
      },
      {
        questionId: 'q_ma2',
        prompt: '短期均线在上、长期均线在下且同时向上，通常对应什么走势？',
        options: ['较强的上升趋势', '明显的下降趋势', '毫无方向的横盘', '必然的反转信号'],
        answerIndex: 0,
        explanation: '多头排列说明各周期方向一致向上，通常对应较强的上升趋势。',
      },
      {
        questionId: 'q_ma3',
        prompt: '关于成交量，下列说法正确的是？',
        options: ['放量上涨一定可以追高', '缩量下跌必然是买点', '成交量不能单独作为买卖依据', '成交量与趋势无关'],
        answerIndex: 2,
        explanation: '成交量反映参与程度，需要结合价格结构与趋势位置综合判断。',
      },
    ],
  },
}
const MOCK_FIGURE_ID = 'fig_demo_m2'
const MOCK_FIGURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <rect width="1600" height="900" fill="#f7f9fc"/>
  <polyline points="120,700 360,560 560,620 820,380 1060,440 1320,220 1480,260" fill="none" stroke="#2a6ebb" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="120,760 400,690 700,650 980,540 1260,470 1480,410" fill="none" stroke="#e08a2e" stroke-width="10" stroke-dasharray="24 18" stroke-linecap="round"/>
  <text x="120" y="130" font-size="56" font-family="sans-serif" fill="#33475b">均线多头排列示意</text>
</svg>`

// v3 节级样例：正文走 DSL（片段卡 + 段落级 unit 锚 + 案例股锚），节 ID 走 sec_<16 hex>。
const MOCK_SECTION_IDS = { M1: 'sec_0000000000000001', M2: 'sec_0000000000000002' }
const MOCK_ASSET_ID = 'asset_0000000000000001'
const MOCK_UNIT_ID = 'su_0000000000000001'
const MOCK_CASE_STOCK_CODE = '600519'
const MOCK_CASE_STOCK = {
  code: MOCK_CASE_STOCK_CODE,
  name: '贵州茅台',
  exchange: 'SSE',
  windowStart: '2026-01-05',
  windowEnd: '2026-02-10',
  events: [
    { date: '2026-01-12', kind: 'breakout', note: '放量突破前高' },
    { date: '2026-01-26', kind: 'pullback', note: '缩量回踩 M20' },
    { date: '2026-02-09', kind: 'breakdown', note: '跌破 M60' },
  ],
}
// 第二只案例股故意不同步：用来验证「等待行情同步」的 pending 态。
const MOCK_PENDING_CASE_STOCK = {
  code: '000001',
  name: '未同步标的',
  exchange: 'SZSE',
  windowStart: '2026-01-05',
  windowEnd: '2026-02-10',
  events: [],
}
const MOCK_CASE_STOCKS = [MOCK_CASE_STOCK, MOCK_PENDING_CASE_STOCK]
// 只有 600519 同步过行情；000001 从未同步，用来触发 pending 态。
const MOCK_SYNCED_CODES = new Set([MOCK_CASE_STOCK_CODE])
const MOCK_WIDGET = {
  widgetId: 'wgt_0000000000000001',
  type: 'kline-annotator',
  specVersion: 1,
  version: 1,
  spec: {
    type: 'kline-annotator',
    data: { generator: 'uptrend', seed: 7, bars: 120 },
    task: '在图上画出连接两个低点的趋势线，并判断斜率方向。',
  },
  assertions: { trendlineTouches: { min: 2 }, slopeRange: [0, 1.5], noBreakBelow: true },
}

const MOCK_SECTION_ARTICLES = {
  M1: `## 趋势的度量

先用高低点排列判断方向，再看均线斜率确认力度。[[unit:${MOCK_UNIT_ID}|均线方向证据]]

案例：[[stock:sh${MOCK_CASE_STOCK_CODE}|贵州茅台]]在区间内的三次结构变化。

:::clip assetId="${MOCK_ASSET_ID}" from="192" to="400" caption="推动段识别" unitId="${MOCK_UNIT_ID}"
:::`,
  M2: `## 结构识别

区分推动段与调整段，避免把调整误判为反转。

:::clip assetId="${MOCK_ASSET_ID}" from="920" to="1150" caption="调整段识别" unitId="${MOCK_UNIT_ID}"
:::`,
}
const progress = new Map()

const MAX_ASR_BODY_BYTES = 3 * 1024 * 1024
const ASR_SAMPLE_RATE = 16000
const ASR_WAV_HEADER_BYTES = 44
const ASR_MAX_WAV_BYTES = ASR_WAV_HEADER_BYTES + ASR_SAMPLE_RATE * 2 * 60
const ASR_TRANSCRIPT = '趋势反转的初步信号有哪些？'

const port = Number(process.env.MOCK_KB_PORT ?? 3939)
const origin = `http://127.0.0.1:${port}`
const hlsDir = fileURLToPath(new URL('./media/hls/', import.meta.url))
const playlistFile = `${hlsDir}index.m3u8`
const keyFile = `${hlsDir}enc.key`
const sessionTtlMs = 10 * 60 * 1000
const sessions = new Map()

const accessTtlMs = Number(process.env.MOCK_ACCESS_TTL_MS ?? 120_000)
const deviceTtlMs = 5 * 60 * 1000
const devicePollIntervalSec = 2
const deviceCodes = new Map()
const userCodes = new Map()
const accessTokens = new Map()
const refreshTokens = new Map()
const eventsConsent = new Map()
const events = new Map()

/** 日志只保留可关联前缀，避免 userCode / deviceId 完整落盘。 */
function mask(value) {
  return typeof value === 'string' && value.length > 4 ? `${value.slice(0, 2)}***` : '***'
}

function scoreSegment(segment, query) {
  const hits = segment.keywords.filter(keyword => query.includes(keyword)).length
  if (hits === 0) return 0
  return Math.min(0.99, Number((0.5 + hits * 0.1).toFixed(3)))
}

function displayTitles(segment) {
  return {
    courseTitle: courseTitles[segment.courseId],
    chapterTitle: chapterTitles[segment.chapterId],
    knowledgePointTitle: knowledgePointTitles[segment.knowledgePointId],
  }
}

function search({ query, courseId, topK }) {
  return fixtures
    .filter(segment => courseId === undefined || segment.courseId === courseId)
    .map(segment => ({ segment, score: scoreSegment(segment, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ segment, score }) => ({
      segmentId: segment.segmentId,
      courseId: segment.courseId,
      chapterId: segment.chapterId,
      knowledgePointId: segment.knowledgePointId,
      title: segment.title,
      ...displayTitles(segment),
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: segment.text,
      score,
    }))
}

function relatedKnowledgePoints(query) {
  const points = new Map()
  for (const segment of fixtures) {
    const hits = segment.keywords.filter(keyword => query.includes(keyword)).length
    const entry = points.get(segment.knowledgePointId)
    if (entry === undefined) {
      points.set(segment.knowledgePointId, {
        knowledgePointId: segment.knowledgePointId,
        title: segment.title,
        hits,
      })
    } else {
      entry.hits += hits
    }
  }
  return [...points.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map(({ knowledgePointId, title }) => ({ knowledgePointId, title }))
}

function knowledgePointTitle(knowledgePointId) {
  return knowledgePointTitles[knowledgePointId] ?? knowledgePointId
}

function courseSegments(courseId) {
  return fixtures.filter(segment => segment.courseId === courseId)
}

function progressKey(deviceId, knowledgePointId) {
  return `${deviceId}:${knowledgePointId}`
}

function courseSummary(courseId, deviceId) {
  const segments = courseSegments(courseId)
  const chapters = new Set(segments.map(segment => segment.chapterId))
  const points = new Set(segments.map(segment => segment.knowledgePointId))
  let completedCount = 0
  for (const knowledgePointId of points) {
    if (progress.get(progressKey(deviceId, knowledgePointId))?.completed === true) completedCount += 1
  }
  return {
    courseId,
    title: courseTitles[courseId] ?? courseId,
    chapterCount: chapters.size,
    knowledgePointCount: points.size,
    completedCount,
  }
}

function chapterKnowledgePointIds(courseId, chapterId) {
  const ids = []
  for (const segment of courseSegments(courseId)) {
    if (segment.chapterId !== chapterId) continue
    if (!ids.includes(segment.knowledgePointId)) ids.push(segment.knowledgePointId)
  }
  return ids
}

function chapterMarkdown(courseId, chapterId) {
  const parts = []
  for (const knowledgePointId of chapterKnowledgePointIds(courseId, chapterId)) {
    if (knowledgePointId === 'KP-2.2') parts.push(`![均线多头排列示意](figure:${MOCK_FIGURE_ID})`)
    const markdown = articleMarkdown[knowledgePointId]
    if (markdown !== undefined) parts.push(markdown)
  }
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

function chapterFigures(courseId, chapterId) {
  if (!chapterKnowledgePointIds(courseId, chapterId).includes('KP-2.2')) return {}
  const expires = Math.floor(Date.now() / 1000) + 600
  return {
    [MOCK_FIGURE_ID]: {
      url: `${origin}/media/figures/${MOCK_FIGURE_ID}/cand_mock.svg?expires=${expires}&sig=mock`,
      width: 1600,
      height: 900,
      alt: '均线多头排列示意',
      caption: '均线多头排列示意',
    },
  }
}

function courseTree(courseId, deviceId) {
  const chapters = []
  for (const segment of courseSegments(courseId)) {
    let chapter = chapters.find(item => item.chapterId === segment.chapterId)
    if (chapter === undefined) {
      chapter = {
        chapterId: segment.chapterId,
        title: chapterTitles[segment.chapterId] ?? segment.chapterId,
        position: chapters.length,
        hasArticle: chapterMarkdown(courseId, segment.chapterId) !== undefined,
        figureCount: Object.keys(chapterFigures(courseId, segment.chapterId)).length,
        knowledgePoints: [],
      }
      chapters.push(chapter)
    }
    if (chapter.knowledgePoints.some(item => item.knowledgePointId === segment.knowledgePointId)) continue
    const record = progress.get(progressKey(deviceId, segment.knowledgePointId))
    chapter.knowledgePoints.push({
      knowledgePointId: segment.knowledgePointId,
      title: knowledgePointTitle(segment.knowledgePointId),
      position: chapter.knowledgePoints.length,
      segmentId: segment.segmentId,
      watchedSec: record?.watchedSec ?? 0,
      completed: record?.completed ?? false,
    })
  }
  const sections = courseSections(courseId)
  return {
    contractVersion: sections.length > 0 ? 3 : 2,
    courseId,
    title: courseTitles[courseId] ?? courseId,
    chapters,
    ...(sections.length > 0 ? { sections } : {}),
  }
}

/** v3 节摘要：仅 TC-101 有节；TC-102 保持 v2 章-only 形态。 */
function courseSections(courseId) {
  const sections = []
  for (const [chapterId, sectionId] of Object.entries(MOCK_SECTION_IDS)) {
    if (courseSegments(courseId).every(segment => segment.chapterId !== chapterId)) continue
    sections.push({
      sectionId,
      title: chapterTitles[chapterId] ?? chapterId,
      position: sections.length,
      hasArticle: true,
      figureCount: 1,
      widgetTypes: [MOCK_WIDGET.type],
      caseStockCodes: MOCK_CASE_STOCKS.map(stock => stock.code).sort(),
    })
  }
  return sections
}

function sectionPayload(courseId, sectionId) {
  const entry = Object.entries(MOCK_SECTION_IDS).find(([, value]) => value === sectionId)
  if (entry === undefined) return undefined
  const [chapterId] = entry
  if (courseSegments(courseId).every(segment => segment.chapterId !== chapterId)) return undefined
  const markdown = MOCK_SECTION_ARTICLES[chapterId]
  const expires = Math.floor(Date.now() / 1000) + 600
  return {
    sectionId,
    courseId,
    chapterId,
    title: chapterTitles[chapterId] ?? chapterId,
    position: Object.keys(MOCK_SECTION_IDS).indexOf(chapterId),
    article: markdown === undefined
      ? null
      : { markdown, dslVersion: 1, version: 2, publishedAt: ARTICLE_PUBLISHED_AT },
    widgets: [MOCK_WIDGET],
    figures: [{
      figureId: MOCK_FIGURE_ID,
      kind: 'ma_diagram',
      caption: '均线多头排列示意',
      assetId: MOCK_ASSET_ID,
      sourceSec: 192,
      candidateId: 'cand_mock',
      url: `${origin}/media/figures/${MOCK_FIGURE_ID}/cand_mock.svg?expires=${expires}&sig=mock`,
    }],
    caseStocks: MOCK_CASE_STOCKS,
  }
}

/** 确定性日K：同一 code 每次刷新得到同一条曲线，方便本地走查。 */
function quoteBars(code) {
  const seed = Number.parseInt(code, 10) % 7
  const bars = []
  let close = 1600 + seed * 10
  for (let index = 0; index < 120; index += 1) {
    const drift = Math.sin((index + seed) / 9) * 12
    const open = close
    close = Number((close + drift).toFixed(2))
    const high = Number((Math.max(open, close) + 6).toFixed(2))
    const low = Number((Math.min(open, close) - 6).toFixed(2))
    const day = new Date(Date.UTC(2025, 8, 1) + index * 86_400_000)
    const tradeDate = day.toISOString().slice(0, 10)
    bars.push({
      code,
      tradeDate,
      open,
      high,
      low,
      close,
      volume: 1_000_000 + ((index * 7 + seed) % 500_000),
      amount: null,
      source: 'tencent-qfq',
    })
  }
  return bars
}

/** 与云端 readCourseQuotes 同口径：清单外代号过滤；压根没同步过才 pending。 */
function catalogQuotes(courseId, codes) {
  const published = new Set(courseSections(courseId).flatMap(section => section.caseStockCodes))
  if (published.size === 0) return undefined
  const wanted = (codes === undefined || codes.length === 0 ? [...published] : codes)
    .filter(code => published.has(code))
  if (wanted.length === 0) return { pending: false, quotes: [] }
  const quotes = wanted.flatMap(code => (MOCK_SYNCED_CODES.has(code) ? quoteBars(code) : []))
  return { pending: quotes.length === 0, quotes }
}

/** 已发布正文里的片段卡时间窗（与云端 resolveClipWindow 同一口径）。 */
function clipWindows(markdown) {
  const windows = []
  const re = /^:::clip\s+([^\n]*)$/gm
  let match
  while ((match = re.exec(markdown)) !== null) {
    const attrs = {}
    const attrRe = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^\s"=]+))/g
    let attrMatch
    while ((attrMatch = attrRe.exec(match[1] ?? '')) !== null) {
      attrs[attrMatch[1]] = attrMatch[2] ?? attrMatch[3] ?? ''
    }
    if (attrs.assetId === undefined) continue
    windows.push({
      assetId: attrs.assetId,
      fromSec: Number(attrs.from),
      toSec: Number(attrs.to),
    })
  }
  return windows
}

function catalogChapter(courseId, chapterId) {
  if (chapterKnowledgePointIds(courseId, chapterId).length === 0) return undefined
  const chapters = [...new Set(courseSegments(courseId).map(segment => segment.chapterId))]
  const index = chapters.indexOf(chapterId)
  const markdown = chapterMarkdown(courseId, chapterId)
  return {
    chapterId,
    courseId,
    title: chapterTitles[chapterId] ?? chapterId,
    article: markdown === undefined
      ? null
      : { markdown, version: 1, publishedAt: ARTICLE_PUBLISHED_AT },
    figures: chapterFigures(courseId, chapterId),
    quiz: chapterQuizzes[chapterId] ?? null,
    adjacentChapters: [chapters[index - 1], chapters[index + 1]]
      .filter((value) => value !== undefined)
      .map((value) => ({ chapterId: value, title: chapterTitles[value] ?? value })),
  }
}

function knowledgePointDetail(knowledgePointId) {
  const segment = fixtures.find(item => item.knowledgePointId === knowledgePointId)
  if (segment === undefined) return undefined
  const points = []
  for (const item of courseSegments(segment.courseId)) {
    if (!points.includes(item.knowledgePointId)) points.push(item.knowledgePointId)
  }
  const index = points.indexOf(knowledgePointId)
  const adjacent = [points[index - 1], points[index + 1]]
    .filter((value) => value !== undefined)
    .map((value) => ({ knowledgePointId: value, title: knowledgePointTitle(value) }))
  return {
    knowledgePointId,
    courseId: segment.courseId,
    chapterId: segment.chapterId,
    title: knowledgePointTitle(knowledgePointId),
    segmentId: segment.segmentId,
    adjacentKnowledgePoints: adjacent,
  }
}

function cors(response) {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type, authorization, x-device-id')
}

function json(response, status, payload) {
  cors(response)
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function issueSession(deviceId) {
  const token = randomBytes(24).toString('hex')
  const sessionId = `ps_${randomBytes(8).toString('hex')}`
  const expiresAt = Date.now() + sessionTtlMs
  sessions.set(token, expiresAt)
  return {
    sessionId,
    expiresAt,
    playlistUrl: `${origin}/media/hls/index.m3u8?token=${token}`,
    watermark: { label: `学员 ${deviceId.slice(0, 6)}` },
  }
}

function issueGrant(deviceId) {
  const accessToken = randomBytes(24).toString('hex')
  const refreshToken = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + accessTtlMs
  accessTokens.set(accessToken, { deviceId, expiresAt })
  refreshTokens.set(refreshToken, { deviceId })
  return { accessToken, refreshToken, expiresAt, deviceId }
}

function authenticate(request) {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return { status: 401 }
  const token = header.slice('Bearer '.length)
  const entry = accessTokens.get(token)
  if (entry === undefined) return { status: 401 }
  if (entry.expiresAt <= Date.now()) {
    accessTokens.delete(token)
    return { status: 401 }
  }
  const deviceId = request.headers['x-device-id']
  if (typeof deviceId !== 'string' || deviceId !== entry.deviceId) return { status: 403 }
  return { ok: true, deviceId: entry.deviceId }
}

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeUserCode() {
  const pick = () => USER_CODE_ALPHABET[randomBytes(1)[0] % USER_CODE_ALPHABET.length]
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`
}

const EVENT_FIELDS = {
  search_requested: ['durationMs', 'topK', 'hits', 'empty'],
  citation_clicked: ['segmentId'],
  player_started: ['startupMs', 'autoplayBlocked'],
  feedback_submitted: ['rating'],
}

function isInt(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function validateEvent(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'body must be an object'
  if (typeof payload.eventId !== 'string' || !/^[A-Za-z0-9._:-]{8,64}$/.test(payload.eventId)) {
    return 'eventId invalid'
  }
  const fields = EVENT_FIELDS[payload.name]
  if (fields === undefined) return 'event name not allowed'
  const props = payload.props === undefined ? {} : payload.props
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return 'props must be an object'
  if (Object.keys(props).some(key => !fields.includes(key))) return 'props not allowed'
  switch (payload.name) {
    case 'search_requested':
      return isInt(props.durationMs, 0, 60_000) && isInt(props.topK, 1, 20)
        && isInt(props.hits, 0, 20) && typeof props.empty === 'boolean' ? undefined : 'props invalid'
    case 'citation_clicked':
      return typeof props.segmentId === 'string' && /^seg-[A-Za-z0-9._-]+$/.test(props.segmentId)
        ? undefined : 'props invalid'
    case 'player_started':
      return isInt(props.startupMs, 0, 60_000) && typeof props.autoplayBlocked === 'boolean'
        ? undefined : 'props invalid'
    case 'feedback_submitted':
      return props.rating === 'up' || props.rating === 'down' ? undefined : 'props invalid'
    default:
      return 'event name not allowed'
  }
}

function requireAuth(request, response) {
  const auth = authenticate(request)
  if (auth.ok === true) return auth
  json(response, auth.status, { error: auth.status === 403 ? 'device mismatch' : 'unauthorized' })
  return undefined
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

async function readBodyLimited(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) return { tooLarge: true }
    chunks.push(chunk)
  }
  return { body: Buffer.concat(chunks) }
}

/** 与插件 Host 同口径的 WAV 边界；mock 用于暴露契约漂移。 */
function validateAsrAudio(audio, durationMs) {
  if (typeof audio !== 'string' || audio.length === 0 || audio.length % 4 !== 0) return 'audio invalid'
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return 'audio invalid'
  const bytes = Buffer.from(audio, 'base64')
  if (bytes.length < ASR_WAV_HEADER_BYTES || bytes.length > ASR_MAX_WAV_BYTES) return 'audio size invalid'
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return 'audio is not wav'
  }
  let offset = 12
  let format
  let dataBytes
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > bytes.length) return 'audio chunk out of bounds'
    if (id === 'fmt ') {
      if (size < 16) return 'audio fmt invalid'
      format = {
        audioFormat: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bitsPerSample: bytes.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      dataBytes = size
    }
    offset = body + size + (size % 2)
  }
  if (format === undefined || dataBytes === undefined) return 'audio chunks missing'
  if (format.audioFormat !== 1 || format.channels !== 1
    || format.sampleRate !== ASR_SAMPLE_RATE || format.bitsPerSample !== 16) {
    return 'audio format invalid'
  }
  const actualMs = (dataBytes / (ASR_SAMPLE_RATE * 2)) * 1000
  if (actualMs > 60_000 || Math.abs(actualMs - durationMs) > 1000) return 'audio duration mismatch'
  return undefined
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

function serveDevicePage(response, url) {
  const userCode = url.searchParams.get('code') ?? ''
  const body = `<!doctype html>
<meta charset="utf-8">
<title>趋势伴学设备授权</title>
<h1>趋势伴学设备授权</h1>
<p>设备码：<code>${escapeHtml(userCode)}</code></p>
<p id="msg">确认是本人操作后点击批准。</p>
<button id="approve">批准授权</button>
<script>
document.getElementById('approve').addEventListener('click', async () => {
  const response = await fetch('/v1/auth/device/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userCode: ${JSON.stringify(userCode)} }),
  })
  document.getElementById('msg').textContent = response.ok ? '已授权，请回到客户端等待生效。' : '设备码无效或已过期。'
})
</script>`
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

function tokenFrom(url) {
  const token = url.searchParams.get('token')
  if (token === null) return undefined
  const expiresAt = sessions.get(token)
  if (expiresAt === undefined) return undefined
  if (expiresAt <= Date.now()) {
    sessions.delete(token)
    return undefined
  }
  return token
}

function serveHls(request, response, url) {
  const token = tokenFrom(url)
  if (token === undefined) {
    json(response, 403, { error: 'playback token invalid or expired' })
    return
  }

  const name = decodeURIComponent(url.pathname.slice('/media/hls/'.length))
  if (!/^(index\.m3u8|enc\.key|seg\d{4,}\.ts)$/.test(name)) {
    json(response, 404, { error: 'not found' })
    return
  }

  if (name === 'index.m3u8') {
    const body = readFileSync(playlistFile, 'utf8')
      .replaceAll('URI="enc.key"', `URI="enc.key?token=${token}"`)
      .replaceAll(/^(seg\d+\.ts)$/gm, `$1?token=${token}`)
    cors(response)
    response.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
    })
    response.end(body)
    return
  }

  const file = `${hlsDir}${name}`
  const size = statSync(file).size
  cors(response)
  response.writeHead(200, {
    'content-type': name === 'enc.key' ? 'application/octet-stream' : 'video/mp2t',
    'content-length': size,
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(response)
}

const mediaFile = fileURLToPath(new URL('./media/lesson.mp4', import.meta.url))

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    cors(response)
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url, origin)

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/device') {
    serveDevicePage(response, url)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/code') {
    const payload = await readJson(request)
    if (typeof payload?.clientId !== 'string' || typeof payload?.deviceId !== 'string') {
      json(response, 400, { error: 'clientId and deviceId are required' })
      return
    }
    const deviceCode = randomBytes(18).toString('hex')
    let userCode = makeUserCode()
    while (userCodes.has(userCode)) userCode = makeUserCode()
    deviceCodes.set(deviceCode, {
      userCode,
      deviceId: payload.deviceId,
      expiresAt: Date.now() + deviceTtlMs,
      approved: false,
    })
    userCodes.set(userCode, deviceCode)
    console.log(`[mock-kb] device code issued userCode=${mask(userCode)} device=${mask(payload.deviceId)}`)
    json(response, 200, {
      deviceCode,
      userCode,
      verificationUri: `${origin}/device?code=${encodeURIComponent(userCode)}`,
      expiresIn: Math.floor(deviceTtlMs / 1000),
      interval: devicePollIntervalSec,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/approve') {
    const payload = await readJson(request)
    const userCode = typeof payload?.userCode === 'string' ? payload.userCode.trim().toUpperCase() : ''
    const deviceCode = userCodes.get(userCode)
    const entry = deviceCode === undefined ? undefined : deviceCodes.get(deviceCode)
    if (entry === undefined || Date.now() >= entry.expiresAt) {
      json(response, 404, { error: 'device code invalid or expired' })
      return
    }
    entry.approved = true
    console.log(`[mock-kb] device code approved userCode=${mask(userCode)}`)
    json(response, 200, { approved: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/token') {
    const payload = await readJson(request)
    const deviceCode = payload?.deviceCode
    const entry = typeof deviceCode === 'string' ? deviceCodes.get(deviceCode) : undefined
    if (entry === undefined) {
      json(response, 200, { status: 'expired' })
      return
    }
    if (Date.now() >= entry.expiresAt) {
      deviceCodes.delete(deviceCode)
      userCodes.delete(entry.userCode)
      json(response, 200, { status: 'expired' })
      return
    }
    if (!entry.approved) {
      json(response, 200, { status: 'pending' })
      return
    }
    deviceCodes.delete(deviceCode)
    userCodes.delete(entry.userCode)
    const grant = issueGrant(entry.deviceId)
    console.log(`[mock-kb] device authorized userCode=${mask(entry.userCode)} device=${mask(entry.deviceId)}`)
    json(response, 200, { status: 'authorized', grant })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    const payload = await readJson(request)
    const refreshToken = payload?.refreshToken
    const deviceId = payload?.deviceId
    const entry = typeof refreshToken === 'string' ? refreshTokens.get(refreshToken) : undefined
    if (entry === undefined) {
      json(response, 401, { error: 'refresh token invalid' })
      return
    }
    if (deviceId !== entry.deviceId) {
      json(response, 403, { error: 'device mismatch' })
      return
    }
    refreshTokens.delete(refreshToken)
    for (const [token, meta] of accessTokens) {
      if (meta.deviceId === entry.deviceId) accessTokens.delete(token)
    }
    const grant = issueGrant(entry.deviceId)
    console.log(`[mock-kb] token refreshed device=${mask(entry.deviceId)}`)
    json(response, 200, grant)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/revoke') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    for (const [token, meta] of accessTokens) {
      if (meta.deviceId === auth.deviceId) accessTokens.delete(token)
    }
    for (const [token, meta] of refreshTokens) {
      if (meta.deviceId === auth.deviceId) refreshTokens.delete(token)
    }
    console.log(`[mock-kb] device revoked device=${mask(auth.deviceId)}`)
    json(response, 200, { revoked: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/debug/expire') {
    let expired = 0
    for (const meta of accessTokens.values()) {
      if (meta.expiresAt > Date.now()) expired += 1
      meta.expiresAt = 0
    }
    json(response, 200, { expired })
    return
  }

  if (request.method === 'GET' && url.pathname === '/v1/events/consent') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    json(response, 200, { consent: eventsConsent.get(auth.deviceId) === true })
    return
  }

  if (request.method === 'PUT' && url.pathname === '/v1/events/consent') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const payload = await readJson(request)
    if (typeof payload?.consent !== 'boolean') {
      json(response, 400, { error: 'consent must be a boolean' })
      return
    }
    eventsConsent.set(auth.deviceId, payload.consent)
    json(response, 200, { consent: payload.consent })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/events') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    if (eventsConsent.get(auth.deviceId) !== true) {
      json(response, 403, { error: 'events consent required' })
      return
    }
    const payload = await readJson(request)
    const invalid = validateEvent(payload)
    if (invalid !== undefined) {
      json(response, 400, { error: invalid })
      return
    }
    const duplicate = events.has(payload.eventId)
    events.set(payload.eventId, payload)
    console.log(`[mock-kb] event ${payload.name} duplicate=${duplicate}`)
    json(response, 202, { accepted: true })
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/media/hls/')) {
    serveHls(request, response, url)
    return
  }

  if (request.method === 'GET' && url.pathname === `/media/figures/${MOCK_FIGURE_ID}/cand_mock.svg`) {
    cors(response)
    response.writeHead(200, {
      'content-type': 'image/svg+xml',
      'cache-control': 'private, max-age=600',
      'x-content-type-options': 'nosniff',
    })
    response.end(MOCK_FIGURE_SVG)
    return
  }

  if (request.method === 'GET' && url.pathname === '/media/lesson.mp4') {
    const total = statSync(mediaFile).size
    const range = request.headers.range
    cors(response)
    response.setHeader('accept-ranges', 'bytes')
    response.setHeader('content-type', 'video/mp4')
    if (range === undefined) {
      response.writeHead(200, { 'content-length': total })
      createReadStream(mediaFile).pipe(response)
      return
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = match?.[1] === '' || match?.[1] === undefined ? 0 : Number(match[1])
    const end = match?.[2] === '' || match?.[2] === undefined ? total - 1 : Math.min(Number(match[2]), total - 1)
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      response.writeHead(416, { 'content-range': `bytes */${total}` })
      response.end()
      return
    }
    response.writeHead(206, {
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${total}`,
    })
    createReadStream(mediaFile, { start, end }).pipe(response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/playback/sessions') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      json(response, 400, { error: 'invalid json' })
      return
    }
    const segmentId = payload?.segmentId
    if (typeof segmentId !== 'string' || !fixtures.some(item => item.segmentId === segmentId)) {
      json(response, 404, { error: 'segment not found' })
      return
    }
    if (!statSync(playlistFile, { throwIfNoEntry: false })) {
      json(response, 503, { error: 'hls asset missing, run npm run mock:rebuild' })
      return
    }
    const session = issueSession(auth.deviceId)
    console.log(`[mock-kb] playback session ${session.sessionId} segment=${segmentId}`)
    json(response, 200, session)
    return
  }

  if (request.method === 'GET' && url.pathname === '/v1/catalog/courses') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const courseIds = [...new Set(fixtures.map(segment => segment.courseId))]
    json(response, 200, {
      courses: courseIds.map(courseId => courseSummary(courseId, auth.deviceId)),
    })
    return
  }

  const chapterMatch = /^\/v1\/catalog\/courses\/([^/]+)\/chapters\/([^/]+)$/.exec(url.pathname)
  if (request.method === 'GET' && chapterMatch !== null) {
    if (requireAuth(request, response) === undefined) return
    const courseId = decodeURIComponent(chapterMatch[1])
    const chapterId = decodeURIComponent(chapterMatch[2])
    const chapter = catalogChapter(courseId, chapterId)
    if (chapter === undefined) {
      json(response, 404, { error: 'chapter not found' })
      return
    }
    json(response, 200, chapter)
    return
  }

  const sectionMatch = /^\/v1\/catalog\/courses\/([^/]+)\/sections\/([^/]+)$/.exec(url.pathname)
  if (request.method === 'GET' && sectionMatch !== null) {
    if (requireAuth(request, response) === undefined) return
    const courseId = decodeURIComponent(sectionMatch[1])
    const sectionId = decodeURIComponent(sectionMatch[2])
    const section = sectionPayload(courseId, sectionId)
    if (section === undefined) {
      json(response, 404, { error: 'section not found' })
      return
    }
    json(response, 200, section)
    return
  }

  const quotesMatch = /^\/v1\/catalog\/courses\/([^/]+)\/quotes$/.exec(url.pathname)
  if (request.method === 'GET' && quotesMatch !== null) {
    if (requireAuth(request, response) === undefined) return
    const courseId = decodeURIComponent(quotesMatch[1])
    const codes = (url.searchParams.get('codes') ?? '')
      .split(',')
      .map(code => code.trim())
      .filter(code => code.length > 0)
    const quotes = catalogQuotes(courseId, codes)
    if (quotes === undefined) {
      json(response, 404, { error: 'course has no published case stocks' })
      return
    }
    json(response, 200, quotes)
    return
  }

  const sectionPlaybackMatch = /^\/v1\/catalog\/sections\/([^/]+)\/playback$/.exec(url.pathname)
  if (request.method === 'POST' && sectionPlaybackMatch !== null) {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const sectionId = decodeURIComponent(sectionPlaybackMatch[1])
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      json(response, 400, { error: 'invalid json' })
      return
    }
    const entry = Object.entries(MOCK_SECTION_IDS).find(([, value]) => value === sectionId)
    if (entry === undefined) {
      json(response, 404, { error: 'section not found' })
      return
    }
    const markdown = MOCK_SECTION_ARTICLES[entry[0]] ?? ''
    const windows = clipWindows(markdown).filter(window => window.assetId === payload?.assetId)
    const match = windows.find(window => payload?.fromSec >= window.fromSec && payload?.toSec <= window.toSec)
    if (match === undefined) {
      json(response, 409, {
        error: {
          code: 'playback_window_invalid',
          message: 'playback window is outside the published clip window',
        },
        requestId: 'mock',
      })
      return
    }
    if (!statSync(playlistFile, { throwIfNoEntry: false })) {
      json(response, 503, { error: 'hls asset missing, run npm run mock:rebuild' })
      return
    }
    const session = issueSession(auth.deviceId)
    json(response, 200, {
      sessionId: session.sessionId,
      playlistUrl: session.playlistUrl,
      fromSec: match.fromSec,
      toSec: match.toSec,
      expiresAt: session.expiresAt,
    })
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/v1/catalog/courses/')) {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const courseId = decodeURIComponent(url.pathname.slice('/v1/catalog/courses/'.length))
    if (courseSegments(courseId).length === 0) {
      json(response, 404, { error: 'course not found' })
      return
    }
    json(response, 200, courseTree(courseId, auth.deviceId))
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/v1/catalog/knowledge-points/')) {
    if (requireAuth(request, response) === undefined) return
    const knowledgePointId = decodeURIComponent(
      url.pathname.slice('/v1/catalog/knowledge-points/'.length),
    )
    const detail = knowledgePointDetail(knowledgePointId)
    if (detail === undefined) {
      json(response, 404, { error: 'knowledge point not found' })
      return
    }
    json(response, 200, detail)
    return
  }

  if (request.method === 'PUT' && url.pathname.startsWith('/v1/progress/knowledge-points/')) {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const knowledgePointId = decodeURIComponent(
      url.pathname.slice('/v1/progress/knowledge-points/'.length),
    )
    if (!fixtures.some(segment => segment.knowledgePointId === knowledgePointId)) {
      json(response, 404, { error: 'knowledge point not found' })
      return
    }
    const payload = await readJson(request)
    if (!isInt(payload?.watchedSec, 0, 86400) || typeof payload?.completed !== 'boolean') {
      json(response, 400, { error: 'watchedSec must be an integer 0-86400 and completed a boolean' })
      return
    }
    const key = progressKey(auth.deviceId, knowledgePointId)
    const previous = progress.get(key)
    const next = {
      watchedSec: Math.max(previous?.watchedSec ?? 0, payload.watchedSec),
      completed: (previous?.completed ?? false) || payload.completed,
      updatedAt: Date.now(),
    }
    progress.set(key, next)
    console.log(`[mock-kb] progress ${knowledgePointId} watched=${next.watchedSec} completed=${next.completed}`)
    json(response, 200, { knowledgePointId, ...next })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/asr/transcribe') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const read = await readBodyLimited(request, MAX_ASR_BODY_BYTES)
    if (read.tooLarge === true) {
      json(response, 413, { error: 'payload too large' })
      return
    }
    let payload
    try {
      payload = JSON.parse(read.body.toString('utf8'))
    } catch {
      json(response, 400, { error: 'invalid json' })
      return
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      json(response, 400, { error: 'body must be an object' })
      return
    }
    if (payload.format !== 'wav') {
      json(response, 400, { error: 'format must be wav' })
      return
    }
    if (!isInt(payload.durationMs, 1, 60_000)) {
      json(response, 400, { error: 'durationMs must be an integer 1-60000' })
      return
    }
    const invalid = validateAsrAudio(payload.audio, payload.durationMs)
    if (invalid !== undefined) {
      json(response, 400, { error: invalid })
      return
    }
    console.log(`[mock-kb] asr device=${mask(auth.deviceId)} durationMs=${payload.durationMs}`)
    json(response, 200, { text: ASR_TRANSCRIPT, durationMs: payload.durationMs })
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/v1/kb/segments/')) {
    if (requireAuth(request, response) === undefined) return
    const segmentId = decodeURIComponent(url.pathname.slice('/v1/kb/segments/'.length))
    const segment = fixtures.find(item => item.segmentId === segmentId)
    if (segment === undefined) {
      json(response, 404, { error: 'segment not found' })
      return
    }
    const { keywords: _keywords, ...publicSegment } = segment
    json(response, 200, { ...publicSegment, ...displayTitles(segment), score: 1 })
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/kb/search') {
    json(response, 404, { error: 'not found' })
    return
  }

  if (requireAuth(request, response) === undefined) return

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)

  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    json(response, 400, { error: 'invalid json' })
    return
  }

  const query = payload?.query
  if (typeof query !== 'string' || query.trim() === '') {
    json(response, 400, { error: 'query is required' })
    return
  }
  if (query.trim().length > 500) {
    json(response, 400, { error: 'query too long' })
    return
  }

  const topK = payload.topK === undefined ? 5 : payload.topK
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    json(response, 400, { error: 'topK must be an integer between 1 and 20' })
    return
  }

  const courseId = payload.courseId
  if (courseId !== undefined
    && (typeof courseId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(courseId))) {
    json(response, 400, { error: 'courseId invalid' })
    return
  }

  const segments = search({ query, courseId, topK })
  const related = segments.length === 0 ? relatedKnowledgePoints(query) : []

  console.log(`[mock-kb] queryLength=${query.trim().length} hits=${segments.length} related=${related.length}`)
  json(response, 200, { segments, relatedKnowledgePoints: related })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-kb] listening on http://127.0.0.1:${port}`)
})
