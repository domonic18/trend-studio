/**
 * 学员端课件播放器：antd-free，按 spec + assertions 渲染可交互课件。
 *
 * 判定逻辑复用 engine（与云端评分、管理台预览同源），本文件只负责呈现。
 */

import { useEffect, useMemo, useState } from 'react'
import { BarReplayDecision } from '../replay/BarReplayDecision.js'
import type { KlineBar } from '../kline/kline-chart.js'
import {
  classifyShape,
  computeFormula,
  countTrendlineTouches,
  closesHoldAbove,
  generateCandles,
  isFormulaId,
  previewProve,
  trendlineAt,
  type Candle,
} from '../engine.js'
import type { WidgetAssertions, WidgetSpec, WidgetType } from '../spec-types.js'

export interface LearnerWidget {
  widgetId: string
  type: string
  spec: unknown
  assertions: unknown
}

interface LearnerWidgetPlayerProps {
  widget: LearnerWidget
  bars?: KlineBar[]
}

const PANEL: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: 12,
  margin: '12px 0',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.88)',
  font: '13px/1.6 system-ui, sans-serif',
}

const MUTED: React.CSSProperties = { color: 'rgba(255,255,255,0.55)' }
const UP = '#ef4d4d'
const DOWN = '#21ba72'

function Button({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 4,
        background: 'rgba(255,255,255,0.06)',
        color: 'inherit',
        padding: '4px 10px',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'bad' | 'info' }) {
  const color = tone === 'ok' ? UP : tone === 'bad' ? DOWN : 'rgba(255,255,255,0.75)'
  return (
    <span style={{ border: `1px solid ${color}`, color, borderRadius: 3, padding: '0 6px', fontSize: 12, marginRight: 6 }}>
      {children}
    </span>
  )
}

export function LearnerWidgetPlayer({ widget, bars }: LearnerWidgetPlayerProps) {
  const spec = (widget.spec ?? null) as WidgetSpec | null
  const assertions = (widget.assertions ?? null) as WidgetAssertions | null
  const type = widget.type as WidgetType
  if (spec === null) {
    return <div style={PANEL}>课件 spec 缺失（{widget.widgetId}）</div>
  }
  const Renderer = RENDERERS[type]
  if (Renderer === undefined) {
    return <div style={PANEL}>未知课件类型：{widget.type}</div>
  }
  return (
    <div style={PANEL}>
      <ProofBadge type={type} spec={spec} assertions={assertions} />
      <Renderer spec={spec} assertions={assertions} bars={bars} />
    </div>
  )
}

function ProofBadge({
  type,
  spec,
  assertions,
}: {
  type: WidgetType
  spec: WidgetSpec
  assertions: WidgetAssertions | null
}) {
  const proof = useMemo(() => (assertions === null ? null : previewProve(type, spec, assertions)), [type, spec, assertions])
  if (proof === null) return <div style={{ ...MUTED, marginBottom: 6 }}>无断言</div>
  if (proof.failed.length === 0) return <div style={{ marginBottom: 6 }}><Tag tone="ok">全部断言通过</Tag></div>
  return <div style={{ marginBottom: 6 }}><Tag tone="bad">失败：{proof.failed.join(', ')}</Tag></div>
}

const RENDERERS: Record<WidgetType, (props: { spec: WidgetSpec; assertions: WidgetAssertions | null; bars?: KlineBar[] }) => React.ReactElement> = {
  'kline-annotator': KlineAnnotator,
  'pattern-quiz': PatternQuiz,
  'step-reveal': StepReveal,
  'calc-trainer': CalcTrainer,
  'mcq-quiz': McqQuiz,
  flashcards: Flashcards,
  checklist: Checklist,
  'timeline-explorer': TimelineExplorer,
  'bar-replay-decision': BarReplayDecisionWrapper,
}

const CHART_W = 480
const CHART_H = 240
const PAD = 16

function priceScale(candles: Candle[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const candle of candles) {
    min = Math.min(min, candle.low)
    max = Math.max(max, candle.high)
  }
  const span = max - min || 1
  return { min: min - span * 0.08, max: max + span * 0.08 }
}

