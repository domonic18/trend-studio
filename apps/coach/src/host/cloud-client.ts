import type { AuthManager } from '../auth.js'
import {
  InvalidResponseError,
  UpstreamError,
  VoiceTranscriptionError,
  isSegmentId,
  normalizeTopK,
  optionalCourseId,
  readJsonResponse,
  requireChapterId,
  requireCompleted,
  requireCourseId,
  requireKnowledgePointId,
  requireQuery,
  requireSegmentId,
  requireSectionId,
  requireVoiceDurationMs,
  requireWatchedSec,
} from '../errors.js'
import { sanitizeVoiceText } from '../untrusted.js'
import {
  MAX_CHAPTER_MARKDOWN_CHARS,
  MAX_CHAPTERS,
  MAX_CASE_STOCKS_PER_SECTION,
  MAX_COURSES,
  MAX_FIGURE_DIMENSION,
  MAX_FIGURES_PER_CHAPTER,
  MAX_KNOWN_CATALOG_CONTRACT_VERSION,
  MAX_KNOWLEDGE_POINTS,
  MAX_QUIZ_EXPLANATION_CHARS,
  MAX_QUIZ_OPTION_CHARS,
  MAX_QUIZ_OPTIONS,
  MAX_QUIZ_PROMPT_CHARS,
  MAX_QUIZ_QUESTIONS,
  MAX_QUOTE_BARS,
  MAX_QUOTE_CODES,
  MAX_RELATED_POINTS,
  MAX_SECTIONS_PER_COURSE,
  MAX_SEGMENT_TEXT,
  MAX_TITLE_LENGTH,
  MAX_VOICE_DURATION_MS,
  MAX_VOICE_TRANSCRIPT_CHARS,
  MAX_WATCHED_SEC,
  MAX_WIDGETS_PER_SECTION,
  MIN_CATALOG_CONTRACT_VERSION,
  MIN_FIGURE_DIMENSION,
  MIN_QUIZ_OPTIONS,
  MIN_QUIZ_QUESTIONS,
  type CatalogCaseStock,
  type CatalogChapter,
  type CatalogChapterArticle,
  type CatalogCourse,
  type CatalogCourseSummary,
  type CatalogFigure,
  type CatalogKnowledgePoint,
  type CatalogPlayback,
  type CatalogSection,
  type CatalogSectionArticle,
  type CatalogSectionSummary,
  type CatalogWidget,
  type ChapterArticle,
  type ChapterFigure,
  type ChapterQuiz,
  type KnowledgePointDetail,
  type QuoteItem,
  type QuoteList,
  type QuizQuestion,
  type RelatedChapter,
  type PlaybackSession,
  type ProgressResult,
  type RelatedKnowledgePoint,
  type SearchResult,
  type Segment,
  type VoiceTranscript,
} from '../shared/contracts.js'
import { decodeVoiceWav } from './voice-audio.js'

function isRelatedKnowledgePoint(value: unknown): value is RelatedKnowledgePoint {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.knowledgePointId === 'string' &&
    candidate.knowledgePointId.length > 0 &&
    candidate.knowledgePointId.length <= 64 &&
    typeof candidate.title === 'string' &&
    candidate.title.length > 0 &&
    candidate.title.length <= MAX_TITLE_LENGTH
  )
}

function isOptionalTitle(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= MAX_TITLE_LENGTH)
}

export function isSegment(value: unknown): value is Segment {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isSegmentId(candidate.segmentId) &&
    typeof candidate.courseId === 'string' && candidate.courseId.length > 0 &&
    typeof candidate.chapterId === 'string' && candidate.chapterId.length > 0 &&
    typeof candidate.knowledgePointId === 'string' && candidate.knowledgePointId.length > 0 &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.startSec === 'number' && Number.isFinite(candidate.startSec) && candidate.startSec >= 0 &&
    typeof candidate.endSec === 'number' && Number.isFinite(candidate.endSec) && candidate.endSec >= candidate.startSec &&
    typeof candidate.text === 'string' && candidate.text.length <= MAX_SEGMENT_TEXT &&
    typeof candidate.score === 'number' && Number.isFinite(candidate.score)
      && candidate.score >= 0 && candidate.score <= 1 &&
    isOptionalTitle(candidate.courseTitle) &&
    isOptionalTitle(candidate.chapterTitle) &&
    isOptionalTitle(candidate.knowledgePointTitle)
  )
}

