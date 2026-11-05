/**
 * 节生产 fixture 骨架：一组 wire 形状的输入 + 期望判定。
 * 判定器由消费方实现（cloud 契约测试 / producer 本地预校验 / 本包自测），
 * 统一以 @trend/contracts 的 zod schema 与 DSL 校验为准。
 */

import type { WidgetWriteInput } from '@trend/contracts'

export type Expectation =
  | { verdict: 'accept' }
  | { verdict: 'reject'; kind: 'schema' }
  | { verdict: 'reject'; kind: 'figure_ref_unknown' }
  | { verdict: 'reject'; kind: 'unit_ref_unknown' }
  | { verdict: 'reject'; kind: 'unit_anchor_unknown' }
  | { verdict: 'reject'; kind: 'clip_not_grounded' }
  | { verdict: 'reject'; kind: 'stock_not_in_list' }

/** 已保存 source unit 的节内快照：写入形状字段 + 云端分配的 unitId（DSL 引用键）。 */
export interface UnitSnapshot {
  unitId: string
  assetId: string
  startMs: number
  endMs: number
  transcriptText: string
  summary: string
  visual?: Record<string, unknown>
}

export interface SectionFigureSnapshot {
  figureId: string
  kind: 'keyframe' | 'diagram'
  caption: string
}

export interface CaseStockSnapshot {
  name: string
  exchange: 'SZSE' | 'SSE' | 'BSE'
  code: string
  windowStart: string
  windowEnd: string
}

/** widget 写入形状；specVersion 放宽为 number 以承载「错误版本」反例（判定器负责拒绝）。 */
export type WidgetWriteShape = Omit<WidgetWriteInput, 'specVersion'> & { specVersion: number }

export interface SectionFixture {
  name: string
  description: string
  sectionId: string
  units: UnitSnapshot[]
  figures: SectionFigureSnapshot[]
  caseStocks: CaseStockSnapshot[]
  article: {
    markdown: string
    citations: string[]
  }
  widgets?: WidgetWriteShape[]
  expect: Expectation
}

export const SECTION_ID = 'sec_0123456789abcdef'
export const ASSET_ID = 'asset_0123456789abcdef'
export const UNIT_ID = 'su_0123456789abcdef'
export const FIGURE_ID = 'fig_0123456789abcdef'

/** 唯一合法 source unit：[60s, 180s) 窗，案例股与 clip 都锚定在它上面。 */
export function baseUnit(): UnitSnapshot {
  return {
    unitId: UNIT_ID,
    assetId: ASSET_ID,
    startMs: 60_000,
    endMs: 180_000,
    transcriptText: '起飞平台是趋势延续的中继形态。突破当天的量能要放到 20 日均量的两倍以上，平台才算有效。回踩不破平台上沿，是加仓点而非止损点。',
    summary: '起飞平台定义与量能判据',
    visual: { description: '日 K 缩量平台后放量长阳', keyframes: [{ sec: 70 }] },
  }
}

export function baseCaseStocks(): CaseStockSnapshot[] {
  return [{
    name: '丰乐种业',
    exchange: 'SZSE',
    code: '000713',
    windowStart: '2024-01-02',
    windowEnd: '2024-03-01',
  }]
}

export function baseFigure(): SectionFigureSnapshot {
  return { figureId: FIGURE_ID, kind: 'keyframe', caption: '起飞平台量价结构' }
}