function KLineChart({
  candles,
  trendline,
  markers,
  onPick,
  picks,
}: {
  candles: Candle[]
  trendline?: { startIdx: number; endIdx: number }
  markers?: { idx: number; price: number }[]
  onPick?: (index: number) => void
  picks?: number[]
}) {
  const { min, max } = priceScale(candles)
  const count = candles.length
  const colW = (CHART_W - PAD * 2) / count
  const y = (price: number): number => PAD + ((max - price) / (max - min)) * (CHART_H - PAD * 2)
  const xCenter = (idx: number): number => PAD + colW * (idx + 0.5)

  const handleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (onPick === undefined) return
    const rect = event.currentTarget.getBoundingClientRect()
    const idx = Math.max(0, Math.min(count - 1, Math.floor((event.clientX - rect.left - PAD) / colW)))
    onPick(idx)
  }

  let line: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (trendline !== undefined) {
    const { priceAt } = trendlineAt(candles, trendline)
    line = {
      x1: xCenter(trendline.startIdx),
      y1: y(priceAt(trendline.startIdx)),
      x2: xCenter(trendline.endIdx),
      y2: y(priceAt(trendline.endIdx)),
    }
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      style={{ background: '#0f1117', borderRadius: 6, cursor: onPick === undefined ? 'default' : 'crosshair' }}
      onClick={handleClick}
    >
      {candles.map((candle, idx) => {
        const color = candle.close >= candle.open ? UP : DOWN
        const xBody = xCenter(idx)
        const bodyTop = y(Math.max(candle.open, candle.close))
        const bodyBottom = y(Math.min(candle.open, candle.close))
        const picked = picks?.includes(idx) === true
        return (
          <g key={idx}>
            <line x1={xBody} x2={xBody} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth={1} />
            <rect x={xBody - colW * 0.32} y={bodyTop} width={colW * 0.64} height={Math.max(1, bodyBottom - bodyTop)} fill={color} />
            {picked ? <circle cx={xBody} cy={y(candle.low)} r={4} fill="#ffffff" stroke="#faad14" strokeWidth={2} /> : null}
          </g>
        )
      })}
      {line !== null ? (
        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#faad14" strokeWidth={2} strokeDasharray="6 3" />
      ) : null}
      {markers?.map((marker, i) => (
        <circle key={i} cx={xCenter(marker.idx)} cy={y(marker.price)} r={3} fill="#1890ff" />
      ))}
    </svg>
  )
}

function KlineAnnotator({ spec, assertions }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const candles = useMemo(
    () => (spec.data === undefined ? [] : generateCandles(spec.data.generator, spec.data.seed, spec.data.bars)),
    [spec.data],
  )
  const [picks, setPicks] = useState<number[]>([])
  const [showAnswer, setShowAnswer] = useState(false)

  const result = useMemo(() => {
    if (picks.length < 2) return null
    const startIdx = picks[0]
    const endIdx = picks[1]
    if (startIdx === undefined || endIdx === undefined) return null
    const line = { startIdx, endIdx }
    const touches = countTrendlineTouches(candles, line)
    const { angleDeg } = trendlineAt(candles, line)
    const above = closesHoldAbove(candles, line)
    const minTouches = assertions?.trendlineTouches?.min ?? 0
    const [lo, hi] = assertions?.slopeRange ?? [-90, 90]
    return { touches, angleDeg, above, pass: touches >= minTouches && angleDeg >= lo && angleDeg <= hi && above }
  }, [picks, candles, assertions])

  return (
    <div>
      <div style={MUTED}>{spec.task}</div>
      <KLineChart
        candles={candles}
        trendline={showAnswer ? spec.solution?.trendline : undefined}
        onPick={idx => setPicks(prev => (prev.length >= 2 ? [idx] : [...prev, idx]))}
        picks={picks}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{picks.length === 2 ? `已选 bar ${picks[0]} → bar ${picks[1]}` : '点击图上两点定趋势线'}</span>
        <Button onClick={() => setPicks([])}>清除</Button>
        <Button onClick={() => setShowAnswer(v => !v)}>{showAnswer ? '隐藏参考答案' : '显示参考答案'}</Button>
      </div>
      {result !== null ? (
        <div style={{ marginTop: 8 }}>
          触及 {result.touches} 根 · 角度 {result.angleDeg.toFixed(1)}° · 收盘均在线之上：{result.above ? '是' : '否'} ·{' '}
          <Tag tone={result.pass ? 'ok' : 'bad'}>{result.pass ? '判定通过' : '判定未达'}</Tag>
        </div>
      ) : null}
    </div>
  )
}

