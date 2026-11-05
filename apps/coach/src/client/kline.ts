/**
 * 学员端 K 线画布：纯 canvas 实现，无第三方图表库。
 *
 * 交互：滚轮缩放、拖拽平移、十字线读数；叠加 M60 收盘均线。
 * 配色按国内习惯：红涨绿跌。
 */

export interface KlineBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const UP_COLOR = '#ef4d4d'
const DOWN_COLOR = '#21ba72'
const MA_COLOR = '#faad14'
const GRID_COLOR = 'rgba(255, 255, 255, 0.08)'
const TEXT_COLOR = 'rgba(255, 255, 255, 0.55)'
const MIN_VISIBLE = 20
const MAX_VISIBLE = 240
const DEFAULT_VISIBLE = 60
const MA_PERIOD = 60
const PAD_LEFT = 8
const PAD_RIGHT = 56
const PAD_TOP = 8
const PAD_BOTTOM = 20

export class KlineChart {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private bars: KlineBar[] = []
  private start = 0
  private visible = DEFAULT_VISIBLE
  private hover: { index: number; x: number; y: number } | undefined
  private dragging = false
  private dragX = 0
  private dragStart = 0
  private frame = 0
  private readonly observer: ResizeObserver | undefined
  private readonly onResize = (): void => {
    this.schedule()
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas 2d context unavailable')
    this.context = context
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mouseleave', this.onMouseLeave)
    window.addEventListener('mouseup', this.onMouseUp)
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.onResize)
      this.observer.observe(canvas)
    } else {
      window.addEventListener('resize', this.onResize)
    }
  }

  setBars(bars: KlineBar[]): void {
    this.bars = bars
    this.start = Math.max(0, bars.length - this.visible)
    this.schedule()
  }

  destroy(): void {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('resize', this.onResize)
    this.observer?.disconnect()
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.bars.length === 0) return
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
    this.dragging = true
    this.dragX = event.offsetX
    this.dragStart = this.start
  }

  private readonly onMouseUp = (): void => {
    this.dragging = false
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.bars.length === 0) return
    if (this.dragging) {
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

  private plotWidth(): number {
    return Math.max(1, this.canvas.clientWidth - PAD_LEFT - PAD_RIGHT)
  }

  private indexAt(x: number): number {
    const perBar = this.plotWidth() / Math.max(1, this.visible)
    return this.clampStart(this.start + Math.floor((x - PAD_LEFT) / Math.max(1, perBar)))
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

  private render(): void {
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
    if (this.bars.length === 0) {
      ctx.fillStyle = TEXT_COLOR
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText('暂无行情数据', PAD_LEFT, PAD_TOP + 16)
      return
    }

    const end = Math.min(this.bars.length, this.start + this.visible)
    const visibleBars = this.bars.slice(this.start, end)
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const bar of visibleBars) {
      min = Math.min(min, bar.low)
      max = Math.max(max, bar.high)
    }
    const span = max - min || 1
    min -= span * 0.06
    max += span * 0.06

    const plotWidth = this.plotWidth()
    const plotHeight = height - PAD_TOP - PAD_BOTTOM
    const perBar = plotWidth / Math.max(1, this.visible)
    const bodyWidth = Math.max(1, Math.min(12, perBar * 0.62))
    const y = (price: number): number => PAD_TOP + ((max - price) / (max - min)) * plotHeight

    // 网格与价格刻度
    ctx.strokeStyle = GRID_COLOR
    ctx.fillStyle = TEXT_COLOR
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let step = 0; step <= 4; step += 1) {
      const price = max - ((max - min) * step) / 4
      const py = y(price)
      ctx.beginPath()
      ctx.moveTo(PAD_LEFT, py)
      ctx.lineTo(PAD_LEFT + plotWidth, py)
      ctx.stroke()
      ctx.fillText(price.toFixed(2), PAD_LEFT + plotWidth + 4, py)
    }

    // K 线实体
    visibleBars.forEach((bar, offset) => {
      const index = this.start + offset
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      const color = bar.close >= bar.open ? UP_COLOR : DOWN_COLOR
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(cx, y(bar.high))
      ctx.lineTo(cx, y(bar.low))
      ctx.stroke()
      const top = y(Math.max(bar.open, bar.close))
      const bottom = y(Math.min(bar.open, bar.close))
      ctx.fillRect(cx - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top))
      if (index === this.hover?.index) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.strokeRect(cx - bodyWidth / 2 - 1, top - 1, bodyWidth + 2, Math.max(1, bottom - top) + 2)
      }
    })

    // M60 收盘均线
    ctx.strokeStyle = MA_COLOR
    ctx.lineWidth = 1.4
    ctx.beginPath()
    let started = false
    for (let offset = 0; offset < visibleBars.length; offset += 1) {
      const index = this.start + offset
      if (index < MA_PERIOD - 1) continue
      let sum = 0
      for (let back = 0; back < MA_PERIOD; back += 1) {
        sum += this.bars[index - back]?.close ?? 0
      }
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      const py = y(sum / MA_PERIOD)
      if (started) ctx.lineTo(cx, py)
      else {
        ctx.moveTo(cx, py)
        started = true
      }
    }
    ctx.stroke()
    ctx.lineWidth = 1

    // 日期刻度
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const labelStep = Math.max(1, Math.floor(this.visible / 4))
    visibleBars.forEach((bar, offset) => {
      if (offset % labelStep !== 0) return
      const cx = PAD_LEFT + perBar * (offset + 0.5)
      ctx.fillText(bar.tradeDate.slice(5), cx, height - PAD_BOTTOM + 4)
    })

    // 十字线与读数
    const hover = this.hover
    if (hover === undefined || hover.index < this.start || hover.index >= end) return
    const bar = this.bars[hover.index]
    if (bar === undefined) return
    const cx = PAD_LEFT + perBar * (hover.index - this.start + 0.5)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cx, PAD_TOP)
    ctx.lineTo(cx, height - PAD_BOTTOM)
    ctx.moveTo(PAD_LEFT, hover.y)
    ctx.lineTo(PAD_LEFT + plotWidth, hover.y)
    ctx.stroke()
    ctx.setLineDash([])
    const label = `${bar.tradeDate}  开 ${bar.open.toFixed(2)} 收 ${bar.close.toFixed(2)}`
    ctx.fillStyle = TEXT_COLOR
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, PAD_LEFT + 2, PAD_TOP - 2)
  }
}
