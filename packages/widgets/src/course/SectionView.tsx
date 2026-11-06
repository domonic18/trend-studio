import { useEffect, useMemo, useRef, useState } from 'react'
import { ArticleRenderer } from '../article.js'
import { Kline } from '../kline/Kline.js'
import { MaPicker } from '../kline/MaPicker.js'
import { DEFAULT_OVERLAYS } from '../kline/kline-chart.js'
import {
  PERIOD_LABEL,
  filterPeriodWindow,
  findPeriodIndex,
  periodBarsOf,
  type KlinePeriod,
  type PeriodBar,
} from '../kline/period.js'
import { LearnerWidgetPlayer } from '../learner/WidgetPlayer.js'
import type { CaseStockView, CoursePreviewHost, CourseQuote, KlineBar, SectionView as SectionViewModel } from './types.js'
import { exchangeLabel, toBars } from './types.js'

/** 事件锚点落到周期 bar 上：周线时日内日期归到该周收盘 bar。 */
function periodEventDate(bars: PeriodBar[], tradeDate: string): string {
  const index = findPeriodIndex(bars, tradeDate)
  return bars[index]?.tradeDate ?? tradeDate
}

/** 课件规格里声明的周期：只有逐根回放课件带 period，取不出时按日线。 */
function widgetPeriod(spec: unknown): KlinePeriod {
  if (spec === null || typeof spec !== 'object') return '1d'
  const value = (spec as { period?: unknown }).period
  return value === '1w' ? '1w' : '1d'
}

/** 课件标的（逐根回放用），取不出时返回空串。 */
function widgetCode(spec: unknown): string {
  if (spec === null || typeof spec !== 'object') return ''
  const value = (spec as { code?: unknown }).code
  return typeof value === 'string' ? value : ''
}