function PatternQuiz({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const options = spec.options ?? []
  const answerId = spec.answerId ?? ''

  const chartFor = (index: number): Candle[] => {
    const base = spec.data
    const option = options[index]
    if (base === undefined) return []
    return generateCandles(option?.generator ?? base.generator, option?.seed ?? base.seed, option?.bars ?? base.bars)
  }

  return (
    <div>
      <div>{spec.question}</div>
      {options.map((option, index) => (
        <div
          key={option.id}
          onClick={() => setPicked(option.id)}
          style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: 8, marginTop: 8, cursor: 'pointer' }}
        >
          <div style={{ marginBottom: 4 }}>
            <Tag>{option.label}</Tag>
            <Tag>{classifyShape(chartFor(index))}</Tag>
          </div>
          <KLineChart candles={chartFor(index)} />
        </div>
      ))}
      {picked !== null ? (
        <div style={{ marginTop: 8 }}>
          <Tag tone={picked === answerId ? 'ok' : 'bad'}>{picked === answerId ? '回答正确' : '回答错误'}</Tag>
          <span style={MUTED}>参考答案为「{options.find(option => option.id === answerId)?.label ?? ''}」</span>
        </div>
      ) : null}
    </div>
  )
}

function StepReveal({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const steps = spec.steps ?? []
  const [shown, setShown] = useState(0)

  return (
    <div>
      {steps.slice(0, shown + 1).map((step, index) => (
        <div key={index} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: 8, marginTop: 8 }}>
          <div>{step.title}</div>
          <div style={MUTED}>区间 bar {step.fromIdx} – {step.toIdx}</div>
          {step.markers !== undefined && step.markers.length > 0 ? (
            <KLineChart
              candles={spec.data === undefined ? [] : generateCandles(spec.data.generator, spec.data.seed, spec.data.bars)}
              markers={step.markers}
            />
          ) : null}
          <div style={{ marginTop: 8 }}>{step.conclusion}</div>
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {shown < steps.length - 1 ? <Button onClick={() => setShown(s => s + 1)}>下一步</Button> : null}
        {shown > 0 ? <Button onClick={() => setShown(0)}>重置</Button> : null}
      </div>
      {shown === steps.length - 1 && spec.finalConclusion !== undefined ? (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 8, paddingTop: 8 }}>
          <strong>总结</strong>
          <div>{spec.finalConclusion}</div>
        </div>
      ) : null}
    </div>
  )
}

const FORMULA_LABELS: Record<string, string> = {
  'position-size': '仓位手数 = 资金×风险% ÷ (价格×止损距离%)',
  'risk-reward': '盈亏比 = (目标价−入场价) ÷ (入场价−止损价)',
  'drawdown-recovery': '回本% = 回撤% ÷ (100−回撤%) × 100',
}

