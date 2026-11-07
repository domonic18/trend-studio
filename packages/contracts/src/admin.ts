/**
 * 生产 admin API 契约的 zod 单一真相源（对接清单 §3.13，架构 §6.6）。
 * producer 工具入参与云端响应共用同一组 schema；字段变更先改云端文档，再改此处。
 */

import { z } from 'zod'
import {
  APPROVAL_ID, ASSET_ID, CASE_STOCK_REF_ID, CONCEPT_EDGE_ID, CONCEPT_ID, DATE_STR, FIGURE_ID_REF, FIGURE_ID_STRICT,
  SECTION_ID, SOURCE_UNIT_ID, STOCK_CODE, STOCK_CODE_PLAIN, TRANSCRIPT_ID, WIDGET_ID,
} from './ids.js'
import {
  ANNOTATION_KINDS, COURSE_OVERLAYS, FIGURE_TEMPLATE_NAMES, GENERATOR_IDS, KLINE_PERIODS, PROVENANCE_TASK_KEYS, WIDGET_TYPES,
} from './enums.js'

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
  /** A6：素材仍在转写时为 true——已读到的 unit 有效，但素材的 unit 集合尚未齐。 */
  partial: z.boolean(),
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

/**
 * 发布就绪度：把「发布事务会拦住的门禁」事先摊开给人和工具看。
 *
 * 门禁集合与发布事务**同源**——就绪度卡片的每一格都来自发布时跑的同一批检查，
 * 不另立一套判定，避免「卡片全绿、点发布就 409」。
 */
export const READINESS_GATES = ['figures', 'widgets', 'clips', 'annotations', 'approval'] as const
export type ReadinessGate = (typeof READINESS_GATES)[number]

export const courseReadinessInput = z.object({
  courseId: z.string().min(1).max(64),
}).strict()

export const readinessIssue = z.object({
  /** 与发布冲突码同名，便于按码给中文指引。 */
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  /** 命中的对象（figureId / widgetId / 节号…），供界面定位。 */
  targets: z.array(z.string().max(200)).max(200).optional(),
}).strict()

export const readinessFinding = z.object({
  gate: z.enum(READINESS_GATES),
  label: z.string().min(1).max(50),
  /** pass=过；fail=有硬伤，发布会拦；pending=还没到（例：尚未签批）。 */
  status: z.enum(['pass', 'fail', 'pending']),
  /** 一句话现状，例：「36/36 断言全通过」。 */
  summary: z.string().min(1).max(200),
  issues: z.array(readinessIssue),
}).strict()

export const courseReadinessOutput = z.object({
  courseId: z.string().min(1).max(64),
  /** 当前内容指纹（与签批记录同口径），十六进制。 */
  fingerprint: z.string().length(64),
  /** 签批时记录的指纹；无签批记录为 null。 */
  approvedFingerprint: z.string().length(64).nullable(),
  gates: z.array(readinessFinding),
  /** 全部硬门禁过且签批有效 = 可发布。 */
  publishable: z.boolean(),
  /** 待办事项的中文短句，按顺序。 */
  pending: z.array(z.string().min(1).max(100)).max(20),
}).strict()

/** M3b：腾讯前复权日K 同步（课程案例股清单驱动，幂等 upsert）。 */
export const quotesSyncInput = z.object({
  courseId: z.string().min(1).max(64),
}).strict()

/**
 * M10 v2：读课程案例股行情缓存（草稿可见）。
 * 正文 `:::annotation` 的交易日只能取自这里的 tradeDate——视频里的日期未必在缓存窗口内。
 */
export const quotesReadInput = z.object({
  courseId: z.string().min(1).max(64),
  codes: z.array(z.string().regex(STOCK_CODE_PLAIN)).max(10).optional(),
  from: z.string().regex(DATE_STR).optional(),
  to: z.string().regex(DATE_STR).optional(),
  /** K 线周期：1d 日线 / 1w 周线，缺省日线。缓存按周期分存，跨周期读为空。 */
  period: z.enum(KLINE_PERIODS).optional(),
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

/**
 * 术语更新（管理台术语抽屉）：按 conceptId 改别名、定义与状态。
 *
 * 名称是术语的主键语义（正文的 glossary 按名称/别名匹配），改名走「归档 + 新建」。
 * 归档可逆：状态置回 `draft` 即恢复；归档后该术语不再计入 `:::annotation` 的 glossary 校验，
 * 未解引用会在发布就绪度卡片上显形。
 */
export const conceptUpdateInput = z.object({
  courseId: z.string().min(1).max(64),
  conceptId,
  aliases: z.array(z.string().min(1).max(200)).max(20).optional(),
  definition: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'archived']).optional(),
}).strict()

export const conceptUpdateOutput = z.object({ conceptId }).strict()

export const conceptsListInput = z.object({
  courseId: z.string().min(1).max(64),
}).strict()

export const conceptListItem = z.object({
  conceptId,
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)),
  definition: z.string().max(2000).nullable(),
  status: z.enum(['draft', 'published', 'archived']),
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

