/**
 * K 线画布图表类：纯 canvas，无第三方库。
 * 支持滚轮缩放（光标锚定）、拖拽平移、十字线读数、多周期收盘均线（M5/M10/M20/M30/M60）、
 * 成交量副图、事件锚点三角标记与点选定位、双击复位。
 * 涨跌色按国内习惯红涨绿跌。
 */

export interface KlineBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  code?: string
  /** 该 bar 的周期（1d 日线 / 1w 周线）；图表本身不区分，取数方按它筛选。 */
  period?: '1d' | '1w'
}

export interface KlineEvent {
  date: string
  label: string
  unitId?: string
}

export interface KlineColors {
  up: string
  down: string
  ma: string
  grid: string
  text: string
  bg: string
  crosshair: string
  event: string
  surface: string
}

export interface KlineChartOptions {
  overlays?: string[]
  windowStart?: string
  windowEnd?: string
  volumeHeightRatio?: number
  onEventClick?: (event: KlineEvent) => void
  colors?: Partial<KlineColors>
  mode?: 'chart' | 'replay'
  revealCount?: number
}

const MIN_VISIBLE = 20
const MAX_VISIBLE = 240
const DEFAULT_VISIBLE = 60
const PAD_LEFT = 8
const PAD_RIGHT = 56
const PAD_TOP = 8
const PAD_BOTTOM = 20
const VOLUME_RATIO = 0.3

/** 均线位：讲师口径常用 M5/M10/M20/M30/M60，颜色按周期固定。 */
export const MA_PERIODS = [5, 10, 20, 30, 60] as const
export const DEFAULT_OVERLAYS = ['M5', 'M10', 'M60']

const MA_COLORS: Record<number, string> = {
  5: '#8c8c8c',
  10: '#1677ff',
  20: '#13c2c2',
  30: '#eb2f96',
  60: '#fa8c16',
}

/** 解析 overlays 里的均线位（`M5` → 5）；非 M 开头或非正整数的忽略。 */
export function parseOverlayPeriods(overlays: string[]): number[] {
  const periods: number[] = []
  for (const overlay of overlays) {
    const matched = /^M(\d+)$/.exec(overlay.trim())
    if (matched === null) continue
    const period = Number(matched[1])
    if (Number.isInteger(period) && period > 0) periods.push(period)
  }
  return [...new Set(periods)].sort((a, b) => a - b)
}

interface PriceScale {
  min: number
  max: number
  y: (price: number) => number
}

export class KlineChart {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private bars: KlineBar[] = []
  private events: KlineEvent[] = []
  private start = 0
  private visible = DEFAULT_VISIBLE
  private hover: { index: number; x: number; y: number } | undefined
  private dragging = false
  private dragX = 0
  private dragStart = 0
  private frame = 0
  private readonly overlays: string[]
  private readonly mode: 'chart' | 'replay'
  private revealCount = 0
  private maBars: KlineBar[] = []
  private maOffset = 0
  private readonly windowStart?: string
  private readonly windowEnd?: string
  private readonly volumeHeightRatio: number
  private readonly onEventClick?: (event: KlineEvent) => void
  private readonly observer: ResizeObserver | undefined
  private readonly customColors: Partial<KlineColors>

  private readonly onResize = (): void => this.schedule()