function isPlaybackSession(value: unknown): value is PlaybackSession {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const watermark = candidate.watermark
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) return false
  if (typeof candidate.playlistUrl !== 'string') return false
  try {
    const url = new URL(candidate.playlistUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  } catch {
    return false
  }
  if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return false
  return watermark === undefined ||
    (typeof watermark === 'object' && watermark !== null
      && typeof (watermark as Record<string, unknown>).label === 'string')
}

function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}

function isKnowledgePointId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isCatalogCourseSummary(value: unknown): value is CatalogCourseSummary {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isCourseId(candidate.courseId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    isCount(candidate.chapterCount) &&
    isCount(candidate.knowledgePointCount) &&
    isCount(candidate.completedCount) &&
    candidate.completedCount <= candidate.knowledgePointCount
  )
}

function isCatalogKnowledgePoint(value: unknown): value is CatalogKnowledgePoint {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if ('startSec' in candidate || 'endSec' in candidate) return false
  return (
    isKnowledgePointId(candidate.knowledgePointId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.position === 'number' && Number.isInteger(candidate.position) &&
    (candidate.segmentId === undefined || isSegmentId(candidate.segmentId)) &&
    typeof candidate.watchedSec === 'number' && Number.isInteger(candidate.watchedSec)
      && candidate.watchedSec >= 0 && candidate.watchedSec <= MAX_WATCHED_SEC &&
    typeof candidate.completed === 'boolean'
  )
}

function isChapterId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}

/** 与 errors.ts 的 requireSectionId 同一形状：非 sec_ 前缀的节 ID 一律不可信。 */
function isSectionId(value: unknown): value is string {
  return typeof value === 'string' && /^sec_[0-9a-f]{16}$/.test(value)
}

function isCatalogChapter(value: unknown): value is CatalogChapter {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isChapterId(candidate.chapterId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.position === 'number' && Number.isInteger(candidate.position) &&
    typeof candidate.hasArticle === 'boolean' &&
    typeof candidate.figureCount === 'number' && Number.isInteger(candidate.figureCount)
      && candidate.figureCount >= 0 && candidate.figureCount <= MAX_FIGURES_PER_CHAPTER &&
    Array.isArray(candidate.knowledgePoints) && candidate.knowledgePoints.every(isCatalogKnowledgePoint)
  )
}

function isCatalogCourse(value: unknown): value is CatalogCourse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.contractVersion !== undefined
    && (typeof candidate.contractVersion !== 'number'
      || !Number.isInteger(candidate.contractVersion) || candidate.contractVersion < 1)) return false
  if (!isCourseId(candidate.courseId)) return false
  if (typeof candidate.title !== 'string' || candidate.title.length === 0
    || candidate.title.length > MAX_TITLE_LENGTH) return false
  if (!Array.isArray(candidate.chapters) || candidate.chapters.length > MAX_CHAPTERS) return false
  if (!candidate.chapters.every(isCatalogChapter)) return false
  const points = (candidate.chapters as CatalogChapter[])
    .reduce((total, chapter) => total + chapter.knowledgePoints.length, 0)
  if (points > MAX_KNOWLEDGE_POINTS) return false
  if (candidate.sections !== undefined) {
    if (!Array.isArray(candidate.sections) || candidate.sections.length > MAX_SECTIONS_PER_COURSE) return false
    if (!candidate.sections.every(isCatalogSectionSummary)) return false
  }
  return true
}

/* ---------------- v3 节级契约 ---------------- */

