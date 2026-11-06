import * as React from 'react'
import { Kline, type KlineBar } from '@trend/widgets/kline'

/** 学员端历史入口：直接转发 widgets 的 Kline 组件。 */
export function KlineView({
  bars,
  height = 220,
}: {
  bars: KlineBar[]
  height?: number
}): React.ReactElement {
  return React.createElement(Kline, { bars, height })
}
