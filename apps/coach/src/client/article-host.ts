import type { ArticleHost, FigureMeta, PlaybackSessionTicket } from '@trend/widgets'
import type { CatalogPlayback, CatalogSection } from '../shared/contracts.js'

export interface SectionPlaybackRequester {
  sectionPlayback(
    sectionId: string,
    assetId: string,
    fromSec: number,
    toSec: number,
  ): Promise<
    { ok: true; value: CatalogPlayback } | { ok: false; error: { code: string; message: string } }
  >
}

/**
 * 学员端 ArticleHost：图示签名地址随节载荷下发，直接取用；
 * 播放会话走学员播放端点，越窗由云端判定。
 */
export function createArticleHost(
  section: CatalogSection,
  requester: SectionPlaybackRequester,
): ArticleHost {
  const figures = new Map<string, FigureMeta>()
  const signedUrls = new Map<string, string>()
  for (const figure of section.figures) {
    figures.set(figure.figureId, {
      figureId: figure.figureId,
      caption: figure.caption,
      kind: figure.kind,
      selectedCandidateId: figure.candidateId,
    })
    if (figure.url !== null) signedUrls.set(figure.figureId, figure.url)
  }

  return {
    figures,
    resolveFigureUrl: async (figureId: string): Promise<string> => {
      const url = signedUrls.get(figureId)
      if (url === undefined) throw new Error('图示暂不可用')
      return url
    },
    createPlaybackSession: async (
      assetId: string,
      fromSec?: number,
      toSec?: number,
    ): Promise<PlaybackSessionTicket> => {
      if (fromSec === undefined || toSec === undefined) throw new Error('片段缺少时间窗')
      const result = await requester.sectionPlayback(section.sectionId, assetId, fromSec, toSec)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  }
}