function isCatalogSectionSummary(value: unknown): value is CatalogSectionSummary {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!isSectionId(candidate.sectionId)) return false
  if (typeof candidate.title !== 'string' || candidate.title.length === 0
    || candidate.title.length > MAX_TITLE_LENGTH) return false
  if (typeof candidate.position !== 'number' || !Number.isInteger(candidate.position)
    || candidate.position < 0) return false
  if (typeof candidate.hasArticle !== 'boolean') return false
  if (typeof candidate.figureCount !== 'number' || !Number.isInteger(candidate.figureCount)
    || candidate.figureCount < 0) return false
  if (!Array.isArray(candidate.widgetTypes)
    || !candidate.widgetTypes.every(type => typeof type === 'string' && type.length > 0 && type.length <= 32)) return false
  if (!Array.isArray(candidate.caseStockCodes)
    || !candidate.caseStockCodes.every(code => typeof code === 'string' && /^[0-9]{6}$/.test(code))) return false
  return true
}

function isCatalogSectionArticle(value: unknown): value is CatalogSectionArticle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.markdown === 'string' && candidate.markdown.length > 0
      && candidate.markdown.length <= MAX_CHAPTER_MARKDOWN_CHARS &&
    typeof candidate.dslVersion === 'number' && Number.isInteger(candidate.dslVersion)
      && candidate.dslVersion >= 0 &&
    typeof candidate.version === 'number' && Number.isInteger(candidate.version) && candidate.version >= 1 &&
    typeof candidate.publishedAt === 'number' && Number.isFinite(candidate.publishedAt)
      && candidate.publishedAt > 0
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCatalogWidget(value: unknown): value is CatalogWidget {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.widgetId !== 'string' || candidate.widgetId.length === 0
    || candidate.widgetId.length > 64) return false
  if (typeof candidate.type !== 'string' || candidate.type.length === 0
    || candidate.type.length > 32) return false
  if (typeof candidate.specVersion !== 'number' || !Number.isInteger(candidate.specVersion)
    || candidate.specVersion < 0) return false
  if (typeof candidate.version !== 'number' || !Number.isInteger(candidate.version)
    || candidate.version < 0) return false
  return isPlainRecord(candidate.spec) && isPlainRecord(candidate.assertions)
}

function isCatalogFigure(value: unknown): value is CatalogFigure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.figureId !== 'string' || candidate.figureId.length === 0
    || candidate.figureId.length > 64) return false
  if (typeof candidate.kind !== 'string' || candidate.kind.length === 0
    || candidate.kind.length > 16) return false
  if (typeof candidate.caption !== 'string' || candidate.caption.length === 0
    || candidate.caption.length > MAX_TITLE_LENGTH) return false
  if (candidate.assetId !== null && (typeof candidate.assetId !== 'string'
    || candidate.assetId.length === 0 || candidate.assetId.length > 64)) return false
  if (candidate.sourceSec !== null && (typeof candidate.sourceSec !== 'number'
    || !Number.isInteger(candidate.sourceSec) || candidate.sourceSec < 0)) return false
  if (candidate.candidateId !== null && (typeof candidate.candidateId !== 'string'
    || candidate.candidateId.length === 0 || candidate.candidateId.length > 64)) return false
  if (candidate.url === null) return true
  return isFigureUrl(candidate.url)
}

function isCatalogCaseStock(value: unknown): value is CatalogCaseStock {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.code !== 'string' || !/^[0-9]{6}$/.test(candidate.code)) return false
  if (typeof candidate.name !== 'string' || candidate.name.length === 0
    || candidate.name.length > 50) return false
  if (candidate.exchange !== 'SZSE' && candidate.exchange !== 'SSE' && candidate.exchange !== 'BSE') return false
  if (typeof candidate.windowStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.windowStart)) return false
  if (typeof candidate.windowEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.windowEnd)) return false
  return Array.isArray(candidate.events)
}

function isCatalogSection(value: unknown): value is CatalogSection {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!isSectionId(candidate.sectionId)) return false
  if (!isCourseId(candidate.courseId) || !isChapterId(candidate.chapterId)) return false
  if (typeof candidate.title !== 'string' || candidate.title.length === 0
    || candidate.title.length > MAX_TITLE_LENGTH) return false
  if (typeof candidate.position !== 'number' || !Number.isInteger(candidate.position)
    || candidate.position < 0) return false
  if (candidate.article !== null && !isCatalogSectionArticle(candidate.article)) return false
  if (!Array.isArray(candidate.widgets) || candidate.widgets.length > MAX_WIDGETS_PER_SECTION) return false
  if (!candidate.widgets.every(isCatalogWidget)) return false
  if (!Array.isArray(candidate.figures) || candidate.figures.length > MAX_FIGURES_PER_CHAPTER) return false
  if (!candidate.figures.every(isCatalogFigure)) return false
  if (!Array.isArray(candidate.caseStocks)
    || candidate.caseStocks.length > MAX_CASE_STOCKS_PER_SECTION) return false
  return candidate.caseStocks.every(isCatalogCaseStock)
}

