/** 富文本 DSL v1 渲染组件包的公共契约：分段模型与宿主回调（独立包边界，不依赖 admin/portal）。 */

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

/** 宿主注入的数据通道：图示 blob 解析与 asset 播放会话签发（admin/portal 各自实现）。 */
export interface ArticleHost {
  figures: Map<string, FigureMeta>
  resolveFigureUrl: (figureId: string) => Promise<string>
  createPlaybackSession: (assetId: string, fromSec?: number, toSec?: number) => Promise<PlaybackSessionTicket>
}

export type ArticleSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'block'; directive: string; attrs: Record<string, string>; bodyLines: string[] }
