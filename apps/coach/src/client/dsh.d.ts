import type { Context } from '@deepseek-ai/cordis'
import type {
  AuthStatus,
  CatalogChapterArticle,
  CatalogCourse,
  CatalogCourseSummary,
  CatalogPlayback,
  CatalogSection,
  DeviceAuthPoll,
  DeviceAuthStart,
  EventsConsent,
  KnowledgePointDetail,
  LearnerContextAck,
  LearnerContextUpdate,
  PlaybackSession,
  ProgressResult,
  QuoteList,
  SearchResult,
  Segment,
  VoiceTranscript,
} from '../shared/contracts.js'

export type RemoteSearchResult =
  | { ok: true; value: SearchResult }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSegmentResult =
  | { ok: true; value: Segment }
  | { ok: false; error: { code: string; message: string } }

export type RemotePlaybackResult =
  | { ok: true; value: PlaybackSession }
  | { ok: false; error: { code: string; message: string } }

export type RemoteAuthStatusResult =
  | { ok: true; value: AuthStatus }
  | { ok: false; error: { code: string; message: string } }

export type RemoteDeviceAuthStartResult =
  | { ok: true; value: DeviceAuthStart }
  | { ok: false; error: { code: string; message: string } }

export type RemoteDeviceAuthPollResult =
  | { ok: true; value: DeviceAuthPoll }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSignOutResult =
  | { ok: true; value: { signedOut: true } }
  | { ok: false; error: { code: string; message: string } }

export type RemoteEventsConsentResult =
  | { ok: true; value: EventsConsent }
  | { ok: false; error: { code: string; message: string } }

export type RemoteReportResult =
  | { ok: true; value: { reported: true } }
  | { ok: false; error: { code: string; message: string } }

export type RemoteCatalogCoursesResult =
  | { ok: true; value: { courses: CatalogCourseSummary[] } }
  | { ok: false; error: { code: string; message: string } }

export type RemoteCatalogCourseResult =
  | { ok: true; value: CatalogCourse }
  | { ok: false; error: { code: string; message: string } }

export type RemoteCatalogChapterResult =
  | { ok: true; value: CatalogChapterArticle }
  | { ok: false; error: { code: string; message: string } }

export type RemoteCatalogSectionResult =
  | { ok: true; value: CatalogSection }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSectionPlaybackResult =
  | { ok: true; value: CatalogPlayback }
  | { ok: false; error: { code: string; message: string } }

export type RemoteCourseQuotesResult =
  | { ok: true; value: QuoteList }
  | { ok: false; error: { code: string; message: string } }

export type RemoteKnowledgePointResult =
  | { ok: true; value: KnowledgePointDetail }
  | { ok: false; error: { code: string; message: string } }

export type RemoteProgressResult =
  | { ok: true; value: ProgressResult }
  | { ok: false; error: { code: string; message: string } }

export type RemoteLearnerContextResult =
  | { ok: true; value: LearnerContextAck }
  | { ok: false; error: { code: string; message: string } }

export type RemoteVoiceTranscriptResult =
  | { ok: true; value: VoiceTranscript }
  | { ok: false; error: { code: string; message: string } }

interface SlotsService {
  inject(key: string, callback: () => void | (() => void)): void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface SidebarRightTabsService {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: Array<{
      id: string
      order: number
      title: () => string
      description?: () => string
    }>
  }): () => void
}

interface SidebarRightService {
  openTab(kind: string, options?: { params?: Record<string, unknown> }): void
  openResource(address: string, options?: { params?: Record<string, unknown> }): void
}

interface ClientRemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
  trendCoach: {
    search(query: string, topK: number): Promise<RemoteSearchResult>
    getSegment(segmentId: string): Promise<RemoteSegmentResult>
    createPlaybackSession(segmentId: string): Promise<RemotePlaybackResult>
    authStatus(): Promise<RemoteAuthStatusResult>
    beginDeviceAuth(): Promise<RemoteDeviceAuthStartResult>
    pollDeviceAuth(): Promise<RemoteDeviceAuthPollResult>
    eventConsent(): Promise<RemoteEventsConsentResult>
    setEventConsent(consent: boolean): Promise<RemoteEventsConsentResult>
    reportCitationClick(segmentId: string): Promise<RemoteReportResult>
    reportPlayerStarted(startupMs: number, autoplayBlocked: boolean): Promise<RemoteReportResult>
    catalogCourses(): Promise<RemoteCatalogCoursesResult>
    catalogCourse(courseId: string): Promise<RemoteCatalogCourseResult>
    catalogChapter(courseId: string, chapterId: string): Promise<RemoteCatalogChapterResult>
    catalogSection(courseId: string, sectionId: string): Promise<RemoteCatalogSectionResult>
    sectionPlayback(
      sectionId: string,
      assetId: string,
      fromSec: number,
      toSec: number,
    ): Promise<RemoteSectionPlaybackResult>
    courseQuotes(courseId: string, codes: string[]): Promise<RemoteCourseQuotesResult>
    knowledgePoint(knowledgePointId: string): Promise<RemoteKnowledgePointResult>
    reportProgress(knowledgePointId: string, watchedSec: number, completed: boolean): Promise<RemoteProgressResult>
    setLearnerContext(sessionId: string, update: LearnerContextUpdate): Promise<RemoteLearnerContextResult>
    transcribeVoice(audioBase64: string, durationMs: number): Promise<RemoteVoiceTranscriptResult>
    signOut(): Promise<RemoteSignOutResult>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService
    sidebarRightTabs: SidebarRightTabsService
    sidebarRight: SidebarRightService
    remote: ClientRemoteService
  }
}