function isCatalogPlayback(value: unknown): value is CatalogPlayback {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) return false
  if (!isFigureUrl(candidate.playlistUrl)) return false
  if (candidate.fromSec !== null && (typeof candidate.fromSec !== 'number'
    || !Number.isInteger(candidate.fromSec) || candidate.fromSec < 0)) return false
  if (candidate.toSec !== null && (typeof candidate.toSec !== 'number'
    || !Number.isInteger(candidate.toSec) || candidate.toSec < 0)) return false
  return typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt)
}

function isQuoteItem(value: unknown): value is QuoteItem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.code !== 'string' || !/^[0-9]{6}$/.test(candidate.code)) return false
  if (typeof candidate.tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.tradeDate)) return false
  for (const key of ['open', 'high', 'low', 'close'] as const) {
    if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) return false
  }
  if (typeof candidate.volume !== 'number' || !Number.isInteger(candidate.volume) || candidate.volume < 0) return false
  if (candidate.amount !== null && (typeof candidate.amount !== 'number' || !Number.isFinite(candidate.amount))) return false
  if (candidate.period !== '1d' && candidate.period !== '1w') return false
  return typeof candidate.source === 'string' && candidate.source.length > 0 && candidate.source.length <= 32
}

function isQuoteList(value: unknown): value is QuoteList {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.pending !== 'boolean') return false
  if (!Array.isArray(candidate.quotes) || candidate.quotes.length > MAX_QUOTE_BARS * MAX_QUOTE_CODES) return false
  return candidate.quotes.every(isQuoteItem)
}

function isChapterArticle(value: unknown): value is ChapterArticle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.markdown === 'string' && candidate.markdown.length > 0
      && candidate.markdown.length <= MAX_CHAPTER_MARKDOWN_CHARS &&
    typeof candidate.version === 'number' && Number.isInteger(candidate.version) && candidate.version >= 1 &&
    typeof candidate.publishedAt === 'number' && Number.isFinite(candidate.publishedAt)
      && candidate.publishedAt > 0
  )
}

/** 图示地址只允许 http(s)，且不得携带账号密码；正文外链与 data: 一律拒绝。 */
function isFigureUrl(value: unknown): value is string {  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function isChapterFigure(value: unknown): value is ChapterFigure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isFigureUrl(candidate.url) &&
    typeof candidate.width === 'number' && Number.isInteger(candidate.width)
      && candidate.width >= MIN_FIGURE_DIMENSION && candidate.width <= MAX_FIGURE_DIMENSION &&
    typeof candidate.height === 'number' && Number.isInteger(candidate.height)
      && candidate.height >= MIN_FIGURE_DIMENSION && candidate.height <= MAX_FIGURE_DIMENSION &&
    typeof candidate.alt === 'string' && candidate.alt.length > 0
      && candidate.alt.length <= MAX_TITLE_LENGTH &&
    (candidate.caption === undefined
      || (typeof candidate.caption === 'string' && candidate.caption.length > 0
        && candidate.caption.length <= MAX_TITLE_LENGTH))
  )
}

/** 云端错误体形如 { error: { code, message } }；只认字符串 code，其余一律当作无码。 */
async function hasErrorCode(response: Response, code: string): Promise<boolean> {
  let payload: unknown
  try {
    payload = await readJsonResponse(response)
  } catch {
    return false
  }
  if (typeof payload !== 'object' || payload === null) return false
  const error = (payload as Record<string, unknown>).error
  if (typeof error !== 'object' || error === null) return false
  return (error as Record<string, unknown>).code === code
}

