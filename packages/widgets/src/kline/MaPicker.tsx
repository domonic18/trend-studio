import { MA_PERIODS } from './kline-chart.js'

/** 均线叠加选择器：M5/M10/M20/M30/M60 即开即关，图表画线与图例随之变化。 */
export function MaPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="wg-ma-picker">
      {MA_PERIODS.map(period => {
        const label = `M${period}`
        const active = value.includes(label)
        return (
          <button
            key={label}
            type="button"
            className={`wg-ma-chip${active ? ' active' : ''}`}
            aria-pressed={active}
            onClick={() =>
              onChange(active ? value.filter(item => item !== label) : [...value, label])
            }
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