/** 课程与章是「节」的前置骨架——没有它们，写节会被云端挡回 chapter not found。 */
export const courseCreateInput = z.object({
  courseId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
}).strict()

export const courseDto = z.object({
  courseId: z.string(),
  title: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
}).strict()

export const courseCreateOutput = z.object({ course: courseDto }).strict()

export const chapterWriteInput = z.object({
  courseId: z.string().min(1).max(64),
  chapterId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).max(10_000).optional(),
}).strict()

export const chapterDto = z.object({
  chapterId: z.string(),
  title: z.string(),
  position: z.number().int(),
}).strict()

export const chapterWriteOutput = z.object({ chapter: chapterDto }).strict()

/**
 * 课程/章读取：教员与 Agent 都需要先看清「这门课已经有什么骨架」——
 * 没有读接口就只能猜 chapterId，猜错就是一堆 404 与半成品骨架。
 *
 * 云端的课程列表还带节数/图示数等计数，课程树里的章还带知识点与正文元数据，
 * 这里只取骨架字段（多余字段由 zod 剥掉，不算契约违约）。
 */
export const courseReadInput = z.object({
  courseId: z.string().min(1).max(64).optional(),
}).strict()

export const courseSummaryDto = z.object({
  courseId: z.string(),
  title: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  chapterCount: z.number().int().optional(),
})

export const chapterSummaryDto = z.object({
  chapterId: z.string(),
  title: z.string(),
  position: z.number().int(),
})

/** 一次调用同时给课程清单与章清单：courseId 缺省 = 只列课程，给了 = 列该课程的章。 */
export const courseReadOutput = z.object({
  courses: z.array(courseSummaryDto),
  chapters: z.array(chapterSummaryDto),
}).strict()

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
  specVersion: z.union([z.literal(1), z.literal(2)]),
  spec: z.record(z.string(), z.unknown()),
  assertions: z.record(z.string(), z.unknown()),
  citations: z.array(sourceUnitId).min(1).max(20),
}).strict()

/** M10 v2：bar-replay-decision 课件 spec（架构 §6.6.5）。bars 不入 spec——由宿主按 §6.6.3 取得。 */
export const barReplayDecisionSpec = z.strictObject({
  code: z.string().regex(STOCK_CODE, 'code 格式不合法'),
  window: z.strictObject({
    from: z.string().regex(DATE_STR, 'window.from 格式不合法'),
    to: z.string().regex(DATE_STR, 'window.to 格式不合法'),
  }),
  overlays: z.array(z.enum(COURSE_OVERLAYS)).max(3).optional(),
  period: z.enum(KLINE_PERIODS).optional(),
  annotations: z.array(z.strictObject({
    unitId: sourceUnitId,
    atMs: z.number().int().nonnegative().max(86_400_000),
    kind: z.enum(ANNOTATION_KINDS),
    d: z.string().regex(DATE_STR, 'annotation.d 格式不合法'),
    label: z.string().trim().min(1).max(50),
  })).max(12).optional(),
  decisions: z.array(z.strictObject({
    atDate: z.string().regex(DATE_STR, 'decision.atDate 格式不合法'),
    question: z.string().trim().min(1).max(500),
    options: z.array(z.strictObject({ label: z.string().trim().min(1).max(200) })).min(2).max(4),
    correct: z.number().int().min(0).max(3),
    revealText: z.string().trim().min(1).max(2000),
    unitId: sourceUnitId,
    atMs: z.number().int().nonnegative().max(86_400_000),
  })).min(1).max(8),
  citations: z.array(sourceUnitId).min(1).max(20),
}).strict()

/** bar-replay-decision 必带断言（架构 §6.6.5）：三条新证明 + 复用 answerUnique。 */
export const BAR_REPLAY_DECISION_ASSERTIONS = [
  'decisionPointsGrounded',
  'revealMonotonic',
  'annotationTermsGrounded',
  'answerUnique',
] as const

/** M10 v3：image-juxtaposition 前后对比滑块（架构 §6.6.5）。两侧各为课程画面或合成 K 线。 */
const juxtapositionSide = z.union([
  z.strictObject({ figureId: z.string().regex(FIGURE_ID_REF, 'figureId 格式不合法') }),
  z.strictObject({
    generator: z.enum(GENERATOR_IDS),
    seed: z.number().int().nonnegative().max(2_147_483_647),
    bars: z.number().int().min(20).max(300),
  }),
])

export const imageJuxtapositionSpec = z.strictObject({
  left: juxtapositionSide,
  right: juxtapositionSide,
  labels: z.strictObject({
    left: z.string().trim().min(1).max(60),
    right: z.string().trim().min(1).max(60),
  }),
  captions: z.strictObject({
    left: z.string().trim().min(1).max(300),
    right: z.string().trim().min(1).max(300),
  }),
  citations: z.array(sourceUnitId).min(1).max(20),
}).strict()

export const IMAGE_JUXTAPOSITION_ASSERTIONS = [
  'pairSidesValid',
  'captionsGrounded',
] as const