function isRelatedChapter(value: unknown): value is RelatedChapter {  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isChapterId(candidate.chapterId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH
  )
}

function isQuizText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max
}

const QUIZ_QUESTION_ID = /^q_[A-Za-z0-9._-]{1,40}$/

function isQuizQuestion(value: unknown): value is QuizQuestion {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.questionId !== 'string' || !QUIZ_QUESTION_ID.test(candidate.questionId)) return false
  if (!isQuizText(candidate.prompt, MAX_QUIZ_PROMPT_CHARS)) return false
  if (!isQuizText(candidate.explanation, MAX_QUIZ_EXPLANATION_CHARS)) return false
  if (!Array.isArray(candidate.options)
    || candidate.options.length < MIN_QUIZ_OPTIONS
    || candidate.options.length > MAX_QUIZ_OPTIONS) return false
  if (!candidate.options.every(option => isQuizText(option, MAX_QUIZ_OPTION_CHARS))) return false
  if (new Set(candidate.options).size !== candidate.options.length) return false
  return typeof candidate.answerIndex === 'number' && Number.isInteger(candidate.answerIndex)
    && candidate.answerIndex >= 0 && candidate.answerIndex < candidate.options.length
}

function isChapterQuiz(value: unknown): value is ChapterQuiz {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.version !== 'number' || !Number.isInteger(candidate.version)
    || candidate.version < 1) return false
  if (typeof candidate.publishedAt !== 'number' || !Number.isFinite(candidate.publishedAt)
    || candidate.publishedAt <= 0) return false
  if (!Array.isArray(candidate.questions)
    || candidate.questions.length < MIN_QUIZ_QUESTIONS
    || candidate.questions.length > MAX_QUIZ_QUESTIONS) return false
  if (!candidate.questions.every(isQuizQuestion)) return false
  const ids = new Set((candidate.questions as QuizQuestion[]).map(question => question.questionId))
  return ids.size === candidate.questions.length
}

function isCatalogChapterArticle(value: unknown): value is CatalogChapterArticle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!isChapterId(candidate.chapterId) || !isCourseId(candidate.courseId)) return false
  if (typeof candidate.title !== 'string' || candidate.title.length === 0
    || candidate.title.length > MAX_TITLE_LENGTH) return false
  if (candidate.article !== null && !isChapterArticle(candidate.article)) return false
  if (candidate.quiz !== undefined && candidate.quiz !== null && !isChapterQuiz(candidate.quiz)) return false
  if (typeof candidate.figures !== 'object' || candidate.figures === null
    || Array.isArray(candidate.figures)) return false
  const figures = Object.entries(candidate.figures)
  if (figures.length > MAX_FIGURES_PER_CHAPTER) return false
  for (const [figureId, figure] of figures) {
    if (!/^fig_[A-Za-z0-9._-]{1,60}$/.test(figureId) || !isChapterFigure(figure)) return false
  }
  if (!Array.isArray(candidate.adjacentChapters)
    || candidate.adjacentChapters.length > MAX_RELATED_POINTS
    || !candidate.adjacentChapters.every(isRelatedChapter)) return false
  return true
}

function isKnowledgePointDetail(value: unknown): value is KnowledgePointDetail {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isKnowledgePointId(candidate.knowledgePointId) &&
    isCourseId(candidate.courseId) &&
    isChapterId(candidate.chapterId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    (candidate.segmentId === undefined || isSegmentId(candidate.segmentId)) &&
    Array.isArray(candidate.adjacentKnowledgePoints) &&
    candidate.adjacentKnowledgePoints.length <= MAX_RELATED_POINTS &&
    candidate.adjacentKnowledgePoints.every(isRelatedKnowledgePoint)
  )
}

function isProgressResult(value: unknown, knowledgePointId: string): value is ProgressResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.knowledgePointId === knowledgePointId &&
    typeof candidate.watchedSec === 'number' && Number.isInteger(candidate.watchedSec)
      && candidate.watchedSec >= 0 && candidate.watchedSec <= MAX_WATCHED_SEC &&
    typeof candidate.completed === 'boolean' &&
    typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
  )
}

