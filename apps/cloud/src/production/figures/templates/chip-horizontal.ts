/** chip-horizontal：横线筹码示意——峰列表按价位画水平线，长度映射筹码占比。 */

import { z } from 'zod'
import { badRequest } from '../../../errors.js'
import {
  ACCENT, BODY_FONT, CARD, INK, LINE, MUTED, SVG_HEIGHT, SVG_WIDTH, SURFACE, TITLE_FONT,
  n, rect, svgOpen, text,
} from './xml.js'

export const chipHorizontalParams = z.strictObject({
  title: z.string().trim().min(1).max(50).optional(),
  peaks: z.array(z.strictObject({
    label: z.string().trim().min(1).max(30),
    price: z.string().trim().min(1).max(16),
    weightPct: z.number().min(1).max(100),
  })).min(1).max(4),
})

export type ChipHorizontalParams = z.infer<typeof chipHorizontalParams>

export function renderChipHorizontal(input: unknown): string {
  const parsed = chipHorizontalParams.safeParse(input)
  if (!parsed.success) {
    throw badRequest(`figure template 'chip-horizontal' params invalid: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const params = parsed.data
  const parts: string[] = [svgOpen()]
  parts.push(rect(0, 0, SVG_WIDTH, SVG_HEIGHT, SURFACE))
  if (params.title !== undefined) {
    parts.push(text(60, 78, params.title, `font-family="${TITLE_FONT}" font-size="34" font-weight="700" fill="${INK}"`))
  }
  const count = params.peaks.length
  const top = params.title === undefined ? 90 : 150
  const rowH = Math.min(110, Math.floor((SVG_HEIGHT - top - 70) / count))
  params.peaks.forEach((peak, index) => {
    const y = top + index * rowH
    parts.push(rect(60, y, SVG_WIDTH - 120, rowH - 18, CARD, `stroke="${LINE}" stroke-width="1"`))
    parts.push(text(88, y + (rowH - 18) / 2 + 9, peak.label, `font-family="${BODY_FONT}" font-size="20" font-weight="600" fill="${INK}"`))
    parts.push(text(88, y + (rowH - 18) / 2 + 34, peak.price, `font-family="${BODY_FONT}" font-size="15" fill="${MUTED}"`))
    const barX = 420
    const barW = Math.max(360 * peak.weightPct / 100, 24)
    const barY = y + (rowH - 18) / 2 - 7
    parts.push(rect(barX, barY, barW, 14, index === 0 ? ACCENT : INK))
    parts.push(text(barX + barW + 16, barY + 12, `${n(peak.weightPct)}%`, `font-family="${BODY_FONT}" font-size="16" fill="${MUTED}"`))
  })
  parts.push('</svg>')
  return parts.join('')
}
