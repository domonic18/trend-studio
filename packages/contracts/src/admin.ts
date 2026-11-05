/**
 * 生产 admin API 契约的 zod 单一真相源（对接清单 §3.13，架构 §6.6）。
 * producer 工具入参与云端响应共用同一组 schema；字段变更先改云端文档，再改此处。
 */

import { z } from 'zod'
import {
  APPROVAL_ID, ASSET_ID, CASE_STOCK_REF_ID, CONCEPT_EDGE_ID, CONCEPT_ID, DATE_STR, FIGURE_ID_STRICT,
  SECTION_ID, SOURCE_UNIT_ID, STOCK_CODE_PLAIN, TRANSCRIPT_ID, WIDGET_ID,
} from './ids.js'
import { FIGURE_TEMPLATE_NAMES, PROVENANCE_TASK_KEYS, WIDGET_TYPES } from './enums.js'

const assetId = z.string().regex(ASSET_ID, 'assetId 格式不合法')
const sourceUnitId = z.string().regex(SOURCE_UNIT_ID, 'unitId 格式不合法')
const conceptId = z.string().regex(CONCEPT_ID, 'conceptId 格式不合法')
const sectionId = z.string().regex(SECTION_ID, 'sectionId 格式不合法')

export const sourceUnitInput = z.object({
  assetId,
  transcriptId: z.string().regex(TRANSCRIPT_ID).optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  transcriptText: z.string().min(1).max(8000),
  summary: z.string().min(1).max(2000),
  visual: z.record(z.string(), z.unknown()).optional(),
  conceptRefs: z.array(conceptId).max(30).optional(),
  producedBy: z.object({
    taskKey: z.enum(PROVENANCE_TASK_KEYS).optional(),
    model: z.string().max(200).optional(),
    provider: z.string().max(32).optional(),
  }).optional(),
}).strict().refine(unit => unit.endMs > unit.startMs, { message: 'endMs 必须大于 startMs' })

export const sourceUnitsWriteInput = z.object({
  units: z.array(sourceUnitInput).min(1).max(100),
}).strict()

export const savedSourceUnit = z.object({
  unitId: sourceUnitId,
  assetId,
  startMs: z.number().int().nonnegative(),
  deduped: z.boolean(),
}).strict()

export const sourceUnitsWriteOutput = z.object({
  saved: z.array(savedSourceUnit).min(1),
}).strict()