export async function searchKnowledge(
  auth: AuthManager,
  query: string,
  topK: number,
  courseId: string | undefined,
  signal: AbortSignal,
): Promise<SearchResult> {
  const normalizedQuery = requireQuery(query)
  const normalizedTopK = normalizeTopK(topK)
  const normalizedCourseId = optionalCourseId(courseId)

  const body: Record<string, unknown> = { query: normalizedQuery, topK: normalizedTopK }
  if (normalizedCourseId !== undefined) body.courseId = normalizedCourseId

  const response = await auth.request('/v1/kb/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, signal)

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('课程服务返回了非对象响应')
  }

  const rawSegments = (payload as { segments?: unknown }).segments
  if (!Array.isArray(rawSegments)) {
    throw new InvalidResponseError('课程服务响应缺少片段列表')
  }

  const segments = rawSegments.filter(isSegment)
  if (segments.length !== rawSegments.length) {
    throw new InvalidResponseError('课程服务响应包含不合法的片段')
  }

  const rawRelated = (payload as { relatedKnowledgePoints?: unknown }).relatedKnowledgePoints
  let relatedKnowledgePoints: RelatedKnowledgePoint[] = []
  if (rawRelated !== undefined) {
    if (!Array.isArray(rawRelated) || rawRelated.length > MAX_RELATED_POINTS
      || !rawRelated.every(isRelatedKnowledgePoint)) {
      throw new InvalidResponseError('课程服务响应包含不合法的相关知识点')
    }
    relatedKnowledgePoints = rawRelated
  }

  return { query: normalizedQuery, segments, relatedKnowledgePoints }
}

export async function getSegment(
  auth: AuthManager,
  segmentId: string,
  signal: AbortSignal,
): Promise<Segment> {
  const normalizedSegmentId = requireSegmentId(segmentId)
  const response = await auth.request(
    `/v1/kb/segments/${encodeURIComponent(normalizedSegmentId)}`,
    {},
    signal,
  )

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isSegment(payload) || payload.segmentId !== normalizedSegmentId) {
    throw new InvalidResponseError('课程服务返回的片段信息不合法')
  }
  return payload
}

export async function createPlaybackSession(
  auth: AuthManager,
  segmentId: string,
  signal: AbortSignal,
): Promise<PlaybackSession> {
  const normalizedSegmentId = requireSegmentId(segmentId)
  const response = await auth.request('/v1/playback/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segmentId: normalizedSegmentId }),
  }, signal)

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isPlaybackSession(payload)) {
    throw new InvalidResponseError('课程服务返回的播放会话不合法')
  }
  return payload
}

export async function listCourses(
  auth: AuthManager,
  signal: AbortSignal,
): Promise<{ courses: CatalogCourseSummary[] }> {
  const response = await auth.request('/v1/catalog/courses', {}, signal)
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('课程服务返回了非对象响应')
  }
  const rawCourses = (payload as { courses?: unknown }).courses
  if (!Array.isArray(rawCourses) || rawCourses.length > MAX_COURSES
    || !rawCourses.every(isCatalogCourseSummary)) {
    throw new InvalidResponseError('课程服务返回的课程列表不合法')
  }
  return { courses: rawCourses }
}

