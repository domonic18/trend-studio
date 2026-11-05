import {
  Button,
  Card,
  Empty,
  InputNumber,
  List,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
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
} from './engine'
import type { WidgetAssertions, WidgetSpec, WidgetType } from './types'
import type { WidgetDetail } from '../types'

const FORMULA_LABELS: Record<string, string> = {
  'position-size': '仓位手数 = 资金×风险% ÷ (价格×止损距离%)',
  'risk-reward': '盈亏比 = (目标价−入场价) ÷ (入场价−止损价)',
  'drawdown-recovery': '回本% = 回撤% ÷ (100−回撤%) × 100',
}

export function WidgetPlayer({ widget }: { widget: WidgetDetail }) {
  const spec = widget.spec as WidgetSpec | null
  const assertions = widget.assertions as WidgetAssertions | null
  const type = widget.type as WidgetType

  if (spec === null) {
    return (
      <Card size="small" title={`${widget.widgetId} · ${type}`}>
        <Empty description="课件 spec 缺失" />
      </Card>
    )
  }

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Typography.Text strong>{type}</Typography.Text>
          <Tag>{widget.widgetId}</Tag>
          <Tag color={widget.status === 'published' ? 'green' : undefined}>{widget.status}</Tag>
          <Typography.Text type="secondary">v{widget.version}</Typography.Text>
        </Space>
      }
      extra={
        <ProofBadge type={type} spec={spec} assertions={assertions} />
      }
    >
      <WidgetBody type={type} spec={spec} assertions={assertions} />
    </Card>
  )
}

/** 课件自证结果徽标：复用云端同源证明逻辑。 */
function ProofBadge({
  type,
  spec,
  assertions,
}: {
  type: WidgetType
  spec: WidgetSpec
  assertions: WidgetAssertions | null
}) {
  const proof = useMemo(() => {
    if (assertions === null) return null
    return previewProve(type, spec, assertions)
  }, [type, spec, assertions])

  if (proof === null) return <Tag bordered={false}>无断言</Tag>
  if (proof.failed.length === 0) return <Tag color="green" bordered={false}>全部断言通过</Tag>
  return <Tag color="red" bordered={false}>失败：{proof.failed.join(', ')}</Tag>
}

const RENDERERS: Record<WidgetType, (props: { spec: WidgetSpec; assertions: WidgetAssertions | null }) => JSX.Element> = {
  'kline-annotator': KlineAnnotator,
  'pattern-quiz': PatternQuiz,
  'step-reveal': StepReveal,
  'calc-trainer': CalcTrainer,
  'mcq-quiz': McqQuiz,
  flashcards: Flashcards,
  checklist: Checklist,
  'timeline-explorer': TimelineExplorer,
}

function WidgetBody({
  type,
  spec,
  assertions,
}: {
  type: WidgetType
  spec: WidgetSpec
  assertions: WidgetAssertions | null
}) {
  const Renderer = RENDERERS[type]
  if (Renderer === undefined) return <Empty description={`未知课件类型：${type}`} />
  return <Renderer spec={spec} assertions={assertions} />
}

// ===================== K 线图（SVG） =====================

const CHART_W = 480
const CHART_H = 240
const PAD = 16

function priceScale(candles: Candle[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const c of candles) {
    min = Math.min(min, c.low)
    max = Math.max(max, c.high)
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
  markers?: { idx: number; price: number; kind: string }[]
  onPick?: (index: number) => void
  picks?: number[]
}) {
  const { min, max } = priceScale(candles)
  const n = candles.length
  const colW = (CHART_W - PAD * 2) / n
  const y = (price: number) => PAD + ((max - price) / (max - min)) * (CHART_H - PAD * 2)
  const xCenter = (idx: number) => PAD + colW * (idx + 0.5)

  const handleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (onPick === undefined) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const idx = Math.max(0, Math.min(n - 1, Math.floor((x - PAD) / colW)))
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
      style={{ background: '#0f1117', borderRadius: 6, cursor: onPick ? 'crosshair' : 'default' }}
      onClick={handleClick}
    >
      {candles.map((c, idx) => {
        const up = c.close >= c.open
        const color = up ? '#ef4d4d' : '#21ba72'
        const xBody = xCenter(idx)
        const bodyTop = y(Math.max(c.open, c.close))
        const bodyBottom = y(Math.min(c.open, c.close))
        const isPick = picks?.includes(idx)
        return (
          <g key={idx}>
            <line x1={xBody} x2={xBody} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} />
            <rect
              x={xBody - colW * 0.32}
              y={bodyTop}
              width={colW * 0.64}
              height={Math.max(1, bodyBottom - bodyTop)}
              fill={color}
            />
            {isPick ? <circle cx={xBody} cy={y(c.low)} r={4} fill="#ffffff" stroke="#faad14" strokeWidth={2} /> : null}
          </g>
        )
      })}
      {line ? (
        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#faad14" strokeWidth={2} strokeDasharray="6 3" />
      ) : null}
      {markers?.map((m, i) => (
        <circle key={i} cx={xCenter(m.idx)} cy={y(m.price)} r={3} fill="#1890ff" />
      ))}
    </svg>
  )
}

