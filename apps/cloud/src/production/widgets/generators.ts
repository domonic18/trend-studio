/** 确定性 K 线合成与形态归类：同 generator+seed+bars 复算逐字节一致（架构 §6.5.5 v1）。 */

export interface Candle {
  open: number
  high: number
  low: number
  close: number
}

export const GENERATORS = [
  'uptrend',
  'downtrend',
  'range',
  'uptrend-platform',
  'downtrend-platform',
] as const
export type GeneratorId = (typeof GENERATORS)[number]

export function isGeneratorId(value: string): value is GeneratorId {
  return (GENERATORS as readonly string[]).includes(value)
}

/** mulberry32：种子化 PRNG，跨进程可复现。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + (Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_PRICE = 100
const TREND_TOTAL = 0.25
const PLATEAU_BOUNDARY = 0.6
const RANGE_WAVE = 0.025

export function generateCandles(generator: GeneratorId, seed: number, bars: number): Candle[] {
  const random = mulberry32(seed)
  const phase = random() * Math.PI * 2
  const trendDrift = Math.pow(1 + TREND_TOTAL, 1 / bars) - 1
  const boundary = Math.floor(bars * PLATEAU_BOUNDARY)
  const direction = generator === 'downtrend' || generator === 'downtrend-platform' ? -1 : 1
  const candles: Candle[] = []
  let close = BASE_PRICE
  let plateau = BASE_PRICE
  for (let index = 0; index < bars; index += 1) {
    const noise = (random() - 0.5) * 0.016
    let open: number
    if (generator === 'range') {
      // 锚定均值回归，不做随机游走：全程漂移始终远小于归类阈值。
      const wave = Math.sin(phase + index / 4.5) * RANGE_WAVE
      open = BASE_PRICE * (1 + wave + noise * 0.5)
      close = open * (1 + noise * 0.4)
    } else {
      const trending = generator === 'uptrend' || generator === 'downtrend' || index < boundary
      let drift: number
      if (trending) {
        drift = direction * trendDrift
      } else {
        if (index === boundary) plateau = close
        // 平台段锚定起点价格，避免噪声游走把尾段漂移推过归类阈值。
        close = plateau
        drift = 0
      }
      open = close
      close = open * (1 + drift + noise)
    }
    const spread = random() * 0.004 + 0.001
    const high = Math.max(open, close) * (1 + spread)
    const low = Math.min(open, close) * (1 - spread)
    candles.push({ open, high, low, close })
  }
  return candles
}

export function atr(candles: Candle[]): number {
  let sum = 0
  let previousClose = candles[0]?.close ?? 0
  for (const bar of candles) {
    sum += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    )
    previousClose = bar.close
  }
  return candles.length === 0 ? 0 : sum / candles.length
}

export interface Trendline {
  startIdx: number
  endIdx: number
}

/**
 * 趋势线锚定两根 K 线低点。角度按「数据适配视图」定义：
 * 价格轴以全序列 high-low 归一、时间轴以总 bar 数归一后求 atan——
 * 即该趋势线在实际图表上呈现的视觉角度，与画图直觉一致（水平 ≈0°，45° = 每 bar 走一个价格区间）。
 */
export function trendlineAt(candles: Candle[], line: Trendline): {
  priceAt(index: number): number
  angleDeg: number
} {
  const lowStart = candles[line.startIdx]?.low
  const lowEnd = candles[line.endIdx]?.low
  if (lowStart === undefined || lowEnd === undefined) {
    throw new Error('trendline anchors out of range')
  }
  const slope = (lowEnd - lowStart) / (line.endIdx - line.startIdx)
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  for (const bar of candles) {
    high = Math.max(high, bar.high)
    low = Math.min(low, bar.low)
  }
  const priceRange = high - low
  const normalizedSlope = priceRange > 0
    ? (slope * candles.length) / priceRange
    : 0
  return {
    priceAt: (index: number) => lowStart + slope * (index - line.startIdx),
    angleDeg: (Math.atan(normalizedSlope) * 180) / Math.PI,
  }
}

export function countTrendlineTouches(candles: Candle[], line: Trendline, toleranceAtr = 0.5): number {
  const { priceAt } = trendlineAt(candles, line)
  const tolerance = atr(candles) * toleranceAtr
  let touches = 0
  for (let index = line.startIdx; index <= line.endIdx; index += 1) {
    const bar = candles[index]
    if (bar === undefined) continue
    const price = priceAt(index)
    if (price >= bar.low - tolerance && price <= bar.high + tolerance) {
      touches += 1
    }
  }
  return touches
}

export function closesHoldAbove(candles: Candle[], line: Trendline, epsilon = 1e-6): boolean {
  const { priceAt } = trendlineAt(candles, line)
  return candles.every((bar, index) => bar.close >= priceAt(index) - epsilon)
}

/**
 * 形态归类：总漂移定趋势方向，尾段（自 65% 起）漂移≈0 定平台。
 * 生成器漂移与噪声设计保证每族输出稳定落入本族，干扰项归类互异可被程序验证。
 */
export function classifyShape(candles: Candle[]): GeneratorId {
  const bars = candles.length
  const first = candles[0]?.close
  const tailAnchor = candles[Math.floor(bars * 0.65)]?.close
  const last = candles[bars - 1]?.close
  if (bars < 2 || first === undefined || tailAnchor === undefined || last === undefined) return 'range'
  const driftTotal = (last - first) / first
  const driftTail = (last - tailAnchor) / tailAnchor
  const trend = driftTotal >= 0.06 ? 'uptrend' : driftTotal <= -0.06 ? 'downtrend' : 'range'
  if (trend === 'range') return 'range'
  const platform = Math.abs(driftTail) <= 0.02
  if (trend === 'uptrend') return platform ? 'uptrend-platform' : 'uptrend'
  return platform ? 'downtrend-platform' : 'downtrend'
}