export async function getCatalogCourse(
  auth: AuthManager,
  courseId: string,
  signal: AbortSignal,
): Promise<CatalogCourse> {
  const normalizedCourseId = requireCourseId(courseId)
  const response = await auth.request(
    `/v1/catalog/courses/${encodeURIComponent(normalizedCourseId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isCatalogCourse(payload) || payload.courseId !== normalizedCourseId) {
    throw new InvalidResponseError('课程服务返回的课程结构不合法')
  }
  const contractVersion = payload.contractVersion ?? 1
  if (contractVersion < MIN_CATALOG_CONTRACT_VERSION) {
    throw new InvalidResponseError('课程内容版本过旧，请在后台重新生成并发布')
  }
  if (contractVersion > MAX_KNOWN_CATALOG_CONTRACT_VERSION) {
    throw new InvalidResponseError('课程内容已升级，请更新插件后再试')
  }
  return { ...payload, contractVersion }
}

export async function getCatalogChapter(
  auth: AuthManager,
  courseId: string,
  chapterId: string,
  signal: AbortSignal,
): Promise<CatalogChapterArticle> {
  const normalizedCourseId = requireCourseId(courseId)
  const normalizedChapterId = requireChapterId(chapterId)
  const response = await auth.request(
    `/v1/catalog/courses/${encodeURIComponent(normalizedCourseId)}`
      + `/chapters/${encodeURIComponent(normalizedChapterId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isCatalogChapterArticle(payload)
    || payload.courseId !== normalizedCourseId
    || payload.chapterId !== normalizedChapterId) {
    throw new InvalidResponseError('课程服务返回的章节教材不合法')
  }
  if (payload.article !== null) ensureFigureRefs(payload.article.markdown, payload.figures)
  return { ...payload, quiz: payload.quiz ?? null }
}

/** 正文只允许 figure: 稳定引用；引用了未下发图示即视为数据损坏。 */
function ensureFigureRefs(markdown: string, figures: Record<string, ChapterFigure>): void {
  for (const match of markdown.matchAll(/!\[[^\]\n]*\]\(figure:([A-Za-z0-9._-]{1,64})\)/g)) {
    const figureId = match[1]
    if (figureId === undefined || !Object.prototype.hasOwnProperty.call(figures, figureId)) {
      throw new InvalidResponseError('章节教材引用了未下发的图示')
    }
  }
}

/** v3 节详情：正文 + 课件 + 图示 + 案例股。 */
export async function getCatalogSection(
  auth: AuthManager,
  courseId: string,
  sectionId: string,
  signal: AbortSignal,
): Promise<CatalogSection> {
  const normalizedCourseId = requireCourseId(courseId)
  const normalizedSectionId = requireSectionId(sectionId)
  const response = await auth.request(
    `/v1/catalog/courses/${encodeURIComponent(normalizedCourseId)}`
      + `/sections/${encodeURIComponent(normalizedSectionId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isCatalogSection(payload)
    || payload.courseId !== normalizedCourseId
    || payload.sectionId !== normalizedSectionId) {
    throw new InvalidResponseError('课程服务返回的节教材不合法')
  }
  return payload
}

/**
 * v3 学员播放会话：请求窗必须完整落在该节已发布正文的 clip 窗内。
 * 越窗由云端返回 409，这里原样抛出，由界面提示。
 */
export async function createSectionPlayback(
  auth: AuthManager,
  sectionId: string,
  assetId: string,
  fromSec: number,
  toSec: number,
  signal: AbortSignal,
): Promise<CatalogPlayback> {
  const normalizedSectionId = requireSectionId(sectionId)
  if (!/^asset_[0-9a-f]{16}$/.test(assetId)) throw new InvalidResponseError('素材 ID 格式不合法')
  if (!Number.isInteger(fromSec) || fromSec < 0 || fromSec > MAX_WATCHED_SEC) {
    throw new InvalidResponseError('播放起点不合法')
  }
  if (!Number.isInteger(toSec) || toSec <= fromSec || toSec > MAX_WATCHED_SEC) {
    throw new InvalidResponseError('播放终点不合法')
  }
  const response = await auth.request(
    `/v1/catalog/sections/${encodeURIComponent(normalizedSectionId)}/playback`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId, fromSec, toSec }),
    },
    signal,
  )
  if (!response.ok) {
    // 越窗是学员可理解的业务结论：翻译成可读文案，别掉进通用 5xx 提示。
    if (response.status === 409 && await hasErrorCode(response, 'playback_window_invalid')) {
      throw new InvalidResponseError('播放窗口超出该片段的可用范围')
    }
    throw new UpstreamError(response.status)
  }

  const payload = await readJsonResponse(response)
  if (!isCatalogPlayback(payload)) {
    throw new InvalidResponseError('课程服务返回的播放会话不合法')
  }
  return payload
}

/** 学员行情：codes 省略时取课程全部已发布案例股；period 决定周期（1d 日线 / 1w 周线）。 */
export async function getCourseQuotes(
  auth: AuthManager,
  courseId: string,
  codes: string[] | undefined,
  period: '1d' | '1w',
  signal: AbortSignal,
): Promise<QuoteList> {
  const normalizedCourseId = requireCourseId(courseId)
  const queryParts: string[] = []
  if (codes !== undefined) {
    if (codes.length === 0 || codes.length > MAX_QUOTE_CODES) {
      throw new InvalidResponseError('行情标的数量不合法')
    }
    for (const code of codes) {
      if (!/^[0-9]{6}$/.test(code)) throw new InvalidResponseError('行情标的代码不合法')
    }
    queryParts.push(`codes=${encodeURIComponent(codes.join(','))}`)
  }
  queryParts.push(`period=${period}`)
  const response = await auth.request(
    `/v1/catalog/courses/${encodeURIComponent(normalizedCourseId)}/quotes?${queryParts.join('&')}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isQuoteList(payload)) {
    throw new InvalidResponseError('课程服务返回的行情数据不合法')
  }
  return payload
}

export async function getKnowledgePoint(
  auth: AuthManager,
  knowledgePointId: string,
  signal: AbortSignal,
): Promise<KnowledgePointDetail> {
  const normalizedId = requireKnowledgePointId(knowledgePointId)
  const response = await auth.request(
    `/v1/catalog/knowledge-points/${encodeURIComponent(normalizedId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isKnowledgePointDetail(payload) || payload.knowledgePointId !== normalizedId) {
    throw new InvalidResponseError('课程服务返回的知识点详情不合法')
  }
  return payload
}

function voiceErrorForStatus(status: number): VoiceTranscriptionError {
  if (status === 400) return new VoiceTranscriptionError('录音数据无效，请重试')
  if (status === 413) return new VoiceTranscriptionError('录音过长，请缩短后重试')
  if (status === 422) return new VoiceTranscriptionError('没有听清，请再说一次')
  if (status === 429) return new VoiceTranscriptionError('操作太频繁，请稍后再试')
  if (status === 502 || status === 503) return new VoiceTranscriptionError('语音服务暂时不可用，请稍后重试')
  return new VoiceTranscriptionError('语音转写失败，请稍后重试')
}

export async function transcribeVoice(
  auth: AuthManager,
  audioBase64: string,
  durationMs: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<VoiceTranscript> {
  const validatedDuration = requireVoiceDurationMs(durationMs)
  decodeVoiceWav(audioBase64, validatedDuration)

  const response = await auth.request('/v1/asr/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, format: 'wav', durationMs: validatedDuration }),
  }, signal, timeoutMs)

  if (!response.ok) throw voiceErrorForStatus(response.status)

  const payload = await readJsonResponse(response, '语音转写服务')
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('语音转写服务返回了非对象响应')
  }
  const candidate = payload as Record<string, unknown>
  if (typeof candidate.text !== 'string'
    || typeof candidate.durationMs !== 'number' || !Number.isInteger(candidate.durationMs)
    || candidate.durationMs < 1 || candidate.durationMs > MAX_VOICE_DURATION_MS) {
    throw new InvalidResponseError('语音转写服务返回的数据不合法')
  }

  const text = sanitizeVoiceText(candidate.text)
  if (text.length === 0 || Array.from(text).length > MAX_VOICE_TRANSCRIPT_CHARS) {
    throw new InvalidResponseError('语音转写服务返回的文本不合法')
  }
  return { text, durationMs: validatedDuration }
}

export async function reportProgress(
  auth: AuthManager,
  knowledgePointId: string,
  watchedSec: number,
  completed: boolean,
  signal: AbortSignal,
): Promise<ProgressResult> {
  const normalizedId = requireKnowledgePointId(knowledgePointId)
  const normalizedWatchedSec = requireWatchedSec(watchedSec)
  const normalizedCompleted = requireCompleted(completed)
  const response = await auth.request(
    `/v1/progress/knowledge-points/${encodeURIComponent(normalizedId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ watchedSec: normalizedWatchedSec, completed: normalizedCompleted }),
    },
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isProgressResult(payload, normalizedId)) {
    throw new InvalidResponseError('课程服务返回的进度结果不合法')
  }
  return payload
}
