import * as React from 'react'
import { CourseView } from '@trend/widgets/course'
import type { CoursePreviewHost } from '@trend/widgets/course'
import type { PlaybackSessionTicket } from '@trend/widgets'
import type { CatalogCourse, CatalogSection } from '../shared/contracts.js'
import type {
  RemoteCatalogCourseResult,
  RemoteCatalogSectionResult,
  RemoteCourseQuotesResult,
  RemoteSectionPlaybackResult,
} from './dsh.js'
import { assembleCourseView, collectSignedFigures, type SignedFigure } from './course-assemble.js'
import { ensureCourseStyles } from './styles.js'

/** 平台下发的 tab 导航信息（与 ClassroomPanel 同形）。 */
interface TabInfoHook {
  (): {
    tab: {
      navigation: {
        address: string
        params?: Record<string, unknown>
        revision: number
      }
    }
  }
}

export interface CoursePagePanelProps {
  /** 课程 ID；平台若不给 props 时从导航参数兜底取。 */
  courseId?: string
  useTabInfo?: TabInfoHook
  catalogCourse: (courseId: string) => Promise<RemoteCatalogCourseResult>
  catalogSection: (courseId: string, sectionId: string) => Promise<RemoteCatalogSectionResult>
  courseQuotes: (courseId: string, codes: string[], period: '1d' | '1w') => Promise<RemoteCourseQuotesResult>
  sectionPlayback: (
    sectionId: string,
    assetId: string,
    fromSec: number,
    toSec: number,
  ) => Promise<RemoteSectionPlaybackResult>
}

function resolveCourseId(props: CoursePagePanelProps): string | undefined {
  if (props.courseId !== undefined && props.courseId !== '') return props.courseId
  const params = props.useTabInfo?.().tab.navigation.params ?? {}
  const courseId = params.courseId
  return typeof courseId === 'string' && courseId !== '' ? courseId : undefined
}

/**
 * 学员端课程页：整本已发布课程按原型形态（目录条 → 章 → 节）呈现。
 *
 * 数据只走学员 catalog 通道（云端只放行已发布内容）；节详情并发拉取、
 * 逐节到位即渲染，不等全部节到齐。
 */
export function CoursePagePanel(props: CoursePagePanelProps): React.ReactElement {
  const { catalogCourse, catalogSection, courseQuotes, sectionPlayback } = props
  const courseId = resolveCourseId(props)

  const [course, setCourse] = React.useState<CatalogCourse | undefined>(undefined)
  const [sections, setSections] = React.useState<CatalogSection[]>([])
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const figuresRef = React.useRef<Map<string, SignedFigure>>(new Map())

  React.useEffect(() => {
    ensureCourseStyles()
  }, [])

  React.useEffect(() => {
    if (courseId === undefined) {
      setLoading(false)
      setError('缺少课程 ID')
      return undefined
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = await catalogCourse(courseId)
        if (cancelled) return
        if (!result.ok) {
          setError(result.error.message)
          setLoading(false)
          return
        }
        const tree = result.value
        setCourse(tree)
        const summaries = tree.sections ?? []
        const loaded: CatalogSection[] = []
        const batch = await Promise.allSettled(
          summaries.map(summary => catalogSection(courseId, summary.sectionId)),
        )
        if (cancelled) return
        for (const item of batch) {
          if (item.status === 'fulfilled' && item.value.ok) loaded.push(item.value.value)
        }
        setSections(loaded)
        figuresRef.current = collectSignedFigures(loaded)
        setLoading(false)
      } catch (failure: unknown) {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : '课程读取失败')
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, catalogCourse, catalogSection])

  const host = React.useMemo<CoursePreviewHost | undefined>(() => {
    if (courseId === undefined) return undefined
    const figures = figuresRef.current
    return {
      figures,
      resolveFigureUrl: async (figureId: string): Promise<string> => {
        const url = figures.get(figureId)?.url
        if (url === undefined || url === null) throw new Error('图示暂不可用')
        return url
      },
      createPlaybackSession: async (
        assetId: string,
        fromSec?: number,
        toSec?: number,
      ): Promise<PlaybackSessionTicket> => {
        throw new Error('播放会话缺少节上下文')
      },
      createPlaybackSessionForSection: async (
        sectionId: string,
        assetId: string,
        fromSec?: number,
        toSec?: number,
      ): Promise<PlaybackSessionTicket> => {
        if (fromSec === undefined || toSec === undefined) throw new Error('片段缺少时间窗')
        const result = await sectionPlayback(sectionId, assetId, fromSec, toSec)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      loadQuotes: async (codes: string[], period: '1d' | '1w') => {
        const result = await courseQuotes(courseId, codes, period)
        if (!result.ok) throw new Error(result.error.message)
        return { pending: result.value.pending, quotes: result.value.quotes }
      },
    }
  }, [courseId, courseQuotes, sectionPlayback])

  const children: React.ReactNode[] = []

  if (loading) {
    children.push(React.createElement('p', { key: 'loading', style: { color: '#888' } }, '课程加载中…'))
  }
  if (error !== undefined) {
    children.push(React.createElement('p', { key: 'error', style: { color: '#c0392b' } }, error))
  }

  if (course !== undefined && host !== undefined) {
    if (course.sections === undefined || course.sections.length === 0) {
      children.push(React.createElement(
        'p',
        { key: 'empty', style: { color: '#666' } },
        '本课程暂无可读的已发布节。',
      ))
    } else {
      const view = assembleCourseView(course, sections)
      children.push(React.createElement(CourseView, { key: 'course', view, host }))
    }
  }

  return React.createElement(
    'div',
    { className: 'tc-course-page' },
    ...children,
  )
}