/** M10 v3：branching-scenario 分支情景练习（架构 §6.6.5）。节点无 options 即终点。 */
export const branchingScenarioSpec = z.strictObject({
  scenario: z.string().trim().min(1).max(800),
  entryId: z.string().trim().min(1).max(40),
  nodes: z.array(z.strictObject({
    id: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(1).max(500),
    options: z.array(z.strictObject({
      label: z.string().trim().min(1).max(200),
      next: z.string().trim().min(1).max(40),
      feedback: z.string().trim().min(1).max(500),
    })).min(2).max(4).optional(),
  })).min(1).max(20),
  optimalPath: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  citations: z.array(sourceUnitId).min(1).max(20),
}).strict()

export const BRANCHING_SCENARIO_ASSERTIONS = [
  'graphAcyclic',
  'allPathsTerminate',
  'optimalPathReachable',
  'feedbackNonEmpty',
] as const

/** 课件删除（生产端纠错回路）：同节同 code 的回放课件写错时删旧再写。 */
export const widgetDeleteInput = z.object({
  sectionId,
  widgetId: z.string().regex(WIDGET_ID),
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
    /** 正文实际用到的 DSL 组件版本（v1=1，含 annotation/replay=2）。 */
    dslVersion: z.number().int().nonnegative(),
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
    /** 课件引用集：重写课件时按此原样带回，不必从正文反推。 */
    citations: z.array(sourceUnitId),
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

/** 图示删除（生产端纠错回路）：配额或抽错帧写歪时删掉重来。 */
export const figureDeleteInput = z.object({
  sectionId,
  figureId: z.string().regex(FIGURE_ID_STRICT, 'figureId 格式不合法'),
}).strict()

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
  /** K 线周期：课件讲日线画日线，讲周线画周线。缺省日线。 */
  period: z.enum(KLINE_PERIODS).optional(),
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

/** 案例股清单读回（管理台编辑抽屉用；此前该端点无契约）。 */
export const caseStocksListOutput = z.object({
  stocks: z.array(z.object({
    stockRefId: z.string().regex(CASE_STOCK_REF_ID),
    sectionId,
    name: z.string().max(50),
    exchange: z.string().max(16),
    code: z.string().regex(STOCK_CODE_PLAIN),
    period: z.string().max(8),
    windowStart: z.string().regex(DATE_STR),
    windowEnd: z.string().regex(DATE_STR),
    events: z.array(caseStockEvent),
    note: z.string().max(500).nullable(),
    status: z.string().max(16),
    position: z.number().int(),
    createdAt: z.string(),
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
    /** A6：转写未完成时为 true——segments 是已转写部分的前缀，后续还会增长。 */
    partial: z.boolean(),
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
export type ConceptUpdateOutput = z.infer<typeof conceptUpdateOutput>
export type ConceptsListOutput = z.infer<typeof conceptsListOutput>
export type CaseStocksListOutput = z.infer<typeof caseStocksListOutput>
export type CourseReadinessOutput = z.infer<typeof courseReadinessOutput>
export type ConceptEdgeWriteOutput = z.infer<typeof conceptEdgeWriteOutput>
export type SectionsListOutput = z.infer<typeof sectionsListOutput>
export type SectionWriteOutput = z.infer<typeof sectionWriteOutput>
export type CourseCreateOutput = z.infer<typeof courseCreateOutput>
export type ChapterWriteOutput = z.infer<typeof chapterWriteOutput>
export type CourseReadOutput = z.infer<typeof courseReadOutput>
export type SectionArticleWriteOutput = z.infer<typeof sectionArticleWriteOutput>
export type WidgetWriteOutput = z.infer<typeof widgetWriteOutput>
export type SectionPreviewOutput = z.infer<typeof sectionPreviewOutput>
export type ProvenanceOutput = z.infer<typeof provenanceOutput>
export type FigureWriteOutput = z.infer<typeof figureWriteOutput>
export type FigureDeleteInput = z.infer<typeof figureDeleteInput>
export type CaseStocksWriteOutput = z.infer<typeof caseStocksWriteOutput>
export type PipelineStatusOutput = z.infer<typeof pipelineStatusOutput>
export type PipelineJob = z.infer<typeof pipelineJob>
export type SourceUnitInput = z.infer<typeof sourceUnitInput>
export type WidgetWriteInput = z.infer<typeof widgetWriteInput>
export type WidgetDeleteInput = z.infer<typeof widgetDeleteInput>
export type ProvenanceEntry = z.infer<typeof provenanceEntry>
export type TranscriptOutput = z.infer<typeof transcriptOutput>
export type SourceUnitsReadOutput = z.infer<typeof sourceUnitsReadOutput>
export type ApprovalsListOutput = z.infer<typeof approvalsListOutput>
export type QuotesSyncOutput = z.infer<typeof quotesSyncOutput>
export type QuotesReadInput = z.infer<typeof quotesReadInput>
export type ApprovalItem = z.infer<typeof approvalItem>
