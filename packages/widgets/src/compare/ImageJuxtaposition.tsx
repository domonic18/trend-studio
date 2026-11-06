/**
 * image-juxtaposition 渲染器：两图前后对比滑块（架构 §6.6.5）。
 * 两侧各为课程画面（figureId）或确定性合成 K 线；拖动滑块比对，标注与说明文字在下方。
 */

import { useEffect, useMemo, useState } from 'react'
import { generateCandles } from '../engine.js'
import type { GeneratorId, ImageJuxtapositionSpec, JuxtapositionSide } from '../spec-types.js'

export type ResolveFigureUrl = (figureId: string) => Promise<string>

const VIEW_W = 480
const VIEW_H = 260
const PAD = 14

export function ImageJuxtaposition({
  spec,
  resolveFigureUrl,
}: {
  spec: ImageJuxtapositionSpec
  resolveFigureUrl?: ResolveFigureUrl
}) {
  const [pos, setPos] = useState(50)
  const [urls, setUrls] = useState<{ left: string | null; right: string | null }>({ left: null, right: null })

  useEffect(() => {
    if (resolveFigureUrl === undefined) return
    let active = true
    const load = async (side: JuxtapositionSide): Promise<string | null> => {
      if (!('figureId' in side)) return null
      try {
        return await resolveFigureUrl(side.figureId)
      } catch {
        return null
      }
    }
    Promise.all([load(spec.left), load(spec.right)]).then(([left, right]) => {
      if (active) setUrls({ left, right })
    })
    return () => {
      active = false
    }
  }, [spec.left, spec.right, resolveFigureUrl])

  return (
    <figure className="wg-compare">
      <div className="wg-compare-stage">
        <div className="wg-compare-layer">
          <SideView side={spec.left} url={urls.left} />
        </div>
        <div className="wg-compare-layer wg-compare-layer-top" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <SideView side={spec.right} url={urls.right} />
        </div>
        <span className="wg-compare-label wg-compare-label-left">{spec.labels.left}</span>
        <span className="wg-compare-label wg-compare-label-right">{spec.labels.right}</span>
        <span className="wg-compare-handle" style={{ left: `${pos}%` }} />
        <input
          className="wg-compare-range"
          type="range"
          min={0}
          max={100}
          value={pos}
          aria-label="前后对比位置"
          onChange={event => setPos(Number(event.target.value))}
        />
      </div>
      <figcaption className="wg-compare-captions">
        <span className="wg-compare-caption">{spec.captions.left}</span>
        <span className="wg-compare-caption">{spec.captions.right}</span>
      </figcaption>
    </figure>
  )
}

function SideView({ side, url }: { side: JuxtapositionSide; url: string | null }) {
  if ('figureId' in side) {
    if (url === null) return <div className="wg-compare-missing">图示加载中…</div>
    return <img className="wg-compare-img" src={url} alt={side.figureId} />
  }
  return <GeneratedKline generator={side.generator} seed={side.seed} bars={side.bars} />
}

/** 合成 K 线：与课件其它 K 线同源（engine 的确定性生成器），此处只画蜡烛不做交互。 */
function GeneratedKline({ generator, seed, bars }: { generator: GeneratorId; seed: number; bars: number }) {
  const candles = useMemo(() => generateCandles(generator, seed, bars), [generator, seed, bars])
  const { min, max } = useMemo(() => {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const candle of candles) {
      low = Math.min(low, candle.low)
      high = Math.max(high, candle.high)
    }
    const span = high - low || 1
    return { min: low - span * 0.08, max: high + span * 0.08 }
  }, [candles])
  const colW = (VIEW_W - PAD * 2) / candles.length
  const y = (price: number): number => PAD + ((max - price) / (max - min)) * (VIEW_H - PAD * 2)
  return (
    <svg className="wg-compare-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" role="img">
      {candles.map((candle, index) => {
        const color = candle.close >= candle.open ? 'var(--wg-up)' : 'var(--wg-down)'
        const x = PAD + colW * (index + 0.5)
        const top = y(Math.max(candle.open, candle.close))
        const bottom = y(Math.min(candle.open, candle.close))
        return (
          <g key={index}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth={1} />
            <rect
              x={x - colW * 0.32}
              y={top}
              width={Math.max(1, colW * 0.64)}
              height={Math.max(1, bottom - top)}
              fill={color}
            />
          </g>
        )
      })}
    </svg>
  )
}