export const sourceUnitsSearchInput = z.object({
  assetId,
  q: z.string().min(1).max(500).optional(),
  conceptId: z.string().regex(CONCEPT_ID).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict()

export const sourceUnitSearchItem = z.object({
  unitId: sourceUnitId,
  assetId,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string(),
  score: z.number(),
}).strict()

export const sourceUnitsSearchOutput = z.object({
  units: z.array(sourceUnitSearchItem),
  nextCursor: z.string().nullable(),
}).strict()

export const framesInput = z.object({
  assetId,
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().positive().optional(),
}).strict()

/** M3b：source unit 完整证据读取——生产端据此复看转写原文、视觉描述与窗内关键帧。 */
export const sourceUnitsReadInput = z.object({
  unitIds: z.array(sourceUnitId).min(1).max(20),
}).strict()

const unitKeyframe = z.object({
  sec: z.number().int().nonnegative(),
  url: z.string().max(2000),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
}).strict()

const unitPlayback = z.object({
  playlistUrl: z.string().max(2000),
  fromSec: z.number().int().nonnegative(),
  toSec: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict()

export const sourceUnitReadItem = z.object({
  unitId: sourceUnitId,
  assetId,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  transcriptText: z.string(),
  visual: z.record(z.string(), z.json()),
  keyframes: z.array(unitKeyframe),
  playback: unitPlayback,
}).strict()

export const sourceUnitsReadOutput = z.object({
  units: z.array(sourceUnitReadItem).min(1),
}).strict()

/** M3b：审批版本绑定——门禁签批时由服务端算内容指纹，发布时重算比对。 */
export const APPROVAL_GATES = ['skeleton', 'final'] as const
export type ApprovalGate = (typeof APPROVAL_GATES)[number]

export const approvalsWriteInput = z.object({
  courseId: z.string().min(1).max(64),
  gate: z.enum(APPROVAL_GATES),
}).strict()

export const approvalItem = z.object({
  approvalId: z.string().regex(APPROVAL_ID),
  courseId: z.string().min(1).max(64),
  gate: z.enum(APPROVAL_GATES),
  digest: z.string().length(64),
  digestSections: z.record(z.string(), z.json()),
  approvedBy: z.string().min(1).max(64),
  approvedAt: z.string().min(1),
}).strict()

export const approvalsListOutput = z.object({
  approvals: z.array(approvalItem),
}).strict()

/** M3b：腾讯前复权日K 同步（课程案例股清单驱动，幂等 upsert）。 */
export const quotesSyncInput = z.object({
  courseId: z.string().min(1).max(64),
}).strict()

export const keyframeFrame = z.object({
  sec: z.number().int().nonnegative(),
  url: z.string().max(2000),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
}).strict()

export const framesOutput = z.object({
  frames: z.array(keyframeFrame),
  nextFrom: z.number().int().nullable(),
}).strict()

export const conceptWriteInput = z.object({
  courseId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().min(1).max(200)).max(20).optional(),
  definition: z.string().min(1).max(2000).optional(),
}).strict()

export const conceptWriteOutput = z.object({ conceptId }).strict()

export const conceptsListInput = z.object({
  courseId: z.string().min(1).max(64),
}).strict()

export const conceptListItem = z.object({
  conceptId,
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)),
  definition: z.string().max(2000).nullable(),
}).strict()

export const conceptsListOutput = z.object({
  concepts: z.array(conceptListItem),
}).strict()

export const conceptEdgeWriteInput = z.object({
  courseId: z.string().min(1).max(64),
  fromConceptId: conceptId,
  toConceptId: conceptId,
  kind: z.enum(['prerequisite', 'related']),
}).strict().refine(edge => edge.fromConceptId !== edge.toConceptId, { message: '依赖边不允许自环' })

export const conceptEdgeWriteOutput = z.object({ edgeId: z.string().regex(CONCEPT_EDGE_ID) }).strict()

export const sectionsListInput = z.object({
  courseId: z.string().min(1).max(64),
  chapterId: z.string().min(1).max(64).optional(),
}).strict()

export const sectionDto = z.object({
  sectionId,
  courseId: z.string(),
  chapterId: z.string(),
  title: z.string().max(200),
  position: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  summary: z.string().optional(),
  sourceAssetIds: z.array(z.string()),
  conceptRefs: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

export const sectionsListOutput = z.object({ sections: z.array(sectionDto) }).strict()

export const sectionWriteInput = z.object({
  courseId: z.string().min(1).max(64),
  chapterId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().min(1).max(10_000),
  summary: z.string().min(1).max(2000).optional(),
  sourceAssetIds: z.array(assetId).max(30).optional(),
  conceptRefs: z.array(conceptId).max(50).optional(),
  sectionId: z.string().regex(SECTION_ID).optional(),
}).strict()

export const sectionWriteOutput = z.object({ section: sectionDto }).strict()

export const sectionArticleWriteInput = z.object({
  sectionId,
  markdown: z.string().min(1).max(20_000),
  /** 扁平引用集；段落级引用走正文内联锚 `[[unit:su_xxx|label]]`，两者取并集去重后计入引用数。 */
  citations: z.array(sourceUnitId).min(1).max(100),
}).strict()

export const sectionArticleWriteOutput = z.object({
  sectionId,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
}).strict()

export const widgetWriteInput = z.object({
  sectionId,
  type: z.enum(WIDGET_TYPES),
  specVersion: z.literal(1),
  spec: z.record(z.string(), z.unknown()),
  assertions: z.record(z.string(), z.unknown()),
  citations: z.array(sourceUnitId).min(1).max(20),
}).strict()

export const widgetWriteOutput = z.object({
  widgetId: z.string().regex(WIDGET_ID),
  validation: z.record(z.string(), z.literal('pass')),
  status: z.string(),
}).strict()

export const sectionPreviewInput = z.object({ sectionId }).strict()

export const sectionPreviewOutput = z.object({
  section: z.object({
    sectionId,
    courseId: z.string(),
    chapterId: z.string(),
    title: z.string().max(200),
    position: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'archived']),
    summary: z.string().optional(),
    conceptRefs: z.array(z.string()),
  }).strict(),
  article: z.object({
    markdown: z.string(),
    citations: z.array(z.string()),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'archived']),
  }).strict().nullable(),
  widgets: z.array(z.object({
    widgetId: z.string().regex(WIDGET_ID),
    type: z.enum(WIDGET_TYPES),
    specVersion: z.number().int().positive(),
    spec: z.record(z.string(), z.json()),
    assertions: z.record(z.string(), z.json()),
    validation: z.record(z.string(), z.string()),
    status: z.enum(['draft', 'published', 'archived']),
    version: z.number().int().positive(),
    createdAt: z.string(),
  }).strict()),
  figures: z.array(z.object({
    figureId: z.string(),
    kind: z.enum(['keyframe', 'generated', 'diagram']),
    caption: z.string().max(200),
    status: z.enum(['planned', 'rendering', 'ready', 'failed', 'published']),
    selectedCandidateId: z.string().nullable(),
    spec: z.record(z.string(), z.json()).nullable(),
    sectionId: z.string().nullable(),
  }).strict()),
}).strict()