function CalcTrainer({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const formula = spec.formula ?? ''
  const inputs = spec.inputs ?? {}
  const examples = spec.examples ?? []
  const [values, setValues] = useState<Record<string, number>>(inputs)
  const [computed, setComputed] = useState<number | undefined>(undefined)

  const compute = (): void => {
    if (!isFormulaId(formula)) return
    setComputed(computeFormula(formula, values))
  }

  useEffect(() => {
    compute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div style={MUTED}>{FORMULA_LABELS[formula] ?? formula}</div>
      <div style={{ marginTop: 6 }}>
        {Object.keys(inputs).map(key => (
          <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <span style={{ minWidth: 96 }}>{key}</span>
            <input
              type="number"
              value={values[key] ?? 0}
              onChange={event => {
                const next = Number(event.target.value)
                setValues(prev => ({ ...prev, [key]: Number.isFinite(next) ? next : 0 }))
              }}
              style={{
                width: 120,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 4,
                color: 'inherit',
                padding: '2px 6px',
                font: 'inherit',
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={compute}>计算</Button>
        {computed !== undefined ? <span>计算结果：<strong>{computed.toFixed(3)}</strong></span> : null}
      </div>
      <div style={{ marginTop: 8 }}>示例校验</div>
      {examples.map((example, index) => {
        const got = isFormulaId(formula) ? computeFormula(formula, example.inputs) : undefined
        const match = got !== undefined && Math.abs(got - example.answer) <= (spec.tolerance ?? 1e-6) * Math.max(1, Math.abs(example.answer))
        return (
          <div key={index} style={{ marginTop: 4 }}>
            <Tag>{got !== undefined ? got.toFixed(3) : '—'}</Tag>
            <span style={MUTED}>期望 {example.answer}</span>{' '}
            <Tag tone={match ? 'ok' : 'bad'}>{match ? '一致' : '不一致'}</Tag>
          </div>
        )
      })}
    </div>
  )
}

function McqQuiz({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const options = spec.options ?? []
  const answerId = spec.answerId ?? ''

  return (
    <div>
      <div>{spec.question}</div>
      {options.map(option => (
        <div
          key={option.id}
          onClick={() => setPicked(option.id)}
          style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', marginTop: 6, cursor: 'pointer' }}
        >
          <Tag tone={picked === option.id ? (option.id === answerId ? 'ok' : 'bad') : undefined}>{option.label}</Tag>
        </div>
      ))}
      {spec.conceptRefs !== undefined && spec.conceptRefs.length > 0 ? (
        <div style={{ marginTop: 6 }}>{spec.conceptRefs.map(ref => <Tag key={ref}>{ref}</Tag>)}</div>
      ) : null}
      {picked !== null ? (
        <div style={{ marginTop: 8 }}>
          <Tag tone={picked === answerId ? 'ok' : 'bad'}>{picked === answerId ? '回答正确' : '回答错误'}</Tag>
        </div>
      ) : null}
    </div>
  )
}

function Flashcards({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const cards = spec.cards ?? []
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = cards[index]

  useEffect(() => {
    setFlipped(false)
  }, [index])

  if (card === undefined) return <div style={MUTED}>无卡片</div>

  return (
    <div>
      <div
        onClick={() => setFlipped(v => !v)}
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          padding: 16,
          minHeight: 80,
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <div>{flipped ? card.back : card.front}</div>
        {card.conceptRef !== undefined ? <Tag>{card.conceptRef}</Tag> : null}
        <div style={MUTED}>{flipped ? '背面（点击翻回）' : '正面（点击查看背面）'}</div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={() => setIndex(i => i - 1)} disabled={index === 0}>上一张</Button>
        <span>{index + 1} / {cards.length}</span>
        <Button onClick={() => setIndex(i => i + 1)} disabled={index === cards.length - 1}>下一张</Button>
      </div>
    </div>
  )
}

function Checklist({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const items = spec.items ?? []
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const toggle = (index: number): void => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div>
      <div>{spec.title}</div>
      {items.map((item, index) => (
        <div
          key={index}
          onClick={() => toggle(index)}
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, cursor: 'pointer' }}
        >
          <span>{checked.has(index) ? '✓' : '○'}</span>
          <span>{item.text}</span>
          {item.conceptRef !== undefined ? <Tag>{item.conceptRef}</Tag> : null}
        </div>
      ))}
    </div>
  )
}

function BarReplayDecisionWrapper({ spec, bars }: { spec: WidgetSpec; assertions: WidgetAssertions | null; bars?: KlineBar[] }) {
  const raw = spec as unknown as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code : ''
  // 行情 bar 用 6 位纯数字码，spec 用带交易所前缀的码；归一与筛选交给回放组件。
  return <BarReplayDecision code={code} bars={bars ?? []} spec={spec} />
}

function TimelineExplorer({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const nodes = spec.nodes ?? []
  const edges = spec.edges ?? []
  const names = nodes.map(node => node.conceptRef)
  const boxW = 120
  const boxH = 40
  const gapX = 150
  const gapY = 70
  const cols = Math.max(1, Math.ceil(Math.sqrt(names.length)))
  const svgW = PAD + cols * gapX
  const svgH = PAD + Math.ceil(names.length / cols) * gapY + boxH

  const posOf = (name: string): { x: number; y: number } => {
    const index = names.indexOf(name)
    return { x: PAD + (index % cols) * gapX, y: PAD + Math.floor(index / cols) * gapY }
  }

  return (
    <div>
      <div style={MUTED}>先修关系（实线）与关联（虚线）拓扑；无环为先修图的合格条件。</div>
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: '#0f1117', borderRadius: 6 }}>
        {edges.map((edge, index) => {
          const from = posOf(edge.from)
          const to = posOf(edge.to)
          if (from.x === 0 && from.y === 0) return null
          const prerequisite = edge.kind === 'prerequisite'
          return (
            <line
              key={index}
              x1={from.x + boxW}
              y1={from.y + boxH / 2}
              x2={to.x}
              y2={to.y + boxH / 2}
              stroke={prerequisite ? '#faad14' : '#8c8c8c'}
              strokeWidth={1.5}
              strokeDasharray={prerequisite ? undefined : '5 4'}
            />
          )
        })}
        {names.map((name, index) => {
          const position = posOf(name)
          return (
            <g key={index}>
              <rect x={position.x} y={position.y} width={boxW} height={boxH} rx={6} fill="#1f2430" stroke="#434a5a" />
              <text x={position.x + boxW / 2} y={position.y + boxH / 2 + 4} fill="#e6e6e6" fontSize={12} textAnchor="middle">
                {name.length > 12 ? `${name.slice(0, 11)}…` : name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
