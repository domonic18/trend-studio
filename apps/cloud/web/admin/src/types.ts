export type ContentStatus = 'draft' | 'published' | 'archived'
export type UserRole = 'student' | 'operator' | 'admin' | 'producer'
export type UserStatus = 'active' | 'disabled'

import type { WidgetAssertions, WidgetSpec, WidgetType } from '@trend/widgets/spec-types'
import type { KlinePeriod } from '@trend/widgets/kline'
import type { ProductionStep, ProductionTaskStatus } from '@trend/contracts/production-flow'

export type { ProductionStep, ProductionTaskStatus }

export interface SessionUser {
  userId: string
  username: string
  displayName: string | null
  role: UserRole
}

export interface SessionResponse {
  token: string
  expiresAt: number
  user: SessionUser
}

/** 发布清单里的制品条目（学员插件与生产端插件形状相同）。 */
export interface ReleaseArtifact {
  name: string
  version: string
  fileName: string
  sha256: string | null
  sizeBytes: number | null
  publishedAt: string
  notes: string[]
}

export interface ReleaseManifest {
  dshVersion: string
  webAppPackage: string
  /** 学员插件（coach）。 */
  plugin: ReleaseArtifact | null
  /** 教员生产端插件（producer）。 */
  producerPlugin: ReleaseArtifact | null
}

export interface Course {
  courseId: string
  title: string
  status: ContentStatus
}

export interface CourseSummary extends Course {
  chapterCount: number
  knowledgePointCount: number
  segmentCount: number
  chapterArticleCount: number
  figureCount: number
}

export interface ArticleMeta {
  version: number
  status: ContentStatus
  publishedAt: number | null
}

export interface Article extends ArticleMeta {
  markdown: string
}

export interface KnowledgePoint {
  knowledgePointId: string
  title: string
  position: number
  segmentCount: number
}

export interface QuizQuestion {
  questionId: string
  prompt: string
  options: string[]
  answerIndex: number
  explanation: string
}

export interface Quiz extends ArticleMeta {
  questions: QuizQuestion[]
}

export interface Chapter {
  chapterId: string
  title: string
  position: number
  article: ArticleMeta | null
  quiz: ArticleMeta | null
  figureCount: number
  knowledgePoints: KnowledgePoint[]
}

export interface CourseTree {
  course: Course
  chapters: Chapter[]
}

export interface Segment {
  segmentId: string
  courseId: string
  chapterId: string
  knowledgePointId: string
  title: string
  startSec: number
  endSec: number
  text: string
  status: ContentStatus
  hasEmbedding: boolean
}

export interface SegmentList {
  segments: Segment[]
  total: number
  offset: number
  limit: number
}

export interface User {
  userId: string
  username: string | null
  displayName: string | null
  role: UserRole
  status: UserStatus
  deviceCount: number
  createdAt: number
  lastActiveAt: number | null
}

export interface UserList {
  users: User[]
  total: number
  offset: number
  limit: number
}

export type MediaAssetStatus =
  | 'awaiting_upload'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'archived'

export interface MediaAsset {
  assetId: string
  courseId: string
  title: string | null
  status: MediaAssetStatus
  durationMs: number | null
  sourceSizeBytes: number | null
  errorCode: string | null
  createdAt: number
  updatedAt: number
}

export interface MediaAssetList {
  assets: MediaAsset[]
  total: number
  offset: number
  limit: number
}

