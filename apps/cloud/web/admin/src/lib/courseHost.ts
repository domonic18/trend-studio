import { createAssetPlaybackSession, getAdminCourseQuotes, getFigureCandidateBlob } from '../api'
import type { CoursePreviewHost, FigureMeta, PlaybackSessionTicket } from '@trend/widgets/course'

/** 为课程预览页构造宿主适配：figure blob URL 生命周期、片段会话、行情加载。 */
export function createCourseHost(
  courseId: string,
  figureMap: Map<string, FigureMeta> = new Map(),
): CoursePreviewHost & { revokeFigureUrls: () => void } {
  const figureUrls = new Map<string, string>()

  return {
    figures: figureMap,

    async resolveFigureUrl(figureId: string): Promise<string> {
      const cached = figureUrls.get(figureId)
      if (cached !== undefined) return cached
      const candidateId = figureMap.get(figureId)?.selectedCandidateId
      if (candidateId === undefined || candidateId === null) throw new Error('figure unresolved')
      const url = await getFigureCandidateBlob(candidateId)
      figureUrls.set(figureId, url)
      return url
    },

    createPlaybackSession: async (assetId, fromSec, toSec) => {
      const session = await createAssetPlaybackSession(assetId, fromSec, toSec)
      return session as PlaybackSessionTicket
    },

    loadQuotes: async (codes: string[]) => {
      return getAdminCourseQuotes(courseId, codes)
    },

    revokeFigureUrls: () => {
      for (const url of figureUrls.values()) {
        URL.revokeObjectURL(url)
      }
      figureUrls.clear()
    },
  }
}
