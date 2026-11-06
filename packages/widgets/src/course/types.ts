/** 课程预览视图模型：管理台与学员端共享的渲染契约，零 HTTP 依赖。 */

export interface CoursePreviewView {
  course: CourseMeta
  chapters: ChapterView[]
}

export interface CourseMeta {
  courseId: string
  title: string
  status: 'draft' | 'published' | 'archived'
}

export interface ChapterView {
  chapterId: string
  title: string
  position: number
  sections: SectionView[]
}

export interface SectionView {
  section: SectionMeta
  article: ArticleView | null
  widgets: WidgetView[]
  figures: FigureView[]
  caseStocks: CaseStockView[]
}

export interface SectionMeta {
  sectionId: string
  courseId: string
  chapterId: string
  title: string
  position: number
  status: 'draft' | 'published' | 'archived'
  summary?: string
  conceptRefs: string[]
  /** 概念名（按 conceptRefs 顺序）：hero chip 显示用；缺省时回落到 conceptRefs[0]。 */
  conceptNames?: string[]
}

export interface ArticleView {
  markdown: string
  citations: string[]
  version: number
  status: 'draft' | 'published' | 'archived'
  dslVersion: number
}

export interface WidgetView {
  widgetId: string
  type: string
  specVersion: number
  spec: unknown
  assertions: unknown
  validation: Record<string, string>
  status: 'draft' | 'published' | 'archived'
  version: number
  createdAt: string
}

export interface FigureView {
  figureId: string
  kind: string
  caption: string
  status: string
  selectedCandidateId: string | null
  spec: unknown
  sectionId: string | null
}

export interface CaseStockView {
  stockRefId: string
  name: string
  exchange: 'SZSE' | 'SSE' | 'BSE'
  code: string
  /** K 线周期：课程讲日线画日线，讲周线画周线。缺省日线。 */
  period?: KlinePeriod
  windowStart: string
  windowEnd: string
  events: CaseStockEvent[]
  note: string | null
  status: 'draft' | 'published' | 'archived'
  position: number
}

export interface CaseStockEvent {
  date: string
  label: string
  unitId: string
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

import type { ArticleHost } from '../types.js'
import type { KlinePeriod } from '../kline/period.js'

export interface CoursePreviewHost extends ArticleHost {
  /**
   * 按周期取行情：一节课可能同时有日线案例股与周线案例股，故按周期分次取。
   * 返回的 bar 均为该周期的原生序列（周线即周线 bar，不是日线聚合）。
   */
  loadQuotes: (
    codes: string[],
    period: KlinePeriod,
  ) => Promise<{ pending: boolean; quotes: CourseQuote[] }>
  /**
   * 按节签发播放会话：学员端播放会话须落在该节已发布正文的片段窗内，故须带 sectionId。
   * 不提供时回落到 ArticleHost 的无节签发（管理台预览用）。
   */
  createPlaybackSessionForSection?: (
    sectionId: string,
    assetId: string,
    fromSec?: number,
    toSec?: number,
  ) => Promise<PlaybackSessionTicket>
}

export interface FigureMeta {
  figureId: string
  caption: string
  kind: string
  selectedCandidateId: string | null
}

export interface PlaybackSessionTicket {
  sessionId: string
  playlistUrl: string
  fromSec: number | null
  toSec: number | null
  expiresAt: number
}

export interface KlineBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  code?: string
  /** 该 bar 的周期：日线 1d / 周线 1w；取数方按它筛选。 */
  period?: '1d' | '1w'
}

export type ExchangeLabel = '深交所' | '上交所' | '北交所'

export function exchangeLabel(exchange: string): ExchangeLabel {
  switch (exchange) {
    case 'SZSE': return '深交所'
    case 'SSE': return '上交所'
    case 'BSE': return '北交所'
    default: return '深交所'
  }
}

export function toBars(quotes: CourseQuote[]): KlineBar[] {
  return quotes
    .slice()
    .sort((a, b) => (a.tradeDate > b.tradeDate ? 1 : -1))
    .map(q => ({
      tradeDate: q.tradeDate,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
      amount: q.amount,
      code: q.code,
      period: q.period,
    }))
}

export function barsByCode(quotes: CourseQuote[]): Map<string, KlineBar[]> {
  const map = new Map<string, CourseQuote[]>()
  for (const q of quotes) {
    const list = map.get(q.code) ?? []
    list.push(q)
    map.set(q.code, list)
  }
  const result = new Map<string, KlineBar[]>()
  for (const [code, list] of map) {
    result.set(code, toBars(list))
  }
  return result
}

export function caseWindowBounds(bars: KlineBar[]): { start: string; end: string } | null {
  if (bars.length === 0) return null
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  return { start: first.tradeDate, end: last.tradeDate }
}