export const provenanceEntry = z.object({
  taskKey: z.enum(PROVENANCE_TASK_KEYS),
  model: z.string().min(1).max(200),
  provider: z.string().min(1).max(32).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cachedTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.enum(['success', 'error']),
  errorCode: z.string().max(64).optional(),
  skillVersions: z.record(z.string(), z.string().max(200)).optional(),
  targetId: z.string().max(200).optional(),
  summary: z.record(z.string(), z.json()).optional(),
}).strict()

export const provenanceOutput = z.object({
  runId: z.string().min(1),
  usageId: z.string().min(1),
}).strict()

export const figureWriteInput = z.discriminatedUnion('kind', [
  z.object({
    sectionId,
    kind: z.literal('keyframe'),
    assetId,
    sec: z.number().int().min(0).max(86_400),
    caption: z.string().min(1).max(200),
    unitId: sourceUnitId,
  }).strict(),
  z.object({
    sectionId,
    kind: z.literal('diagram'),
    template: z.enum(FIGURE_TEMPLATE_NAMES),
    params: z.record(z.string(), z.unknown()),
    caption: z.string().min(1).max(200),
  }).strict(),
])

export const figureWriteOutput = z.object({
  figureId: z.string().regex(FIGURE_ID_STRICT),
  kind: z.enum(['keyframe', 'diagram']),
  caption: z.string().max(200),
  status: z.enum(['ready']),
  selectedCandidateId: z.string().min(1),
  assetId: z.string().nullable(),
  sourceSec: z.number().int().nullable(),
  spec: z.record(z.string(), z.unknown()).nullable(),
}).strict()

const caseStockEvent = z.object({
  date: z.string().regex(DATE_STR),
  label: z.string().min(1).max(100),
  unitId: sourceUnitId,
}).strict()

const caseStockInput = z.object({
  name: z.string().min(1).max(50),
  exchange: z.enum(['SZSE', 'SSE', 'BSE']),
  code: z.string().regex(STOCK_CODE_PLAIN),
  windowStart: z.string().regex(DATE_STR),
  windowEnd: z.string().regex(DATE_STR),
  events: z.array(caseStockEvent).max(20).optional(),
  note: z.string().max(500).optional(),
}).strict()