export type PipelineJobKind = 'ingest' | 'generate' | 'illustrate'
export type PipelineJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface PipelineJob {
  jobId: string
  assetId: string | null
  courseId: string
  kind: PipelineJobKind
  status: PipelineJobStatus
  stage: string
  progress: number
  attempts: number
  maxAttempts: number
  cancelRequested: boolean
  errorCode: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface PipelineJobDetail extends PipelineJob {
  result: {
    transcriptId: string | null
    generationId: string | null
  }
}

export interface PipelineJobList {
  jobs: PipelineJob[]
  total: number
  offset: number
  limit: number
}

export interface TranscriptMeta {
  transcriptId: string
  assetId: string
  status: string
  language: string
  durationMs: number | null
  chunkCount: number
  segmentCount: number
  errorCode: string | null
}

export interface TranscriptPage {
  transcript: TranscriptMeta
  segments: { idx: number; startMs: number; endMs: number; text: string }[]
  total: number
  offset: number
  limit: number
}

export type GenerationStatus = 'draft' | 'applied' | 'discarded' | 'failed'

export interface GenerationCounts {
  chapters: number
  knowledgePoints: number
  chapterArticles: number
  figures: number
  segments: number
  needsReview: number
}

export interface GenerationSummary {
  generationId: string
  assetId: string
  courseId: string
  status: GenerationStatus
  promptVersion: string
  model: string
  counts: GenerationCounts
  createdAt: number
  appliedAt: number | null
}

export interface GenerationPreview {
  generation: GenerationSummary
  chapters: {
    key: string
    title: string
    position: number
    articleLength: number
    hasArticle: boolean
    figureCount: number
  }[]
  knowledgePoints: {
    key: string
    chapterKey: string
    title: string
    position: number
    confidence: number
    needsReview: boolean
    reviewReasons: string[]
  }[]
  figures: {
    key: string
    chapterKey: string
    kind: string
    caption: string
    candidateCount: number
    needsReview: boolean
  }[]
  segments: { key: string; pointKey: string; title: string; startMs: number; endMs: number }[]
}

export interface GenerationApplyResult {
  generationId: string
  alreadyApplied: boolean
  courseId: string
  chapters: { chapterId: string; key: string }[]
  knowledgePoints: { knowledgePointId: string; key: string }[]
  figures: { figureId: string; key: string }[]
  segments: { segmentId: string; key: string }[]
  chapterArticles: number
  figuresApplied: number
}

export interface CoursePublishResult {
  courseId: string
  published: true
  indexed: boolean
  embedded: number
  counts: {
    chapters: number
    knowledgePoints: number
    chapterArticles: number
    figures: number
    segments: number
  }
}

export type FigureStatus = 'planned' | 'rendering' | 'ready' | 'failed' | 'published'
export type FigureCandidateStatus = 'rendering' | 'ready' | 'failed'

export interface FigureCandidate {
  candidateId: string
  status: FigureCandidateStatus
  width: number | null
  height: number | null
  bytes: number | null
  sourceSec: number | null
  errorCode: string | null
  previewUrl: string | null
}

export interface Figure {
  figureId: string
  chapterId: string
  kind: 'keyframe' | 'generated'
  caption: string
  status: FigureStatus
  selectedCandidateId: string | null
  prompt: string | null
  model: string | null
  seed: number | null
  reviewReasons: string[]
  candidates: FigureCandidate[]
}

export interface FigureList {
  figures: Figure[]
  total: number
  offset: number
  limit: number
}

export interface CoursePreview {
  course: Course
  chapters: CoursePreviewChapter[]
}

export interface CoursePreviewChapter {
  chapterId: string
  title: string
  position: number
  sections: CoursePreviewSection[]
}

export interface CoursePreviewSection {
  section: SectionBrief
  article: ArticleBrief | null
  widgets: WidgetDetail[]
  figures: FigureBrief[]
  caseStocks: CaseStockBrief[]
}

export interface CaseStockBrief {
  stockRefId: string
  name: string
  exchange: string
  code: string
  /** K 线周期：'1d' 日线 / '1w' 周线。 */
  period: string
  windowStart: string
  windowEnd: string
  events: unknown[]
  note: string | null
  status: string
  position: number
}

export interface CourseQuote {
  code: string
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  source: string
  /** 该 bar 的周期：日线 1d / 周线 1w。 */
  period: KlinePeriod
}

// === M9 语料级生产：节 / 课件 / 图示预览 ===

export interface Section {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  status: ContentStatus
  summary?: string
  sourceAssetIds: string[]
  conceptRefs: string[]
  createdAt: string
  updatedAt: string
}

export interface SectionBrief {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  status: string
  summary?: string
  conceptRefs: string[]
}

export interface ArticleBrief {
  markdown: string
  citations: string[]
  version: number
  status: string
  dslVersion: number
}

export interface WidgetDetail {
  widgetId: string
  type: WidgetType
  specVersion: number
  spec: WidgetSpec | null
  assertions: WidgetAssertions | null
  validation: Record<string, string>
  status: string
  version: number
  createdAt: string
}

export interface FigureBrief {
  figureId: string
  kind: 'keyframe' | 'generated' | 'diagram'
  caption: string
  status: string
  selectedCandidateId: string | null
  spec: unknown
  sectionId: string | null
}

export interface SectionPreview {
  section: SectionBrief
  article: ArticleBrief | null
  widgets: WidgetDetail[]
  figures: FigureBrief[]
}

export type LlmPurpose = 'content' | 'embedding' | 'image'
export type LlmProtocol = 'openai' | 'anthropic'
export type AsrProtocol = 'minimax' | 'openai'
export type ModelTestStatus = 'success' | 'failed'

export interface LlmModelConfig {
  configId: string
  name: string
  provider: string
  protocol: LlmProtocol
  baseUrl: string
  model: string
  purpose: LlmPurpose
  apiKeyConfigured: boolean
  apiKeyMasked: string | null
  isDefault: boolean
  isActive: boolean
  inputPriceMicrosPer1k: number | null
  outputPriceMicrosPer1k: number | null
  imagePriceMicros: number
  lastTestedAt: number | null
  lastTestStatus: ModelTestStatus | null
  lastTestError: string | null
  createdAt: number
  updatedAt: number
}

export interface AsrModelConfig {
  provider: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  apiKeyMasked: string | null
  enabled: boolean
  lastTestedAt: number | null
  lastTestStatus: ModelTestStatus | null
  lastTestError: string | null
  updatedAt: number
}

export interface ModelTestResult {
  status: ModelTestStatus
  detail: string
  testedAt: number
}

export type AiTaskKey =
  | 'content.outline'
  | 'content.points'
  | 'content.article'
  | 'content.chapter_article'
  | 'content.figure_plan'
  | 'image.figure'
  | 'embedding.query'
  | 'embedding.segment'
  | 'asr.longform'
export type AiUsageStatus = 'success' | 'error' | 'fallback'
export type AiRunStatus = 'running' | 'succeeded' | 'failed'
export type AiRunSource = 'pipeline' | 'admin'

export interface AiUsageTotals {
  requests: number
  errors: number
  fallbacks: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  audioSeconds: number
  characters: number
  avgLatencyMs: number
  costMicros: number | null
}

export interface AiUsageDailyPoint {
  date: string
  requests: number
  inputTokens: number
  outputTokens: number
  costMicros: number | null
}

export interface AiUsageByTask {
  taskKey: AiTaskKey
  label: string
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  characters: number
  costMicros: number | null
}

export interface AiUsageByModel {
  configId: string | null
  provider: string | null
  model: string | null
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  costMicros: number | null
}

export interface AiUsageSummary {
  from: string
  to: string
  totals: AiUsageTotals
  daily: AiUsageDailyPoint[]
  byTask: AiUsageByTask[]
  byModel: AiUsageByModel[]
}

export interface AiUsageEvent {
  usageId: string
  runId: string | null
  taskKey: AiTaskKey
  label: string
  provider: string | null
  model: string | null
  configId: string | null
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  audioSeconds: number
  characters: number
  latencyMs: number
  status: AiUsageStatus
  errorCode: string | null
  createdAt: string
}

export interface AiUsageEventPage {
  events: AiUsageEvent[]
  nextCursor: string | null
}

export interface AiRun {
  runId: string
  taskKey: AiTaskKey
  label: string
  source: AiRunSource
  sourceId: string | null
  status: AiRunStatus
  primaryConfigId: string | null
  fallbackUsed: boolean
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorCode: string | null
}

export interface AiRunPage {
  runs: AiRun[]
  nextCursor: string | null
}

export interface AiRunStep {
  stepId: string
  seq: number
  taskKey: AiTaskKey
  configId: string | null
  provider: string | null
  model: string | null
  attempt: number
  status: AiUsageStatus
  latencyMs: number
  usageId: string | null
  errorCode: string | null
  createdAt: string
}

export interface AiRunDetail extends AiRun {
  summary: unknown
  steps: AiRunStep[]
}

export interface AiTaskBinding {
  taskKey: AiTaskKey
  label: string
  purpose: LlmPurpose
  primaryConfigId: string | null
  fallbackConfigId: string | null
  updatedAt: string | null
}

export interface AiBindingsResponse {
  bindings: AiTaskBinding[]
  configs: LlmModelConfig[]
}

export interface AiConfigHealth {
  configId: string
  name: string
  provider: string
  model: string
  purpose: LlmPurpose
  isActive: boolean
  consecutiveFailures: number
  cooldownUntil: string | null
  coolingDown: boolean
  lastError: string | null
  lastFailureAt: string | null
  lastSuccessAt: string | null
}

export interface AiHealthResponse {
  configs: AiConfigHealth[]
}

export type ApprovalGate = 'skeleton' | 'final'

/** M3b 签批记录：审批 = 对课程内容指纹的签名；内容变更后指纹不符，须重签。 */
export interface ApprovalItem {
  approvalId: string
  courseId: string
  gate: ApprovalGate
  digest: string
  digestSections: Record<string, string>
  approvedBy: string
  approvedAt: string
}

export interface ProductionTaskItem {
  taskId: string
  courseId: string
  sectionId: string
  step: ProductionStep
  status: ProductionTaskStatus
  attempt: number
  maxAttempts: number
  note: string | null
  updatedAt: number
}

/** 追加素材的三种处理方式（A 只补这节 / B 重做骨架 / C 只入库）。 */
export type MaterialChoice = 'A' | 'B' | 'C'

export interface MaterialChoiceItem {
  choiceId: string
  courseId: string
  assetId: string
  sectionId: string | null
  choice: MaterialChoice
  affectedSectionIds: string[]
  note: string | null
  createdAt: number
}

/** 生产看板：每节一行九步状态 + 产出计数 + 最近评审结论。 */
export interface ProductionBoardSection {
  sectionId: string
  chapterId: string
  title: string
  position: number
  steps: ProductionTaskItem[]
  articleVersion: number | null
  widgetCount: number
  figureCount: number
  caseStockCount: number
  reviewVerdict: 'approve' | 'reject' | null
}

export interface ProductionBoard {
  courseId: string
  courseTitle: string
  sections: ProductionBoardSection[]
  materialChoices: MaterialChoiceItem[]
}

// === 发布交接线：发布就绪度 / 内容编辑 ===

export type ReadinessGate = 'figures' | 'widgets' | 'clips' | 'annotations' | 'approval'
export type ReadinessGateStatus = 'pass' | 'fail' | 'pending'

export interface ReadinessIssue {
  /** 与发布冲突码同名，便于按码给中文指引。 */
  code: string
  message: string
  /** 命中的对象（figureId / widgetId…），供界面定位。 */
  targets?: string[]
}

export interface ReadinessFinding {
  gate: ReadinessGate
  label: string
  status: ReadinessGateStatus
  summary: string
  issues: ReadinessIssue[]
}

/** 发布就绪度：门禁集合与发布事务同源——卡片全绿却发布失败，是两套判定漂移的典型症状。 */
export interface CourseReadiness {
  courseId: string
  /** 当前内容指纹（十六进制）。 */
  fingerprint: string
  /** 签批时记录的指纹；无签批记录为 null。 */
  approvedFingerprint: string | null
  gates: ReadinessFinding[]
  publishable: boolean
  pending: string[]
}

export interface Concept {
  conceptId: string
  name: string
  aliases: string[]
  definition: string | null
  status: 'draft' | 'published' | 'archived'
}

export interface CaseStockEvent {
  date: string
  label: string
  unitId: string
}

export interface CaseStock {
  stockRefId: string
  sectionId: string
  name: string
  exchange: string
  code: string
  period: string
  windowStart: string
  windowEnd: string
  events: CaseStockEvent[]
  note: string | null
  status: string
  position: number
  createdAt: string
}
