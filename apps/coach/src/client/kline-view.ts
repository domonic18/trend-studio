import * as React from 'react'
import { KlineChart, type KlineBar } from './kline.js'

/** K 线画布容器：图表类自行管理画布尺寸与事件，组件只负责挂载与销毁。 */
export function KlineView({
  bars,
  height = 220,
}: {
  bars: KlineBar[]
  height?: number
}): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return undefined
    const chart = new KlineChart(canvas)
    chart.setBars(bars)
    return () => chart.destroy()
  }, [bars])

  return React.createElement('canvas', {
    ref,
    style: { width: '100%', height: `${height}px`, display: 'block' },
  })
}
