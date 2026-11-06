export interface Segment {
  segmentId: string
  courseId: string
  chapterId: string
  knowledgePointId: string
  title: string
  courseTitle?: string
  chapterTitle?: string
  knowledgePointTitle?: string
  startSec: number
  endSec: number
  text: string
  score: number
}

export interface RelatedKnowledgePoint {
  knowledgePointId: string
  title: string
}

export interface SearchResult {
  query: string
  segments: Segment[]
  relatedKnowledgePoints: RelatedKnowledgePoint[]
}

export interface PlaybackSession {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark?: { label: string }
}

export interface AuthStatus {
  mode: 'device' | 'credential' | 'none'
  authorized: boolean
  deviceId?: string
}

export interface DeviceAuthStart {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface DeviceAuthPoll {
  status: 'pending' | 'authorized' | 'expired'
}

export interface EventsConsent {
  consent: boolean
}

export interface CatalogCourseSummary {
  courseId: string
  title: string
  chapterCount: number
  knowledgePointCount: number
  completedCount: number
}

export interface CatalogKnowledgePoint {
  knowledgePointId: string
  title: string
  position: number
  segmentId?: string
  watchedSec: number
  completed: boolean
}

export interface CatalogChapter {
  chapterId: string
  title: string
  position: number
  hasArticle: boolean
  figureCount: number
  knowledgePoints: CatalogKnowledgePoint[]
}

export interface CatalogCourse {
  contractVersion: number
  courseId: string
  title: string
  chapters: CatalogChapter[]
  /** v3 才有：课程树附带的节摘要；v2 老课程不返回。 */
  sections?: CatalogSectionSummary[]
}

/** v3 节摘要：够渲染目录页，不必下发正文。 */
export interface CatalogSectionSummary {
  sectionId: string
  title: string
  position: number
  hasArticle: boolean
  figureCount: number
  widgetTypes: string[]
  caseStockCodes: string[]
}

export interface CatalogSectionArticle {
  markdown: string
  dslVersion: number
  version: number
  publishedAt: number
}

export interface CatalogWidget {
  widgetId: string
  type: string
  specVersion: number
  version: number
  spec: Record<string, unknown>
  assertions: Record<string, unknown>
}

export interface CatalogFigure {
  figureId: string
  kind: string
  caption: string
  assetId: string | null
  sourceSec: number | null
  candidateId: string | null
  /** 已选定候选的签名图片地址；未就绪时为 null。 */
  url: string | null
}

export interface CatalogCaseStock {
  code: string
  name: string
  exchange: 'SZSE' | 'SSE' | 'BSE'
  /** 该案例股讲解的周期：日线 1d / 周线 1w；K 线按此周期取。 */
  period: '1d' | '1w'
  windowStart: string
  windowEnd: string
  events: unknown[]
}

/** v3 节详情：正文 + 课件 + 图示 + 案例股。 */
export interface CatalogSection {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  /** 节导语（hero lead）；未撰写时不下发。 */
  summary?: string
  /** 节关联概念名，按 concept_refs 顺序。 */
  conceptNames?: string[]
  article: CatalogSectionArticle | null
  widgets: CatalogWidget[]
  figures: CatalogFigure[]
  caseStocks: CatalogCaseStock[]
}

/** 学员播放会话：HLS 直放地址 + 生效窗。 */
export interface CatalogPlayback {
  sessionId: string
  playlistUrl: string
  fromSec: number | null
  toSec: number | null
  expiresAt: number
}

/** 行情条目：腾讯前复权 K 线原始口径（周期原生：1d 日线 / 1w 周线）。 */
export interface QuoteItem {
  code: string
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  source: string
  /** 该 bar 的周期：日线 1d / 周线 1w（课程讲周线就下发周线）。 */
  period: '1d' | '1w'
}

export interface QuoteList {
  pending: boolean
  quotes: QuoteItem[]
}

export interface ChapterArticle {
  markdown: string
  version: number
  publishedAt: number
}

export interface ChapterFigure {
  url: string
  width: number
  height: number
  alt: string
  caption?: string
}

export interface RelatedChapter {
  chapterId: string
  title: string
}

export interface QuizQuestion {
  questionId: string
  prompt: string
  options: string[]
  answerIndex: number
  explanation: string
}

export interface ChapterQuiz {
  version: number
  publishedAt: number
  questions: QuizQuestion[]
}

export interface CatalogChapterArticle {
  chapterId: string
  courseId: string
  title: string
  article: ChapterArticle | null
  figures: Record<string, ChapterFigure>
  adjacentChapters: RelatedChapter[]
  quiz?: ChapterQuiz | null
}

export interface KnowledgePointDetail {
  knowledgePointId: string
  courseId: string
  chapterId: string
  title: string
  segmentId?: string
  adjacentKnowledgePoints: RelatedKnowledgePoint[]
}

export interface ProgressResult {
  knowledgePointId: string
  watchedSec: number
  completed: boolean
  updatedAt: number
}

export interface LearnerContextUpdate {
  revision: number
  enabled: boolean
  courseId?: string
  courseTitle?: string
  chapterId?: string
  chapterTitle?: string
  knowledgePointId?: string
  knowledgePointTitle?: string
  positionSec?: number
  selectedText?: string
}

export interface LearnerContextAck {
  revision: number
  applied: boolean
  truncated: boolean
}

export interface VoiceTranscript {
  text: string
  durationMs: number
}

export const MAX_SEGMENT_TEXT = 4000
export const MAX_RELATED_POINTS = 5
export const MAX_TITLE_LENGTH = 200
export const MAX_COURSES = 50
export const MAX_CHAPTERS = 50
export const MAX_KNOWLEDGE_POINTS = 1000
export const MAX_CHAPTER_MARKDOWN_CHARS = 20000
export const MAX_FIGURES_PER_CHAPTER = 3
export const MIN_FIGURE_DIMENSION = 800
export const MAX_FIGURE_DIMENSION = 20000
export const MIN_QUIZ_QUESTIONS = 3
export const MAX_QUIZ_QUESTIONS = 5
export const MIN_QUIZ_OPTIONS = 2
export const MAX_QUIZ_OPTIONS = 6
export const MAX_QUIZ_PROMPT_CHARS = 300
export const MAX_QUIZ_OPTION_CHARS = 200
export const MAX_QUIZ_EXPLANATION_CHARS = 500
export const MIN_CATALOG_CONTRACT_VERSION = 2
export const MAX_KNOWN_CATALOG_CONTRACT_VERSION = 3
export const MAX_WATCHED_SEC = 86400
export const MAX_SECTIONS_PER_COURSE = 200
export const MAX_WIDGETS_PER_SECTION = 50
export const MAX_CASE_STOCKS_PER_SECTION = 20
export const MAX_QUOTE_CODES = 10
/** 每只标的的 bar 上限：日线 641 根 ≈ 2.6 年，周线 640 根 ≈ 12 年（云端同口径）。 */
export const MAX_QUOTE_BARS = 640

export const MAX_LEARNER_SELECTED_RAW = 4000
export const MAX_LEARNER_SELECTED_CHARS = 500
export const MAX_LEARNER_SESSIONS = 64
export const LEARNER_CONTEXT_TTL_MS = 30 * 60 * 1000
export const LEARNER_POSITION_BUCKET_SEC = 15
export const LEARNER_CONTEXT_SECTION_ORDER = 8500

export const MAX_VOICE_DURATION_MS = 60000
export const VOICE_SAMPLE_RATE = 16000
export const VOICE_CHANNELS = 1
export const VOICE_BITS_PER_SAMPLE = 16
export const MAX_VOICE_TRANSCRIPT_CHARS = 2000
export const VOICE_WAV_HEADER_BYTES = 44
export const MAX_VOICE_WAV_BYTES =
  VOICE_WAV_HEADER_BYTES + (VOICE_SAMPLE_RATE * VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8) * MAX_VOICE_DURATION_MS) / 1000
export const MAX_VOICE_BASE64_CHARS = Math.ceil(MAX_VOICE_WAV_BYTES / 3) * 4
export const VOICE_REQUEST_TIMEOUT_MS = 40000
