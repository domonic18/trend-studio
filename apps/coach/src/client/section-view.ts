import * as React from 'react'
import { ArticleRenderer, LearnerWidgetPlayer } from '@trend/widgets'
import { barsByCode, exchangeLabel, toBars } from '@trend/widgets/course'
import { periodBarsOf } from '@trend/widgets/kline'
import type { CatalogCaseStock, CatalogSection, QuoteItem } from '../shared/contracts.js'
import type {
  RemoteCatalogSectionResult,
  RemoteCourseQuotesResult,
  RemoteSectionPlaybackResult,
} from './dsh.js'
import { createArticleHost } from './article-host.js'
import { KlineView } from './kline-view.js'
import { ensureWidgetsStyles } from './styles.js'

export interface SectionViewProps {
  courseId: string
  sectionId: string
  catalogSection: (courseId: string, sectionId: string) => Promise<RemoteCatalogSectionResult>
  sectionPlayback: (
    sectionId: string,
    assetId: string,
    fromSec: number,
    toSec: number,
  ) => Promise<RemoteSectionPlaybackResult>
  courseQuotes: (courseId: string, codes: string[], period: '1d' | '1w') => Promise<RemoteCourseQuotesResult>
}

function formatDate(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** v3 节视图：正文 + 课件 + 图示 + 案例股行情。 */
export function SectionView({
  courseId,
  sectionId,
  catalogSection,
  sectionPlayback,
  courseQuotes,
}: SectionViewProps): React.ReactElement {
  const [section, setSection] = React.useState<CatalogSection | undefined>(undefined)
  const [quotes, setQuotes] = React.useState<QuoteItem[]>([])
  const [pending, setPending] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [unitNotice, setUnitNotice] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    ensureWidgetsStyles()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = await catalogSection(courseId, sectionId)
        if (cancelled) return
        if (result.ok) {
          setSection(result.value)
          setError(undefined)
        } else {
          setError(result.error.message)
        }
      } catch (failure: unknown) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '节教材读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, sectionId, catalogSection])

  /** 案例股与逐根回放课件各自声明周期，按周期分次取行情后合并。 */
  const periodRequests = React.useMemo(() => {
    const requests = new Map<'1d' | '1w', string[]>()
    const add = (period: '1d' | '1w', code: string): void => {
      const list = requests.get(period) ?? []
      if (!list.includes(code)) list.push(code)
      requests.set(period, list)
    }
    for (const stock of section?.caseStocks ?? []) add(stock.period ?? '1d', stock.code)
    for (const widget of section?.widgets ?? []) {
      if (widget.type !== 'bar-replay-decision') continue
      const spec = widget.spec as { code?: unknown; period?: unknown }
      if (typeof spec.code !== 'string' || spec.code === '') continue
      add(spec.period === '1w' ? '1w' : '1d', spec.code)
    }
    return [...requests.entries()]
  }, [section])

  const periodRequestsKey = periodRequests
    .map(([period, list]) => `${period}:${list.join(',')}`)
    .join('|')

  React.useEffect(() => {
    if (periodRequests.length === 0) {
      setQuotes([])
      setPending(false)
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const results = await Promise.all(
          periodRequests.map(async ([period, list]) => await courseQuotes(courseId, list, period)),
        )
        if (cancelled) return
        const failed = results.find(result => !result.ok)
        if (failed !== undefined && !failed.ok) {
          setError(failed.error.message)
          return
        }
        const merged: QuoteItem[] = []
        for (const result of results) {
          if (result.ok) merged.push(...result.value.quotes)
        }
        setQuotes(merged)
        setPending(results.some(result => result.ok && result.value.pending))
      } catch (failure: unknown) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '行情读取失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, periodRequestsKey, courseQuotes])

  const barsMap = React.useMemo(() => barsByCode(quotes), [quotes])
  const allBars = React.useMemo(() => toBars(quotes), [quotes])

  const host = React.useMemo(
    () => (section === undefined
      ? undefined
      : createArticleHost(section, { sectionPlayback }, { widgets: section.widgets, bars: allBars })),
    [section, sectionPlayback, allBars],
  )

  React.useEffect(() => {
    const onUnitAnchor = (event: Event): void => {
      const detail = (event as CustomEvent<{ unitId?: string }>).detail
      const unitId = detail?.unitId
      setUnitNotice(unitId === undefined ? undefined : `证据 ${unitId}`)
    }
    const onStockAnchor = (event: Event): void => {
      const detail = (event as CustomEvent<{ code?: string }>).detail
      const code = detail?.code
      if (code === undefined) return
      const target = document.getElementById(`tc-case-${code}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    document.addEventListener('trend-coach:unit-anchor', onUnitAnchor)
    document.addEventListener('trend-coach:stock-anchor', onStockAnchor)
    return () => {
      document.removeEventListener('trend-coach:unit-anchor', onUnitAnchor)
      document.removeEventListener('trend-coach:stock-anchor', onStockAnchor)
    }
  }, [])

  const children: React.ReactNode[] = []

  if (loading) {
    children.push(React.createElement('p', { key: 'loading', style: { color: '#888' } }, '加载中…'))
  }
  if (error !== undefined) {
    children.push(React.createElement('p', { key: 'error', style: { color: '#c0392b' } }, error))
  }
  if (unitNotice !== undefined) {
    children.push(React.createElement(
      'p',
      { key: 'unit', style: { color: '#faad14', fontSize: 12, margin: '4px 0' } },
      unitNotice,
    ))
  }

  if (section !== undefined) {
    children.push(React.createElement(
      'h3',
      { key: 'title', style: { margin: '0 0 4px' } },
      section.title,
    ))
    children.push(React.createElement(
      'p',
      { key: 'meta', style: { margin: '0 0 8px', color: '#888', fontSize: 12 } },
      `第 ${section.position + 1} 节 · ${section.chapterId}`,
    ))

    if (section.article === null) {
      children.push(React.createElement(
        'p',
        { key: 'no-article', style: { color: '#666' } },
        '本节教材暂未发布。',
      ))
    } else {
      children.push(React.createElement(
        'div',
        { key: 'article', style: { border: '1px solid #eee', borderRadius: 4, padding: '8px 10px' } },
        React.createElement('p', {
          key: 'article-meta',
          style: { margin: '0 0 6px', color: '#888', fontSize: 12 },
        }, `教材 v${section.article.version} · DSL v${section.article.dslVersion} · 发布于 ${formatDate(section.article.publishedAt)}`),
        host === undefined
          ? null
          : React.createElement(ArticleRenderer, {
            key: 'article-body',
            markdown: section.article.markdown,
            host,
          }),
      ))
    }

    if (section.widgets.length > 0) {
      children.push(React.createElement(
        'div',
        { key: 'widgets' },
        React.createElement('h4', { key: 'widgets-title', style: { margin: '12px 0 4px' } }, '课件'),
        ...section.widgets.map((widget) => React.createElement(LearnerWidgetPlayer, {
          key: widget.widgetId,
          widget: {
            widgetId: widget.widgetId,
            type: widget.type,
            spec: widget.spec,
            assertions: widget.assertions,
          },
          bars: allBars,
        })),
      ))
    }

    if (section.figures.length > 0) {
      children.push(React.createElement(
        'div',
        { key: 'figures' },
        React.createElement('h4', { key: 'figures-title', style: { margin: '12px 0 4px' } }, '图示'),
        ...section.figures.map((figure) => React.createElement(
          'figure',
          { key: figure.figureId, style: { margin: '8px 0' } },
          figure.url === null
            ? React.createElement('div', { style: { color: '#888', fontSize: 12 } }, `图示暂不可用：${figure.caption}`)
            : React.createElement('img', {
              src: figure.url,
              alt: figure.caption,
              loading: 'lazy',
              decoding: 'async',
              referrerPolicy: 'no-referrer',
              style: { maxWidth: '100%', height: 'auto', borderRadius: 4 },
            }),
          React.createElement('figcaption', {
            style: { color: '#666', fontSize: 12, marginTop: 4 },
          }, figure.caption),
        )),
      ))
    }

    if (section.caseStocks.length > 0) {
      children.push(React.createElement(
        'div',
        { key: 'case-stocks' },
        React.createElement('h4', { key: 'case-title', style: { margin: '12px 0 4px' } }, '案例股'),
        pending
          ? React.createElement('p', { key: 'pending', style: { color: '#888', fontSize: 12 } }, '等待行情同步…')
          : null,
        ...section.caseStocks.map((stock) => {
          const own = barsMap.get(stock.code) ?? []
          const bars = periodBarsOf(own, stock.period ?? '1d')
          return React.createElement(
            'section',
            {
              key: stock.code,
              id: `tc-case-${stock.code}`,
              style: {
                border: '1px solid #eee',
                borderRadius: 4,
                padding: '6px 10px',
                marginTop: 8,
              },
            },
            React.createElement('div', { key: 'name' }, `${stock.name}（${stock.code}）`),
            React.createElement('div', {
              key: 'meta',
              style: { color: '#888', fontSize: 12, marginBottom: 4 },
            }, `${exchangeLabel(stock.exchange)} · ${stock.windowStart} ~ ${stock.windowEnd}`),
            bars.length === 0
              ? React.createElement('p', {
                key: 'no-bars',
                style: { color: '#888', fontSize: 12, margin: 0 },
              }, pending ? '等待行情同步…' : '暂无行情数据')
              : React.createElement(KlineView, { key: 'kline', bars }),
          )
        }),
      ))
    }
  }

  return React.createElement(
    'div',
    { className: 'tc-section', style: { padding: 12, fontSize: 13, lineHeight: 1.6 } },
    ...children,
    React.createElement('p', {
      key: 'disclaimer',
      style: { margin: '12px 0 0', color: '#888', fontSize: 12 },
    }, '课程内容仅供学习，不构成投资建议。'),
  )
}
