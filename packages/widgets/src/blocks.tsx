import { useEffect, useState } from 'react'
import { ClipCard } from './clip.js'
import type { ArticleHost } from './types.js'

/** 七容器块渲染器：编辑部式版式——衬线标题、卡片化、颜色只留给数据。 */

interface BlockProps {
  attrs: Record<string, string>
  bodyLines: string[]
  host: ArticleHost
}
export function DslBlockView({ directive, attrs, bodyLines, host }: BlockProps & { directive: string }): JSX.Element | null {
  switch (directive) {
    case 'board': return <BoardBlock {...{ attrs, bodyLines }} />
    case 'bignum': return <BignumBlock {...{ bodyLines }} />
    case 'cmp': return <CmpBlock {...{ attrs, bodyLines }} />
    case 'timeline': return <TimelineBlock {...{ bodyLines }} />
    case 'warn': return <WarnBlock {...{ attrs, bodyLines }} />
    case 'figure': return <FigureBlock {...{ attrs, host }} />
    case 'clip': return <ClipBlock {...{ attrs, host }} />
    default: return null
  }
}

function UnitBadge({ unitId }: { unitId: string }) {
  return <span className="wg-unit-badge" title={`语料 ${unitId}`}>语料</span>
}

function BoardBlock({ attrs, bodyLines }: { attrs: Record<string, string>; bodyLines: string[] }) {
  return (
    <section className="wg-board">
      <header className="wg-block-head"><UnitBadge unitId={attrs.unitId ?? ''} /></header>
      <p className="wg-board-text">{bodyLines.join('\n').trim()}</p>
    </section>
  )
}

interface BignumItem { label: string; value: string; note?: string }

function BignumBlock({ bodyLines }: { bodyLines: string[] }) {
  const items = parseJson<{ items: BignumItem[] }>(bodyLines)?.items
  if (items === undefined) return <ParseError />
  return (
    <section className="wg-bignum">
      {items.map((item: BignumItem) => (
        <div className="wg-bignum-item" key={item.label}>
          <span className="wg-bignum-label">{item.label}</span>
          <span className="wg-bignum-value">{item.value}</span>
          {item.note !== undefined ? <span className="wg-bignum-note">{item.note}</span> : null}
        </div>
      ))}
    </section>
  )
}

interface CmpSide { head: string; items: string[] }
interface CmpBody { title?: string; left: CmpSide; right: CmpSide }

function CmpBlock({ attrs, bodyLines }: { attrs: Record<string, string>; bodyLines: string[] }) {
  const body = parseJson<CmpBody>(bodyLines)
  if (body === undefined) return <ParseError />
  const mode = attrs.mode === 'table' ? 'table' : 'card'
  return (
    <section className={`wg-cmp wg-cmp-${mode}`}>
      {body.title !== undefined ? <h4 className="wg-cmp-title">{body.title}</h4> : null}
      {mode === 'card' ? (
        <div className="wg-cmp-cols">
          <CmpCardSide side={body.left} />
          <CmpCardSide side={body.right} />
        </div>
      ) : (
        <table className="wg-cmp-table">
          <thead><tr><th>{body.left.head}</th><th>{body.right.head}</th></tr></thead>
          <tbody>
            {Array.from({ length: Math.max(body.left.items.length, body.right.items.length) }, (_, i) => (
              <tr key={i}>
                <td>{body.left.items[i] ?? ''}</td>
                <td>{body.right.items[i] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CmpCardSide({ side }: { side: CmpSide }) {
  return (
    <div className="wg-cmp-side">
      <h5 className="wg-cmp-head">{side.head}</h5>
      <ul className="wg-cmp-items">
        {side.items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  )
}

interface TimelineEvent { date: string; title: string; desc?: string }

function TimelineBlock({ bodyLines }: { bodyLines: string[] }) {
  const events = parseJson<{ events: TimelineEvent[] }>(bodyLines)?.events
  if (events === undefined) return <ParseError />
  return (
    <ol className="wg-timeline">
      {events.map(event => (
        <li className="wg-timeline-event" key={`${event.date}-${event.title}`}>
          <span className="wg-timeline-date">{event.date}</span>
          <span className="wg-timeline-title">{event.title}</span>
          {event.desc !== undefined ? <span className="wg-timeline-desc">{event.desc}</span> : null}
        </li>
      ))}
    </ol>
  )
}

function WarnBlock({ attrs, bodyLines }: { attrs: Record<string, string>; bodyLines: string[] }) {
  return (
    <section className="wg-warn">
      <h4 className="wg-warn-title">⚠ {attrs.title ?? ''}</h4>
      <p className="wg-warn-text">{bodyLines.join('\n').trim()}</p>
    </section>
  )
}

function FigureBlock({ attrs, host }: { attrs: Record<string, string>; host: ArticleHost }) {
  const figureId = attrs.figureId ?? ''
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    host.resolveFigureUrl(figureId)
      .then(next => {
        if (active) setUrl(next)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [figureId, host])

  return (
    <figure className="wg-figure">
      {failed ? (
        <div className="wg-figure-missing">图示 {figureId} 加载失败</div>
      ) : url === null ? (
        <div className="wg-figure-loading">图示加载中…</div>
      ) : (
        <img className="wg-figure-img" src={url} alt={attrs.caption ?? figureId} />
      )}
      <figcaption className="wg-figure-caption">
        {attrs.caption ?? figureId}
        {attrs.unitId !== undefined ? <UnitBadge unitId={attrs.unitId} /> : null}
      </figcaption>
    </figure>
  )
}

function ClipBlock({ attrs, host }: { attrs: Record<string, string>; host: ArticleHost }) {
  const assetId = attrs.assetId ?? ''
  const from = Number(attrs.from ?? 0)
  const to = Number(attrs.to ?? 0)
  if (assetId === '' || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return <ParseError />
  }
  return <ClipCard assetId={assetId} fromSec={from} toSec={to} caption={attrs.caption ?? ''} host={host} />
}

function ParseError() {
  return <div className="wg-parse-error">该组件数据格式异常，请在后台修正后重试。</div>
}

function parseJson<T>(bodyLines: string[]): T | undefined {
  try {
    return JSON.parse(bodyLines.join('\n')) as T
  } catch {
    return undefined
  }
}