export function SectionView({ section, host }: { section: SectionViewModel; host: CoursePreviewHost }) {
  const { section: meta, article, widgets, figures, caseStocks } = section
  const draftBadge = meta.status !== 'published' || article?.status !== 'published'
  const [quotesState, setQuotesState] = useState<{ pending: boolean; quotes: CourseQuote[] }>({ pending: false, quotes: [] })

  // 一节课可能同时讲日线与周线：按周期分别取行情，再合并成一份 bar 列表。
  // 每个周期只取该周期真正需要的代号（单次请求上限 10 只，不能把所有代号都塞进每次请求）。
  const requestsByPeriod = useMemo(() => {
    const map = new Map<KlinePeriod, Set<string>>()
    const add = (period: KlinePeriod, code: string): void => {
      if (code === '') return
      const set = map.get(period) ?? new Set<string>()
      set.add(code)
      map.set(period, set)
    }
    for (const stock of caseStocks) add(stock.period ?? '1d', stock.code)
    for (const w of widgets) {
      if (w.type !== 'bar-replay-decision') continue
      add(widgetPeriod(w.spec), widgetCode(w.spec))
    }
    return [...map.entries()].map(([period, set]) => ({ period, codes: [...set] }))
  }, [caseStocks, widgets])

  const requestKey = requestsByPeriod
    .map(({ period, codes: wanted }) => `${period}:${wanted.join('|')}`)
    .join(';')
  // 父组件可能每次渲染重建 caseStocks/widgets，故 effect 以字符串键为准，数组走 ref 取最新。
  const requestsRef = useRef(requestsByPeriod)
  requestsRef.current = requestsByPeriod

  useEffect(() => {
    if (requestKey === '') {
      setQuotesState({ pending: false, quotes: [] })
      return
    }
    let cancelled = false
    Promise.all(requestsRef.current.map(({ period, codes: wanted }) => host.loadQuotes(wanted, period)))
      .then((results) => {
        if (cancelled) return
        const quotes = results.flatMap(result => result.quotes)
        setQuotesState({ pending: results.some(result => result.pending), quotes })
      })
      .catch(() => {
        if (cancelled) return
        setQuotesState({ pending: false, quotes: [] })
      })
    return () => {
      cancelled = true
    }
  }, [host, requestKey])

  const bars = useMemo(() => toBars(quotesState.quotes), [quotesState.quotes])
  const articleHost = useMemo(
    () => ({
      ...host,
      widgets,
      bars,
      createPlaybackSession:
        host.createPlaybackSessionForSection === undefined
          ? host.createPlaybackSession
          : (assetId: string, fromSec?: number, toSec?: number) =>
              host.createPlaybackSessionForSection!(meta.sectionId, assetId, fromSec, toSec),
    }),
    [host, widgets, bars, meta.sectionId],
  )

  return (
    <article
      id={meta.sectionId}
      data-section-id={meta.sectionId}
      className="wg-course-section"
    >
      <header className="wg-section-hero">
        {meta.conceptNames !== undefined && meta.conceptNames.length > 0 ? (
          <div className="wg-section-chip">{meta.conceptNames[0]}</div>
        ) : meta.conceptRefs.length > 0 ? (
          <div className="wg-section-chip">{meta.conceptRefs[0]}</div>
        ) : null}
        <h3 className="wg-section-title">{meta.title}</h3>
        {meta.summary !== undefined && meta.summary !== '' ? (
          <p className="wg-section-lead">{meta.summary}</p>
        ) : null}
        <footer className="wg-section-foot">
          {draftBadge ? <span className="wg-section-draft">草稿</span> : null}
          <span className="wg-section-stat"><b>{widgets.length}</b>课件</span>
          <span className="wg-section-stat"><b>{figures.length}</b>图示</span>
          <span className="wg-section-stat"><b>{caseStocks.length}</b>案例股</span>
        </footer>
      </header>

      {article !== null ? (
        <div className="wg-section-article">
          <ArticleRenderer markdown={article.markdown} host={articleHost} />
        </div>
      ) : null}

      {caseStocks.length > 0 ? (
        <CaseStockPanel stocks={caseStocks} bars={bars} pending={quotesState.pending} />
      ) : null}

      {widgets.length > 0 ? (
        <div className="wg-section-widgets">
          {widgets.map((w) => (
            <div key={w.widgetId} className="wg-widget-card">
              <header className="wg-widget-head">
                <span className="wg-widget-type">{w.type}</span>
                <span className={`wg-widget-status wg-widget-status-${w.status}`}>{w.status}</span>
              </header>
              <LearnerWidgetPlayer
                widget={{
                  widgetId: w.widgetId,
                  type: w.type,
                  spec: w.spec,
                  assertions: w.assertions,
                }}
                bars={bars}
              />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function CaseStockPanel({
  stocks,
  bars,
  pending,
}: {
  stocks: CaseStockView[]
  bars: KlineBar[]
  pending: boolean
}) {
  const [selected, setSelected] = useState<string>(stocks[0]?.code ?? '')
  const active = stocks.find((s) => s.code === selected) ?? stocks[0]
  const activeBars = useMemo(() => bars.filter((b) => b.code === active?.code), [bars, active?.code])
  return (
    <aside className="wg-case-panel">
      <header className="wg-case-panel-head">
        <span>案例股</span>
        <span className="wg-case-panel-hint">滚轮缩放 · 拖动平移 · 双击复位</span>
      </header>
      <div className="wg-case-tabs">
        {stocks.map((s) => (
          <button
            key={s.code}
            className={`wg-case-tab${s.code === selected ? ' active' : ''}`}
            onClick={() => setSelected(s.code)}
          >
            {s.name}
            <span className="wg-case-code">{s.code}</span>
          </button>
        ))}
      </div>
      {active !== undefined ? <CaseStockDetail stock={active} bars={activeBars} pending={pending} /> : null}
    </aside>
  )
}

function CaseStockDetail({
  stock,
  bars,
  pending,
}: {
  stock: CaseStockView
  bars: KlineBar[]
  pending: boolean
}) {
  const period: KlinePeriod = stock.period ?? '1d'
  const [overlays, setOverlays] = useState<string[]>(DEFAULT_OVERLAYS)
  const [focusDate, setFocusDate] = useState<string | undefined>(undefined)
  const allBars = useMemo(() => periodBarsOf(bars, period), [bars, period])
  const viewBars = useMemo(() => {
    return period === '1w'
      ? filterPeriodWindow(allBars, { from: stock.windowStart, to: stock.windowEnd })
      : allBars.filter(bar => bar.tradeDate >= stock.windowStart && bar.tradeDate <= stock.windowEnd)
  }, [allBars, period, stock.windowStart, stock.windowEnd])
  const events = useMemo(
    () =>
      stock.events.map(
        (e): import('../kline/kline-chart.js').KlineEvent => ({
          date: periodEventDate(allBars, e.date),
          label: e.label,
          unitId: e.unitId,
        }),
      ),
    [stock.events, allBars],
  )
  return (
    <div className="wg-case-detail">
      <div className="wg-case-meta">
        <span className="wg-case-name">{stock.name}</span>
        <span className="wg-case-exchange">{exchangeLabel(stock.exchange)}</span>
        <span className="wg-case-period">{PERIOD_LABEL[period]}</span>
        <span className="wg-case-window">
          {stock.windowStart} ~ {stock.windowEnd}
        </span>
        <MaPicker value={overlays} onChange={setOverlays} />
      </div>
      {pending && bars.length === 0 ? (
        <div className="wg-case-pending">等待行情同步…</div>
      ) : null}
      <Kline
        bars={allBars}
        maBars={allBars}
        events={events}
        windowStart={viewBars[0]?.tradeDate ?? stock.windowStart}
        windowEnd={viewBars[viewBars.length - 1]?.tradeDate ?? stock.windowEnd}
        overlays={overlays}
        focusDate={focusDate}
        height={300}
      />
      {stock.events.length > 0 ? (
        <ul className="wg-case-events">
          {stock.events.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                className={`wg-case-event${focusDate === e.date ? ' active' : ''}`}
                onClick={() => setFocusDate(e.date)}
                title="定位到该交易日"
              >
                <span className="wg-case-event-date">{e.date}</span>
                <span className="wg-case-event-label">{e.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
