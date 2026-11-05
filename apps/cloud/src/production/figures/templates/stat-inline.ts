/** stat-inline：大数字卡内嵌迷你图——左数值右 sparkline（line 折线 / bar 柱状）。 */

import { z } from 'zod'
import { badRequest } from '../../../errors.js'
import {
  ACCENT, BODY_FONT, INK, MUTED, SVG_HEIGHT, SVG_WIDTH, SURFACE, TITLE_FONT,
  n, rect, svgOpen, text,
} from './xml.js'

export const statInlineParams = z.strictObject({
  label: z.string().trim().min(1).max(30),
  value: z.string().trim().min(1).max(20),
  unit: z.string().trim().min(1).max(10).optional(),
  note: z.string().trim().min(1).max(100).optional(),
  spark: z.strictObject({
    kind: z.enum(['line', 'bar']),
    points: z.array(z.number().finite()).min(2).max(24),
  }),
})

export type StatInlineParams = z.infer<typeof statInlineParams>

function sparkline(x: number, y: number, w: number, h: number, kind: 'line' | 'bar', points: number[]): string {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const parts: string[] = []
  if (kind === 'bar') {
    const barW = w / points.length * 0.6
    points.forEach((point, index) => {
      const barH = Math.max(4, (point - min) / span * (h - 8) + 8)
      parts.push(rect(x + (index + 0.2) * (w / points.length), y + h - barH, barW, barH, ACCENT))
    })
    return parts.join('')
  }
  const coords = points.map((point, index) => {
    const px = x + index * (w / (points.length - 1))
    const py = y + h - 8 - (point - min) / span * (h - 16)
    return `${n(px)},${n(py)}`
  })
  parts.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`)
  const [lastX, lastY] = coords[coords.length - 1]?.split(',') ?? ['0', '0']
  parts.push(`<circle cx="${lastX}" cy="${lastY}" r="5" fill="${ACCENT}"/>`)
  return parts.join('')
}

export function renderStatInline(input: unknown): string {
  const parsed = statInlineParams.safeParse(input)
  if (!parsed.success) {
    throw badRequest(`figure template 'stat-inline' params invalid: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const params = parsed.data
  const parts: string[] = [svgOpen()]
  parts.push(rect(0, 0, SVG_WIDTH, SVG_HEIGHT, SURFACE))
  parts.push(text(80, 150, params.label, `font-family="${BODY_FONT}" font-size="26" fill="${MUTED}"`))
  const valueText = params.unit === undefined ? params.value : `${params.value} ${params.unit}`
  parts.push(text(80, 280, valueText, `font-family="${TITLE_FONT}" font-size="110" font-weight="700" fill="${INK}"`))
  if (params.note !== undefined) {
    parts.push(text(80, 348, params.note, `font-family="${BODY_FONT}" font-size="19" fill="${MUTED}"`))
  }
  parts.push(sparkline(660, 150, 460, 300, params.spark.kind, params.spark.points))
  parts.push('</svg>')
  return parts.join('')
}