export const caseStocksWriteInput = z.object({
  sectionId,
  stocks: z.array(caseStockInput).min(1).max(10),
}).strict()

export const caseStocksWriteOutput = z.object({
  saved: z.array(z.object({
    stockRefId: z.string().regex(CASE_STOCK_REF_ID),
    code: z.string().regex(STOCK_CODE_PLAIN),
    deduped: z.boolean(),
  }).strict()),
}).strict()

export const pipelineStatusInput = z.object({
  assetId: assetId.optional(),
  courseId: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict().refine(query => query.assetId !== undefined || query.courseId !== undefined, {
  message: 'assetId 与 courseId 至少提供一项',
})

export const pipelineJob = z.object({
  jobId: z.string(),
  assetId: z.string().nullable(),
  courseId: z.string(),
  kind: z.enum(['ingest', 'generate', 'illustrate', 'quotes_sync']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  stage: z.string(),
  progress: z.number(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  errorCode: z.string().nullable(),
  // 云端任务对象带时间戳与取消标记（对接清单 §pipeline/jobs）：实现可能只回其中一部分
  cancelRequested: z.boolean().optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().nullable().optional(),
  finishedAt: z.number().int().nonnegative().nullable().optional(),
}).strict()

export const pipelineStatusOutput = z.object({
  jobs: z.array(pipelineJob),
  total: z.number().int(),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
}).strict()

/** M3b B5：行情同步触发结果——job 快照 + 本次 upsert 行数。 */
export const quotesSyncOutput = z.object({
  job: pipelineJob,
  upserted: z.number().int().nonnegative(),
}).strict()

export const transcriptOutput = z.object({
  transcript: z.object({
    transcriptId: z.string().regex(TRANSCRIPT_ID),
    assetId,
    status: z.string(),
    language: z.string(),
    durationMs: z.number().int().nonnegative(),
    chunkCount: z.number().int().nonnegative(),
    segmentCount: z.number().int().nonnegative(),
    errorCode: z.string().nullable(),
  }).strict(),
  segments: z.array(z.object({
    idx: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string(),
  }).strict()),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
}).strict()

export type FramesOutput = z.infer<typeof framesOutput>
export type SourceUnitsWriteOutput = z.infer<typeof sourceUnitsWriteOutput>
export type SourceUnitsSearchOutput = z.infer<typeof sourceUnitsSearchOutput>
export type ConceptWriteOutput = z.infer<typeof conceptWriteOutput>
export type ConceptsListOutput = z.infer<typeof conceptsListOutput>
export type ConceptEdgeWriteOutput = z.infer<typeof conceptEdgeWriteOutput>
export type SectionsListOutput = z.infer<typeof sectionsListOutput>
export type SectionWriteOutput = z.infer<typeof sectionWriteOutput>
export type SectionArticleWriteOutput = z.infer<typeof sectionArticleWriteOutput>
export type WidgetWriteOutput = z.infer<typeof widgetWriteOutput>
export type SectionPreviewOutput = z.infer<typeof sectionPreviewOutput>
export type ProvenanceOutput = z.infer<typeof provenanceOutput>
export type FigureWriteOutput = z.infer<typeof figureWriteOutput>
export type CaseStocksWriteOutput = z.infer<typeof caseStocksWriteOutput>
export type PipelineStatusOutput = z.infer<typeof pipelineStatusOutput>
export type PipelineJob = z.infer<typeof pipelineJob>
export type SourceUnitInput = z.infer<typeof sourceUnitInput>
export type WidgetWriteInput = z.infer<typeof widgetWriteInput>
export type ProvenanceEntry = z.infer<typeof provenanceEntry>
export type TranscriptOutput = z.infer<typeof transcriptOutput>
export type SourceUnitsReadOutput = z.infer<typeof sourceUnitsReadOutput>
export type ApprovalsListOutput = z.infer<typeof approvalsListOutput>
export type QuotesSyncOutput = z.infer<typeof quotesSyncOutput>
export type ApprovalItem = z.infer<typeof approvalItem>