// ===================== 1. kline-annotator =====================

function KlineAnnotator({ spec, assertions }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const candles = useMemo(
    () => (spec.data ? generateCandles(spec.data.generator, spec.data.seed, spec.data.bars) : []),
    [spec.data],
  )
  const [picks, setPicks] = useState<number[]>([])
  const [showAnswer, setShowAnswer] = useState(false)

  const onPick = (idx: number): void => {
    setPicks(prev => (prev.length >= 2 ? [idx] : [...prev, idx]))
  }

  const result = useMemo(() => {
    if (picks.length < 2) return null
    const [startIdx, endIdx] = picks
    if (startIdx === undefined || endIdx === undefined) return null
    const line = { startIdx, endIdx }
    const touches = countTrendlineTouches(candles, line)
    const { angleDeg } = trendlineAt(candles, line)
    const above = closesHoldAbove(candles, line)
    const minTouches = assertions?.trendlineTouches?.min ?? 0
    const [lo, hi] = assertions?.slopeRange ?? [-90, 90]
    const pass = touches >= minTouches && angleDeg >= lo && angleDeg <= hi && above
    return { touches, angleDeg, above, pass }
  }, [picks, candles, assertions])

  const solution = spec.solution?.trendline

  return (
    <div className="widget-body">
      <Typography.Paragraph type="secondary">{spec.task}</Typography.Paragraph>
      <KLineChart candles={candles} trendline={showAnswer ? solution : undefined} onPick={onPick} picks={picks} />
      <Space wrap style={{ marginTop: 8 }}>
        <Typography.Text>已选：{picks.length === 2 ? `bar ${picks[0]} → bar ${picks[1]}` : '点击图上两点定趋势线'}</Typography.Text>
        <Button size="small" onClick={() => setPicks([])}>清除</Button>
        <Button size="small" type="dashed" onClick={() => setShowAnswer(v => !v)}>
          {showAnswer ? '隐藏参考答案' : '显示参考答案'}
        </Button>
      </Space>
      {result ? (
        <Typography.Paragraph style={{ marginTop: 8 }}>
          触及 {result.touches} 根 · 角度 {result.angleDeg.toFixed(1)}° · 收盘均在线之上：{result.above ? '是' : '否'} ·
          <Typography.Text strong type={result.pass ? 'success' : 'danger'}>
            {result.pass ? ' 判定通过' : ' 判定未达'}
          </Typography.Text>
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}

// ===================== 2. pattern-quiz =====================

function PatternQuiz({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const options = spec.options ?? []
  const answerId = spec.answerId ?? ''

  const chartFor = (index: number): Candle[] => {
    const base = spec.data
    const option = options[index]
    if (base === undefined) return []
    const generator = option?.generator ?? base.generator
    const seed = option?.seed ?? base.seed
    const bars = option?.bars ?? base.bars
    return generateCandles(generator, seed, bars)
  }

  return (
    <div className="widget-body">
      <Typography.Paragraph>{spec.question}</Typography.Paragraph>
      <List
        dataSource={options}
        renderItem={(opt, i) => {
          const isAnswer = opt.id === answerId
          const revealed = picked !== null
          const color = revealed
            ? isAnswer
              ? 'green'
              : opt.id === picked
                ? 'red'
                : undefined
            : undefined
          return (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => setPicked(opt.id)}
              actions={[<Tag key="shape" bordered={false}>{classifyShape(chartFor(i))}</Tag>]}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Tag color={color}>{opt.label}</Tag>
                <KLineChart candles={chartFor(i)} />
              </Space>
            </List.Item>
          )
        }}
      />
      {picked !== null ? (
        <Typography.Text type={picked === answerId ? 'success' : 'danger'}>
          {picked === answerId ? '回答正确' : '回答错误'}（参考答案为「{options.find(o => o.id === answerId)?.label}」）
        </Typography.Text>
      ) : null}
    </div>
  )
}

// ===================== 3. step-reveal =====================

function StepReveal({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const steps = spec.steps ?? []
  const [shown, setShown] = useState(0)

  return (
    <div className="widget-body">
      {steps.slice(0, shown + 1).map((step, i) => (
        <Card key={i} size="small" style={{ marginBottom: 8 }} title={step.title}>
          <Typography.Paragraph>区间 bar {step.fromIdx} – {step.toIdx}</Typography.Paragraph>
          {step.markers && step.markers.length > 0 ? (
            <KLineChart
              candles={spec.data ? generateCandles(spec.data.generator, spec.data.seed, spec.data.bars) : []}
              markers={step.markers}
            />
          ) : null}
          <Typography.Paragraph style={{ marginTop: 8 }}>{step.conclusion}</Typography.Paragraph>
        </Card>
      ))}
      <Space>
        {shown < steps.length - 1 ? (
          <Button size="small" type="primary" onClick={() => setShown(s => s + 1)}>下一步</Button>
        ) : null}
        {shown < steps.length - 1 && shown > 0 ? (
          <Button size="small" onClick={() => setShown(0)}>重置</Button>
        ) : null}
      </Space>
      {shown === steps.length - 1 && spec.finalConclusion ? (
        <Card size="small" style={{ marginTop: 8 }} type="inner" title="总结">
          <Typography.Paragraph>{spec.finalConclusion}</Typography.Paragraph>
        </Card>
      ) : null}
    </div>
  )
}

// ===================== 4. calc-trainer =====================

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
    <div className="widget-body">
      <Typography.Paragraph type="secondary">{FORMULA_LABELS[formula] ?? formula}</Typography.Paragraph>
      <Space wrap direction="vertical" style={{ width: '100%' }}>
        {Object.keys(inputs).map(key => (
          <Space key={key}>
            <Typography.Text>{key}</Typography.Text>
            <InputNumber
              value={values[key]}
              onChange={v => setValues(prev => ({ ...prev, [key]: v ?? 0 }))}
            />
          </Space>
        ))}
        <Button size="small" type="primary" onClick={compute}>计算</Button>
        {computed !== undefined ? (
          <Typography.Text>计算结果：<Typography.Text strong>{computed.toFixed(3)}</Typography.Text></Typography.Text>
        ) : null}
      </Space>
      <Typography.Paragraph strong style={{ marginTop: 8 }}>示例校验</Typography.Paragraph>
      <List
        size="small"
        dataSource={examples}
        renderItem={(ex, i) => {
          const got = isFormulaId(formula) ? computeFormula(formula, ex.inputs) : undefined
          const match = got !== undefined && Math.abs(got - ex.answer) <= (spec.tolerance ?? 1e-6) * Math.max(1, Math.abs(ex.answer))
          return (
            <List.Item>
              <Space>
                <Typography.Text>示例 {i + 1}</Typography.Text>
                <Tag>{got !== undefined ? got.toFixed(3) : '—'}</Tag>
                <Typography.Text type="secondary">期望 {ex.answer}</Typography.Text>
                <Tag color={match ? 'green' : 'red'}>{match ? '一致' : '不一致'}</Tag>
              </Space>
            </List.Item>
          )
        }}
      />
    </div>
  )
}

// ===================== 5. mcq-quiz =====================

function McqQuiz({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const options = spec.options ?? []
  const answerId = spec.answerId ?? ''
  const revealed = picked !== null

  return (
    <div className="widget-body">
      <Typography.Paragraph>{spec.question}</Typography.Paragraph>
      <List
        dataSource={options}
        renderItem={opt => {
          const isAnswer = opt.id === answerId
          const color = revealed
            ? isAnswer
              ? 'green'
              : opt.id === picked
                ? 'red'
                : undefined
            : undefined
          return (
            <List.Item style={{ cursor: 'pointer' }} onClick={() => setPicked(opt.id)}>
              <Tag color={color}>{opt.label}</Tag>
            </List.Item>
          )
        }}
      />
      {spec.conceptRefs && spec.conceptRefs.length > 0 ? (
        <Space wrap>
          {spec.conceptRefs.map(ref => <Tag key={ref} color="blue">{ref}</Tag>)}
        </Space>
      ) : null}
      {revealed ? (
        <Typography.Text type={picked === answerId ? 'success' : 'danger'} style={{ display: 'block', marginTop: 8 }}>
          {picked === answerId ? '回答正确' : '回答错误'}
        </Typography.Text>
      ) : null}
    </div>
  )
}

// ===================== 6. flashcards =====================

function Flashcards({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const cards = spec.cards ?? []
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = cards[index]

  useEffect(() => {
    setFlipped(false)
  }, [index])

  if (card === undefined) return <Empty description="无卡片" />

  return (
    <div className="widget-body">
      <Card
        size="small"
        style={{ minHeight: 96, cursor: 'pointer', textAlign: 'center' }}
        onClick={() => setFlipped(v => !v)}
      >
        <Typography.Title level={5} style={{ marginTop: 8 }}>
          {flipped ? card.back : card.front}
        </Typography.Title>
        {card.conceptRef ? <Tag color="blue">{card.conceptRef}</Tag> : null}
        <div><Typography.Text type="secondary">{flipped ? '背面（点击翻回）' : '正面（点击查看背面）'}</Typography.Text></div>
      </Card>
      <Space style={{ marginTop: 8 }}>
        <Button size="small" disabled={index === 0} onClick={() => setIndex(i => i - 1)}>上一张</Button>
        <Typography.Text>{index + 1} / {cards.length}</Typography.Text>
        <Button size="small" disabled={index === cards.length - 1} onClick={() => setIndex(i => i + 1)}>下一张</Button>
      </Space>
    </div>
  )
}

// ===================== 7. checklist =====================

function Checklist({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const items = spec.items ?? []
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const toggle = (i: number): void => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="widget-body">
      <Typography.Paragraph strong>{spec.title}</Typography.Paragraph>
      <List
        dataSource={items}
        renderItem={(item, i) => (
          <List.Item style={{ cursor: 'pointer' }} onClick={() => toggle(i)}>
            <Space>
              <Tag color={checked.has(i) ? 'green' : undefined}>{checked.has(i) ? '✓' : '○'}</Tag>
              <Typography.Text>{item.text}</Typography.Text>
              {item.conceptRef ? <Tag color="blue">{item.conceptRef}</Tag> : null}
            </Space>
          </List.Item>
        )}
      />
    </div>
  )
}

// ===================== 8. timeline-explorer =====================

function TimelineExplorer({ spec }: { spec: WidgetSpec; assertions: WidgetAssertions | null }) {
  const nodes = spec.nodes ?? []
  const edges = spec.edges ?? []
  const names = nodes.map(n => n.conceptRef)
  const boxW = 120
  const boxH = 40
  const gapX = 150
  const gapY = 70
  const cols = Math.max(1, Math.ceil(Math.sqrt(names.length)))
  const svgW = PAD + cols * gapX
  const svgH = PAD + Math.ceil(names.length / cols) * gapY + boxH

  const posOf = (name: string): { x: number; y: number } => {
    const i = names.indexOf(name)
    const row = Math.floor(i / cols)
    const col = i % cols
    return { x: PAD + col * gapX, y: PAD + row * gapY }
  }

  return (
    <div className="widget-body">
      <Typography.Paragraph type="secondary">先修关系（实线）与关联（虚线）拓扑；无环为先修图的合格条件。</Typography.Paragraph>
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ background: '#0f1117', borderRadius: 6 }}>
        {edges.map((e, i) => {
          const from = posOf(e.from)
          const to = posOf(e.to)
          if (from.x === 0 && from.y === 0) return null
          const prerequisite = e.kind === 'prerequisite'
          return (
            <line
              key={i}
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
        {names.map((name, i) => {
          const p = posOf(name)
          return (
            <g key={i}>
              <rect x={p.x} y={p.y} width={boxW} height={boxH} rx={6} fill="#1f2430" stroke="#434a5a" />
              <text x={p.x + boxW / 2} y={p.y + boxH / 2 + 4} fill="#e6e6e6" fontSize={12} textAnchor="middle">
                {name.length > 12 ? `${name.slice(0, 11)}…` : name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