  constructor(canvas: HTMLCanvasElement, options: KlineChartOptions = {}) {
    this.canvas = canvas
    this.mode = options.mode ?? 'chart'
    this.revealCount = options.revealCount ?? 0
    this.overlays = options.overlays ?? DEFAULT_OVERLAYS
    this.windowStart = options.windowStart
    this.windowEnd = options.windowEnd
    this.volumeHeightRatio = options.volumeHeightRatio ?? VOLUME_RATIO
    this.onEventClick = options.onEventClick
    this.customColors = options.colors ?? {}
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas 2d context unavailable')
    this.context = context
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mouseleave', this.onMouseLeave)
    canvas.addEventListener('dblclick', this.onDoubleClick)
    window.addEventListener('mouseup', this.onMouseUp)
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.onResize)
      this.observer.observe(canvas)
    } else {
      window.addEventListener('resize', this.onResize)
    }
  }

  /**
   * `maBars` 是更长的历史序列（按交易日对齐），只用于均线计算——显示的仍是 `bars`。
   * 均线取全历史口径，才与正文引用的「当日 M60」一致。
   */
  setBars(bars: KlineBar[], events?: KlineEvent[], maBars?: KlineBar[]): void {
    this.bars = bars
    this.events = events ?? []
    this.maBars = maBars ?? bars
    this.maOffset = this.computeMaOffset()
    this.resetView()
    this.schedule()
  }

  /** 显示序列在历史序列中的起点（按交易日对齐）；对不上则退回用显示序列自身算均线。 */
  private computeMaOffset(): number {
    const first = this.bars[0]
    if (first === undefined || this.maBars === this.bars) return 0
    const index = this.maBars.findIndex(bar => bar.tradeDate === first.tradeDate)
    if (index === -1) {
      this.maBars = this.bars
      return 0
    }
    return index
  }

  setRevealCount(count: number): void {
    if (this.mode !== 'replay') return
    this.revealCount = Math.max(0, Math.min(this.bars.length, count))
    this.schedule()
  }

  destroy(): void {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('resize', this.onResize)
    this.observer?.disconnect()
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private resetView(): void {
    if (this.bars.length === 0) {
      this.start = 0
      this.visible = DEFAULT_VISIBLE
      return
    }
    if (this.mode === 'replay') {
      this.start = 0
      this.visible = this.bars.length
      return
    }
    if (this.windowStart && this.windowEnd) {
      const from = this.bars.findIndex((b) => b.tradeDate >= this.windowStart!)
      const to = this.bars.findIndex((b) => b.tradeDate > this.windowEnd!)
      const endIndex = to === -1 ? this.bars.length : to
      const startIndex = from === -1 ? 0 : from
      const count = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, endIndex - startIndex))
      this.visible = count
      this.start = Math.min(startIndex, Math.max(0, this.bars.length - count))
      return
    }
    this.visible = Math.min(DEFAULT_VISIBLE, this.bars.length)
    this.start = Math.max(0, this.bars.length - this.visible)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.mode === 'replay' || this.bars.length === 0) return
    event.preventDefault()
    const before = this.indexAt(event.offsetX)
    const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
    const next = Math.round(Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, this.visible * factor)))
    if (next === this.visible) return
    const ratio = (before - this.start) / Math.max(1, this.visible)
    this.visible = next
    this.start = this.clampStart(Math.round(before - ratio * this.visible))
    this.schedule()
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.bars.length === 0) return
    if (this.mode === 'replay') {
      const hit = this.eventAt(event.offsetX, event.offsetY)
      if (hit) this.onEventClick?.(hit)
      return
    }
    const hit = this.eventAt(event.offsetX, event.offsetY)
    if (hit) {
      this.onEventClick?.(hit)
      return
    }
    this.dragging = true
    this.dragX = event.offsetX
    this.dragStart = this.start
  }

  private readonly onMouseUp = (): void => {
    this.dragging = false
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.bars.length === 0) return
    if (this.dragging && this.mode === 'chart') {
      const width = this.plotWidth()
      const perBar = width / Math.max(1, this.visible)
      const shift = Math.round((this.dragX - event.offsetX) / Math.max(1, perBar))
      this.start = this.clampStart(this.dragStart + shift)
    }
    this.hover = { index: this.indexAt(event.offsetX), x: event.offsetX, y: event.offsetY }
    this.schedule()
  }

  private readonly onMouseLeave = (): void => {
    this.hover = undefined
    this.schedule()
  }

  private readonly onDoubleClick = (): void => {
    if (this.bars.length === 0) return
    this.resetView()
    this.schedule()
  }

  private plotWidth(): number {
    return Math.max(1, this.canvas.clientWidth - PAD_LEFT - PAD_RIGHT)
  }

  private plotHeight(): number {
    return Math.max(1, this.canvas.clientHeight - PAD_TOP - PAD_BOTTOM)
  }

  private indexAt(x: number): number {
    const perBar = this.plotWidth() / Math.max(1, this.visible)
    return this.clampStart(this.start + Math.floor((x - PAD_LEFT) / Math.max(1, perBar)))
  }

  private eventAt(x: number, y: number): KlineEvent | undefined {
    const end = Math.min(this.bars.length, this.start + this.visible)
    const visibleBars = this.bars.slice(this.start, end)
    const priceScale = this.priceScale(visibleBars)
    const perBar = this.plotWidth() / Math.max(1, this.visible)
    const triH = 8
    const triW = 7
    for (const ev of this.events) {
      const offset = visibleBars.findIndex((b) => b.tradeDate === ev.date)
      if (offset === -1) continue
      const index = this.start + offset
      const bar = this.bars[index]
      if (bar === undefined) continue
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      const top = priceScale.y(bar.high) - triH - 4
      if (Math.abs(x - cx) <= triW && y >= top && y <= top + triH + 4) {
        return ev
      }
    }
    return undefined
  }

  private clampStart(value: number): number {
    return Math.min(Math.max(0, this.bars.length - this.visible), Math.max(0, value))
  }

  private schedule(): void {
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private resolveColors(): KlineColors {
    const style = getComputedStyle(this.canvas)
    const get = (name: keyof KlineColors, fallback: string): string => {
      const custom = this.customColors[name]
      if (custom) return custom
      const value = style.getPropertyValue(`--wg-${name}`).trim()
      return value || fallback
    }
    const readVar = (name: string): string => style.getPropertyValue(`--wg-${name}`).trim()
    return {
      up: get('up', '#ef4d4d'),
      down: get('down', '#21ba72'),
      ma: get('ma', '#faad14'),
      grid: get('grid', 'rgba(0, 0, 0, 0.08)'),
      text: get('text', 'rgba(0, 0, 0, 0.55)'),
      bg: this.customColors.bg ?? (readVar('canvas-bg') || get('bg', 'transparent')),
      crosshair: get('crosshair', 'rgba(0, 0, 0, 0.35)'),
      event: get('event', '#1677ff'),
      surface: this.customColors.surface ?? (readVar('surface-solid') || get('surface', '#ffffff')),
    }
  }

  private priceScale(visibleBars: KlineBar[]): PriceScale {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const bar of visibleBars) {
      min = Math.min(min, bar.low)
      max = Math.max(max, bar.high)
    }
    const span = max - min || 1
    const paddedMin = min - span * 0.06
    const paddedMax = max + span * 0.06
    const range = paddedMax - paddedMin
    const y = (price: number): number => PAD_TOP + ((paddedMax - price) / range) * this.plotHeight() * (1 - this.volumeHeightRatio)
    return { min: paddedMin, max: paddedMax, y }
  }

  /** 右上角均线图例：色块 + 周期名，与画线颜色一一对应。 */
  private drawOverlayLegend(ctx: CanvasRenderingContext2D, colors: KlineColors): void {
    const periods = parseOverlayPeriods(this.overlays)
    if (periods.length === 0) return
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    const right = PAD_LEFT + this.plotWidth() - 6
    let x = right
    const items = periods.map(period => {
      const label = `M${period}`
      const width = ctx.measureText(label).width + 12
      x -= width
      return { period, label, x }
    })
    ctx.fillStyle = colors.surface
    ctx.globalAlpha = 0.75
    ctx.fillRect(x - 4, PAD_TOP, right - x + 10, 16)
    ctx.globalAlpha = 1
    for (const item of items) {
      ctx.fillStyle = MA_COLORS[item.period] ?? colors.ma
      ctx.fillRect(item.x, PAD_TOP + 6, 8, 2)
      ctx.fillStyle = colors.text
      ctx.fillText(item.label, item.x + 12, PAD_TOP + 1)
    }
  }

  private render(): void {
    const colors = this.resolveColors()
    const ratio = window.devicePixelRatio || 1
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width <= 0 || height <= 0) return
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio)
      this.canvas.height = Math.round(height * ratio)
    }
    const ctx = this.context
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, width, height)
    if (this.bars.length === 0) {
      ctx.fillStyle = colors.text
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText('暂无行情数据', PAD_LEFT, PAD_TOP + 16)
      return
    }

    const end = Math.min(this.bars.length, this.start + this.visible)
    const visibleBars = this.bars.slice(this.start, end)
    const drawEnd = this.mode === 'replay' ? Math.min(this.revealCount, visibleBars.length) : visibleBars.length
    const plotWidth = this.plotWidth()
    const plotHeight = this.plotHeight()
    const priceHeight = plotHeight * (1 - this.volumeHeightRatio)
    const volumeHeight = plotHeight * this.volumeHeightRatio
    const perBar = plotWidth / Math.max(1, this.visible)
    const bodyWidth = Math.max(1, Math.min(12, perBar * 0.62))
    const scale = this.priceScale(visibleBars)
    const yPrice = scale.y

    // 网格与价格刻度
    ctx.strokeStyle = colors.grid
    ctx.fillStyle = colors.text
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let step = 0; step <= 4; step += 1) {
      const price = scale.max - ((scale.max - scale.min) * step) / 4
      const py = yPrice(price)
      ctx.beginPath()
      ctx.moveTo(PAD_LEFT, py)
      ctx.lineTo(PAD_LEFT + plotWidth, py)
      ctx.stroke()
      ctx.fillText(price.toFixed(2), PAD_LEFT + plotWidth + 4, py)
    }

    // 成交量副图 Y 映射
    let maxVolume = 0
    for (let offset = 0; offset < drawEnd; offset += 1) {
      maxVolume = Math.max(maxVolume, visibleBars[offset]?.volume ?? 0)
    }
    const volumeZeroY = PAD_TOP + priceHeight + volumeHeight
    const volumeY = (volume: number): number => volumeZeroY - (maxVolume === 0 ? 0 : (volume / maxVolume) * volumeHeight * 0.9)

    for (let offset = 0; offset < visibleBars.length; offset += 1) {
      const index = this.start + offset
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      const bar = visibleBars[offset]
      if (bar === undefined) continue
      if (offset < drawEnd) {
        const up = bar.close >= bar.open
        const color = up ? colors.up : colors.down
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(cx, yPrice(bar.high))
        ctx.lineTo(cx, yPrice(bar.low))
        ctx.stroke()
        const top = yPrice(Math.max(bar.open, bar.close))
        const bottom = yPrice(Math.min(bar.open, bar.close))
        ctx.fillRect(cx - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top))
        if (index === this.hover?.index) {
          ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)'
          ctx.strokeRect(cx - bodyWidth / 2 - 1, top - 1, bodyWidth + 2, Math.max(1, bottom - top) + 2)
        }
        // 成交量
        const vy = volumeY(bar.volume)
        const vh = Math.max(1, volumeZeroY - vy)
        ctx.globalAlpha = 0.45
        ctx.fillRect(cx - bodyWidth / 2, vy, bodyWidth, vh)
        ctx.globalAlpha = 1
      }
      // 事件锚点三角（仅揭示区）
      if (offset < drawEnd) {
        const ev = this.events.find((e) => e.date === bar.tradeDate)
        if (ev) {
          ctx.fillStyle = colors.event
          const top = yPrice(bar.high) - 8
          ctx.beginPath()
          ctx.moveTo(cx, top)
          ctx.lineTo(cx - 6, top - 8)
          ctx.lineTo(cx + 6, top - 8)
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    // 收盘均线（多周期，取全历史口径）
    for (const period of parseOverlayPeriods(this.overlays)) {
      ctx.strokeStyle = MA_COLORS[period] ?? colors.ma
      ctx.lineWidth = period >= 60 ? 1.6 : 1.2
      ctx.beginPath()
      let started = false
      for (let offset = 0; offset < visibleBars.length; offset += 1) {
        const index = this.start + offset
        const sourceIndex = this.maOffset + index
        if (sourceIndex < period - 1) continue
        let sum = 0
        for (let back = 0; back < period; back += 1) {
          sum += this.maBars[sourceIndex - back]?.close ?? 0
        }
        const cx = PAD_LEFT + perBar * (offset + 0.5)
        const py = yPrice(sum / period)
        if (started) ctx.lineTo(cx, py)
        else {
          ctx.moveTo(cx, py)
          started = true
        }
      }
      ctx.stroke()
      ctx.lineWidth = 1
    }

    this.drawOverlayLegend(ctx, colors)

    // 日期刻度
    ctx.fillStyle = colors.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const labelStep = Math.max(1, Math.floor(this.visible / 4))
    for (let offset = 0; offset < drawEnd; offset += 1) {
      if (offset % labelStep !== 0) continue
      const bar = visibleBars[offset]
      if (bar === undefined) continue
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      ctx.fillText(bar.tradeDate.slice(5), cx, PAD_TOP + plotHeight + 4)
    }

    // 回放未揭示遮罩
    if (this.mode === 'replay' && drawEnd < visibleBars.length) {
      const maskX = PAD_LEFT + perBar * drawEnd
      ctx.fillStyle = 'rgba(128, 128, 128, 0.12)'
      ctx.fillRect(maskX, PAD_TOP, plotWidth - (maskX - PAD_LEFT), plotHeight)
    }

    // 十字线与读数
    const hover = this.hover
    if (hover === undefined || hover.index < this.start || hover.index >= this.start + drawEnd) return
    const bar = this.bars[hover.index]
    if (bar === undefined) return
    const cx = PAD_LEFT + perBar * (hover.index - this.start + 0.5)
    ctx.strokeStyle = colors.crosshair
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cx, PAD_TOP)
    ctx.lineTo(cx, PAD_TOP + plotHeight)
    ctx.moveTo(PAD_LEFT, hover.y)
    ctx.lineTo(PAD_LEFT + plotWidth, hover.y)
    ctx.stroke()
    ctx.setLineDash([])
    const label = `${bar.tradeDate}  开 ${bar.open.toFixed(2)} 高 ${bar.high.toFixed(2)} 低 ${bar.low.toFixed(2)} 收 ${bar.close.toFixed(2)} 量 ${bar.volume.toLocaleString()}`
    ctx.fillStyle = colors.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, PAD_LEFT + 2, PAD_TOP - 2)
  }
}
