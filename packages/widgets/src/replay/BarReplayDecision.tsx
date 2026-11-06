import * as React from 'react'
import { Kline, type KlineBar, type KlineEvent } from '../kline/Kline.js'
import type {
  BarReplayAnnotationKind as AnnotationKind,
  BarReplayDecisionSpec as ReplayDecision,
  BarReplaySpec,
} from '../spec-types.js'
import { formatPosition } from './format.js'
import { selectReplayBars } from './select-bars.js'

export interface BarReplayDecisionProps {
  code: string
  bars: KlineBar[]
  spec: unknown
  onUnitClick?: (unitId: string, atMs?: number) => void
}

const KIND_LABEL: Record<AnnotationKind, string> = {
  structure: '结构',
  invalidation: '证伪',
  rhythm: '节奏',
}

const KIND_ICON: Record<AnnotationKind, string> = {
  structure: '▲',
  invalidation: '▼',
  rhythm: '●',
}

function parseSpec(raw: unknown): BarReplaySpec | null {
  if (raw === null || typeof raw !== 'object') return null
  const s = raw as Partial<BarReplaySpec>
  if (!s.code || !s.window || !Array.isArray(s.decisions)) return null
  return {
    code: s.code,
    window: s.window,
    overlays: s.overlays,
    annotations: s.annotations,
    decisions: s.decisions,
    citations: s.citations ?? [],
  }
}

function useWindowedBars(bars: KlineBar[], code: string, window: { from: string; to: string }): KlineBar[] {
  return React.useMemo(() => selectReplayBars(bars, code, window), [bars, code, window.from, window.to])
}

function decisionIndex(decisions: ReplayDecision[], bars: KlineBar[]): Map<number, ReplayDecision> {
  const map = new Map<number, ReplayDecision>()
  for (const d of decisions) {
    const idx = bars.findIndex((b) => b.tradeDate === d.atDate)
    if (idx >= 0) map.set(idx, d)
  }
  return map
}

