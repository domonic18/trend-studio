import * as React from 'react'
import {
  KlineChart,
  type KlineBar,
  type KlineChartOptions,
  type KlineEvent,
  type KlineHoverInfo,
} from './kline-chart.js'

export interface KlineProps {
  bars: KlineBar[]
  /** 更长的历史序列（按交易日对齐），只用于均线计算；缺省用 bars 自身。 */
  maBars?: KlineBar[]
  events?: KlineEvent[]
  height?: number
  windowStart?: string
  windowEnd?: string
  overlays?: string[]
  onEventClick?: (event: KlineEvent) => void
  mode?: 'chart' | 'replay'
  revealCount?: number
  /** 定位到该交易日（图表平移使其居中），用于事件列表点选。 */
  focusDate?: string
}

export function Kline({
  bars,
  maBars,
  events,
  height = 260,
  windowStart,
  windowEnd,
  overlays,
  onEventClick,
  mode = 'chart',
  revealCount,
  focusDate,
}: KlineProps): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement | null>(null)
  const chartRef = React.useRef<KlineChart | null>(null)
  const [hover, setHover] = React.useState<KlineHoverInfo | undefined>(undefined)
  const widthRef = React.useRef(0)

  // 回调必须稳定：否则图表实例会被反复重建，视野与缩放状态全丢。
  const handleHover = React.useCallback((info: KlineHoverInfo | undefined): void => {
    widthRef.current = ref.current?.clientWidth ?? 0
    setHover(info)
  }, [])

  React.useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return undefined
    const chart = new KlineChart(canvas, {
      windowStart,
      windowEnd,
      overlays,
      onEventClick,
      onHover: handleHover,
      mode,
      revealCount,
    })
    chartRef.current = chart
    chart.setBars(bars, events, maBars)
    return () => {
      chart.destroy()
      chartRef.current = null
    }
  }, [bars, maBars, events, windowStart, windowEnd, overlays, onEventClick, handleHover, mode])

  React.useEffect(() => {
    if (mode === 'replay' && chartRef.current !== null && revealCount !== undefined) {
      chartRef.current.setRevealCount(revealCount)
    }
  }, [revealCount, mode])

  React.useEffect(() => {
    if (focusDate === undefined) return
    chartRef.current?.focusOn(focusDate)
  }, [focusDate])

  const flip = hover !== undefined && hover.x > widthRef.current - 220

  return (
    <div className="wg-kline-stage">
      {React.createElement('canvas', {
        ref,
        className: 'wg-kline-canvas',
        style: { width: '100%', height: `${height}px`, display: 'block' },
      })}
      {hover !== undefined ? (
        <div
          className={`wg-kline-tip${flip ? ' wg-kline-tip-flip' : ''}`}
          style={{ left: `${hover.x}px`, top: `${hover.y}px` }}
        >
          <b>{hover.bar.tradeDate}</b>
          <span>开 {hover.bar.open.toFixed(2)}</span>
          <span>高 {hover.bar.high.toFixed(2)}</span>
          <span>低 {hover.bar.low.toFixed(2)}</span>
          <span>收 {hover.bar.close.toFixed(2)}</span>
          <span>量 {hover.bar.volume.toLocaleString()}</span>
        </div>
      ) : null}
    </div>
  )
}

export type { KlineBar, KlineEvent, KlineChartOptions, KlineHoverInfo }
export { KlineChart }
