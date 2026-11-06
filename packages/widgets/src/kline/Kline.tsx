import * as React from 'react'
import { KlineChart, type KlineBar, type KlineChartOptions, type KlineEvent } from './kline-chart.js'

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
}: KlineProps): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement | null>(null)
  const chartRef = React.useRef<KlineChart | null>(null)

  React.useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return undefined
    const chart = new KlineChart(canvas, {
      windowStart,
      windowEnd,
      overlays,
      onEventClick,
      mode,
      revealCount,
    })
    chartRef.current = chart
    chart.setBars(bars, events, maBars)
    return () => {
      chart.destroy()
      chartRef.current = null
    }
  }, [bars, maBars, events, windowStart, windowEnd, overlays, onEventClick, mode])

  React.useEffect(() => {
    if (mode === 'replay' && chartRef.current !== null && revealCount !== undefined) {
      chartRef.current.setRevealCount(revealCount)
    }
  }, [revealCount, mode])

  return React.createElement('canvas', {
    ref,
    className: 'wg-kline-canvas',
    style: { width: '100%', height: `${height}px`, display: 'block' },
  })
}

export type { KlineBar, KlineEvent, KlineChartOptions }
export { KlineChart }