export function BarReplayDecision({ code, bars, spec, onUnitClick }: BarReplayDecisionProps): React.ReactElement {
  const parsed = parseSpec(spec)
  const timeWindow = parsed?.window ?? { from: '', to: '' }
  const windowedBars = useWindowedBars(bars, code, timeWindow)
  const decisions = parsed?.decisions ?? []
  const annotations = parsed?.annotations ?? []
  const decisionMap = React.useMemo(() => decisionIndex(decisions, windowedBars), [decisions, windowedBars])

  const [revealed, setRevealed] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [speed, setSpeed] = React.useState<1 | 2>(1)
  const [answers, setAnswers] = React.useState<Map<string, { selected: number; correct: boolean }>>(new Map())
  const [current, setCurrent] = React.useState<ReplayDecision | null>(null)
  const [completed, setCompleted] = React.useState(false)
  const [showSummary, setShowSummary] = React.useState(false)
  const [filterKinds, setFilterKinds] = React.useState<Set<AnnotationKind>>(
    () => new Set(['structure', 'invalidation', 'rhythm']),
  )

  const total = windowedBars.length
  const intervalMs = 800 / speed

  React.useEffect(() => {
    if (!playing || current !== null || total === 0) return undefined
    if (revealed >= total) {
      setCompleted(true)
      setShowSummary(true)
      setPlaying(false)
      return undefined
    }
    const id = window.setInterval(() => {
      setRevealed((prev) => {
        const next = Math.min(total, prev + 1)
        const bar = windowedBars[next - 1]
        if (bar && decisionMap.has(next - 1)) {
          const d = decisionMap.get(next - 1)
          if (d && !answers.has(d.atDate)) {
            window.setTimeout(() => setCurrent(d), 0)
            setPlaying(false)
          }
        }
        if (next >= total) {
          window.setTimeout(() => {
            setCompleted(true)
            setShowSummary(true)
            setPlaying(false)
          }, 0)
        }
        return next
      })
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [playing, current, revealed, total, intervalMs, decisionMap, answers, windowedBars])

  const events = React.useMemo(
    () =>
      annotations
        .filter((a) => filterKinds.has(a.kind))
        .map(
          (a): KlineEvent => ({
            date: a.d,
            label: `${KIND_ICON[a.kind]} ${KIND_LABEL[a.kind]}：${a.label}`,
            unitId: a.unitId,
          }),
        ),
    [annotations, filterKinds],
  )

  const handleStep = (): void => {
    if (current !== null || revealed >= total) return
    const next = revealed + 1
    setRevealed(next)
    const d = decisionMap.get(next - 1)
    if (d && !answers.has(d.atDate)) {
      setCurrent(d)
      setPlaying(false)
    }
    if (next >= total) {
      setCompleted(true)
      setShowSummary(true)
      setPlaying(false)
    }
  }

  const handleReset = (): void => {
    setRevealed(0)
    setPlaying(false)
    setAnswers(new Map())
    setCurrent(null)
    setCompleted(false)
    setShowSummary(false)
  }

  const handleAnswer = (d: ReplayDecision, optionIndex: number): void => {
    if (answers.has(d.atDate)) return
    const correct = optionIndex === d.correct
    setAnswers((prev) => {
      const next = new Map(prev)
      next.set(d.atDate, { selected: optionIndex, correct })
      return next
    })
    window.setTimeout(() => {
      setCurrent(null)
      if (revealed >= total) {
        setCompleted(true)
        setShowSummary(true)
      } else {
        setPlaying(true)
      }
    }, 1200)
  }

  const handleJumpToDecision = (idx: number): void => {
    const target = Math.min(total, idx + 1)
    setRevealed(target)
    const d = decisionMap.get(idx)
    if (d && !answers.has(d.atDate)) {
      setCurrent(d)
      setPlaying(false)
    }
  }

  const handleUnitClick = (unitId: string, atMs?: number): void => {
    if (onUnitClick) {
      onUnitClick(unitId, atMs)
      return
    }
    document.dispatchEvent(
      new CustomEvent('trend-widgets:unit-anchor', {
        bubbles: true,
        detail: { unitId, atMs },
      }),
    )
  }

  const correctCount = Array.from(answers.values()).filter((a) => a.correct).length
  const progress = total === 0 ? 0 : revealed / total

  if (parsed === null) {
    return (
      <div className="wg-replay wg-replay-error">
        bar-replay-decision 课件规格无法解析
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="wg-replay wg-replay-empty">
        案例窗口内无行情数据（{code}）
      </div>
    )
  }

  return (
    <div className="wg-replay">
      <header className="wg-replay-head">
        <span className="wg-replay-title">逐根回放：{code}</span>
        <span className="wg-replay-progress-text">{Math.round(progress * 100)}%</span>
      </header>

      <div className="wg-replay-chart-wrap">
        <Kline
          bars={windowedBars}
          events={events}
          mode="replay"
          revealCount={revealed}
          height={280}
          overlays={parsed.overlays}
        />
        {current && (
          <div className="wg-replay-decision-card">
            <div className="wg-replay-decision-question">{current.question}</div>
            <div className="wg-replay-decision-options">
              {current.options.map((opt, i) => {
                const answered = answers.get(current.atDate)
                const locked = answered !== undefined
                const isSelected = answered?.selected === i
                const isCorrect = i === current.correct
                let stateClass = ''
                if (locked && isCorrect) stateClass = 'wg-replay-option-correct'
                else if (locked && isSelected) stateClass = 'wg-replay-option-wrong'
                return (
                  <button
                    key={i}
                    type="button"
                    className={`wg-replay-option ${stateClass}`}
                    disabled={locked}
                    onClick={() => handleAnswer(current, i)}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {answers.get(current.atDate) && (
              <div className="wg-replay-reveal">
                <p className="wg-replay-reveal-text">{current.revealText}</p>
                <button
                  type="button"
                  className="wg-replay-unit-link"
                  onClick={() => handleUnitClick(current.unitId, current.atMs)}
                >
                  老师原话 · {formatPosition(current.atMs)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="wg-replay-controls">
        <button
          type="button"
          className="wg-replay-btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={current !== null || revealed >= total}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          className="wg-replay-btn"
          onClick={handleStep}
          disabled={current !== null || revealed >= total}
        >
          单步
        </button>
        <button
          type="button"
          className={`wg-replay-btn ${speed === 2 ? 'wg-replay-btn-active' : ''}`}
          onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
        >
          {speed}×
        </button>
        <button type="button" className="wg-replay-btn" onClick={handleReset}>重置</button>
      </div>

      <div className="wg-replay-progress">
        <div className="wg-replay-progress-track">
          <div className="wg-replay-progress-fill" style={{ width: `${progress * 100}%` }} />
          {Array.from(decisionMap.entries()).map(([idx, d]) => {
            const left = total === 0 ? 0 : ((idx + 1) / total) * 100
            const answered = answers.has(d.atDate)
            return (
              <button
                key={d.atDate}
                type="button"
                className={`wg-replay-progress-tick ${answered ? 'wg-replay-progress-tick-answered' : ''}`}
                style={{ left: `${left}%` }}
                title={d.question}
                onClick={() => handleJumpToDecision(idx)}
              />
            )
          })}
        </div>
      </div>

      <div className="wg-replay-filters">
        {(Object.keys(KIND_LABEL) as AnnotationKind[]).map((kind) => (
          <label key={kind} className="wg-replay-filter">
            <input
              type="checkbox"
              checked={filterKinds.has(kind)}
              onChange={() =>
                setFilterKinds((prev) => {
                  const next = new Set(prev)
                  if (next.has(kind)) next.delete(kind)
                  else next.add(kind)
                  return next
                })}
            />
            {KIND_ICON[kind]} {KIND_LABEL[kind]}
          </label>
        ))}
      </div>

      {showSummary && (
        <div className="wg-replay-summary">
          <div className="wg-replay-summary-title">回放小结</div>
          <div className="wg-replay-summary-score">
            判断点 {correctCount} / {decisions.length} 正确
          </div>
          <button type="button" className="wg-replay-btn" onClick={handleReset}>再跑一次</button>
        </div>
      )}
    </div>
  )
}

export * from './format.js'
