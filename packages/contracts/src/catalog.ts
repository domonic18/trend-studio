/**
 * 学员侧（catalog）契约：课程消费端下发的数据形状。
 *
 * v3 起与 admin 契约分开——admin 是管理面（写入 + 复检），catalog 是学员面（只读已发布内容）。
 */

import { z } from 'zod'
import { KLINE_PERIODS } from './enums.js'

/** 行情条目：腾讯前复权 K 线原始口径（周期原生：1d 日线 / 1w 周线）。 */
export const quotesItem = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  /** 成交量，单位手（1 手 = 100 股）。 */
  volume: z.number().int().nonnegative(),
  /** 成交额（元）；腾讯前复权 K 线不含成交额，为 null。 */
  amount: z.number().nullable(),
  /** 复权口径来源（tencent-qfq）。 */
  source: z.string().min(1).max(32),
  /** 该 bar 的周期：日线 1d / 周线 1w。 */
  period: z.enum(KLINE_PERIODS).default('1d'),
}).strict()

export const quotesListOutput = z.object({
  /** 课程有已发布案例股但一行行情都没有 → 尚未同步，渲染层显示等待态。 */
  pending: z.boolean(),
  quotes: z.array(quotesItem),
}).strict()

export type QuotesItem = z.infer<typeof quotesItem>
export type QuotesListOutput = z.infer<typeof quotesListOutput>

/**
 * 契约版本：2 = 章级目录（老课程，字段零变化）；3 = 节级学习契约（课程树附带 sections[]）。
 */
export const CATALOG_CONTRACT_VERSIONS = [2, 3] as const
export type CatalogContractVersion = (typeof CATALOG_CONTRACT_VERSIONS)[number]

/** v3 课程树里的节摘要：够渲染目录页，不必下发正文。 */
export const catalogSectionSummary = z.object({
  sectionId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().nonnegative(),
  hasArticle: z.boolean(),
  figureCount: z.number().int().nonnegative(),
  /** 课件类型清单（去重后按字典序）。 */
  widgetTypes: z.array(z.string().min(1).max(32)),
  /** 已发布案例股代号。 */
  caseStockCodes: z.array(z.string().regex(/^[0-9]{6}$/)),
}).strict()

/** v3 节详情里的课件条目：spec 与断言原样下发，渲染端本地复算。 */
export const catalogWidgetOutput = z.object({
  widgetId: z.string().min(1).max(64),
  type: z.string().min(1).max(32),
  specVersion: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  spec: z.record(z.string(), z.unknown()),
  assertions: z.record(z.string(), z.unknown()),
}).strict()

/** v3 节详情里的图示元数据：图片本体走签名 URL（figureUrl），学员端直接取。 */
export const catalogFigureOutput = z.object({
  figureId: z.string().min(1).max(64),
  kind: z.string().min(1).max(16),
  caption: z.string().min(1).max(200),
  assetId: z.string().nullable(),
  sourceSec: z.number().int().nullable(),
  candidateId: z.string().nullable(),
  /** 已选定候选的签名图片地址；未选定或候选未就绪时为 null。 */
  url: z.string().min(1).nullable(),
}).strict()

/** v3 节详情里的案例股：代号、名称、周期与事件窗。 */
export const catalogCaseStockOutput = z.object({
  code: z.string().regex(/^[0-9]{6}$/),
  name: z.string().min(1).max(50),
  exchange: z.enum(['SZSE', 'SSE', 'BSE']),
  /** 该案例股讲解的周期：日线 1d / 周线 1w；K 线按此周期取。 */
  period: z.enum(KLINE_PERIODS).default('1d'),
  windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  windowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  events: z.array(z.unknown()),
}).strict()

/** v3 节详情：正文 + 课件 + 图示 + 案例股。 */
export const catalogSectionOutput = z.object({
  sectionId: z.string().min(1).max(64),
  courseId: z.string().min(1).max(64),
  chapterId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().nonnegative(),
  /** 节导语（hero lead）；未撰写时不下发。 */
  summary: z.string().min(1).max(500).optional(),
  /** 节关联概念的名称，按 section.concept_refs 顺序；供 hero chip 显示。 */
  conceptNames: z.array(z.string().min(1).max(64)).optional(),
  article: z.object({
    markdown: z.string().min(1).max(20000),
    dslVersion: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    publishedAt: z.number().int(),
  }).nullable(),
  widgets: z.array(catalogWidgetOutput),
  figures: z.array(catalogFigureOutput),
  caseStocks: z.array(catalogCaseStockOutput),
}).strict()

/** 学员播放会话：HLS 直放地址 + 生效窗。 */
export const catalogPlaybackOutput = z.object({
  sessionId: z.string().min(1).max(64),
  playlistUrl: z.string().min(1),
  fromSec: z.number().int().nullable(),
  toSec: z.number().int().nullable(),
  expiresAt: z.number().int(),
}).strict()

export type CatalogSectionSummary = z.infer<typeof catalogSectionSummary>
export type CatalogWidgetOutput = z.infer<typeof catalogWidgetOutput>
export type CatalogFigureOutput = z.infer<typeof catalogFigureOutput>
export type CatalogCaseStockOutput = z.infer<typeof catalogCaseStockOutput>
export type CatalogSectionOutput = z.infer<typeof catalogSectionOutput>
export type CatalogPlaybackOutput = z.infer<typeof catalogPlaybackOutput>
