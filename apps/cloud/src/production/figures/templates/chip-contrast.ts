/** chip-contrast：密集 vs 发散筹码分布双栏对照（峰形 + 峰位/峰宽/离散度数据格）。 */

import { z } from 'zod'
import { badRequest } from '../../../errors.js'
import {
  ACCENT, BODY_FONT, CARD, INK, LINE, MUTED, SVG_HEIGHT, SVG_WIDTH, SURFACE, TITLE_FONT,
  n, rect, svgOpen, text,
} from './xml.js'

export const chipContrastParams = z.strictObject({
  title: z.string().trim().min(1).max(50).optional(),
  left: z.strictObject({
    head: z.string().trim().min(1).max(20),
    peakPrice: z.string().trim().min(1).max(16),
    peakWidthPct: z.number().min(0).max(100),
    dispersionPct: z.number().min(0).max(100),
    note: z.string().trim().min(1).max(100).optional(),
  }),
  right: z.strictObject({
    head: z.string().trim().min(1).max(20),
    peakPrice: z.string().trim().min(1).max(16),
    peakWidthPct: z.number().min(0).max(100),
    dispersionPct: z.number().min(0).max(100),
    note: z.string().trim().min(1).max(100).optional(),
  }),
})

export type ChipContrastParams = z.infer<typeof chipContrastParams>

/** 峰形用对称矩形条逼近：占比越高条越宽，峰宽百分比直接映射横向跨度。 */
function peakBars(x: number, y: number, w: number, h: number, peakWidthPct: number, fill: string): string {
  const bars = 9
  const barH = h / bars
  const mid = x + w / 2
  const maxSpan = w * Math.max(0.12, peakWidthPct / 100)
  const parts: string[] = []
  for (let index = 0; index < bars; index += 1) {
    const ratio = 1 - Math.abs(index - (bars - 1) / 2) / ((bars - 1) / 2 + 0.001)
    const span = maxSpan * (0.25 + 0.75 * ratio)
    parts.push(rect(mid - span / 2, y + index * barH, span, barH * 0.72, fill))
  }
  return parts.join('')
}

function dataCell(x: number, y: number, label: string, value: string): string {
  return [
    text(x, y + 18, label, `font-family="${BODY_FONT}" font-size="17" fill="${MUTED}"`),
    text(x, y + 48, value, `font-family="${BODY_FONT}" font-size="26" font-weight="600" fill="${INK}"`),
  ].join('')
}

export function renderChipContrast(input: unknown): string {
  const parsed = chipContrastParams.safeParse(input)
  if (!parsed.success) {
    throw badRequest(`figure template 'chip-contrast' params invalid: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const params = parsed.data
  const parts: string[] = [svgOpen()]
  parts.push(rect(0, 0, SVG_WIDTH, SVG_HEIGHT, SURFACE))
  if (params.title !== undefined) {
    parts.push(text(60, 78, params.title, `font-family="${TITLE_FONT}" font-size="34" font-weight="700" fill="${INK}"`))
  }
  const panelY = params.title === undefined ? 70 : 130
  const panelW = 505
  const panelH = 330
  const panels = [
    { side: params.left, x: 60, fill: INK },
    { side: params.right, x: SVG_WIDTH - 60 - panelW, fill: ACCENT },
  ]
  for (const panel of panels) {
    parts.push(rect(panel.x, panelY, panelW, panelH, CARD, `stroke="${LINE}" stroke-width="1"`))
    parts.push(text(panel.x + 24, panelY + 40, panel.side.head, `font-family="${BODY_FONT}" font-size="21" font-weight="600" fill="${INK}"`))
    parts.push(peakBars(panel.x + 24, panelY + 66, panelW - 48, 150, panel.side.peakWidthPct, panel.fill))
    if (panel.side.note !== undefined) {
      parts.push(text(panel.x + 24, panelY + 252, panel.side.note, `font-family="${BODY_FONT}" font-size="15" fill="${MUTED}"`))
    }
  }
  const gridY = panelY + panelH + 46
  const cells = [
    { x: 60, label: '峰位（左）', value: params.left.peakPrice },
    { x: 460, label: '峰位（右）', value: params.right.peakPrice },
    { x: 860, label: '峰宽 / 离散度（左）', value: `${n(params.left.peakWidthPct)}% / ${n(params.left.dispersionPct)}%` },
  ]
  for (const cell of cells) parts.push(dataCell(cell.x, gridY, cell.label, cell.value))
  parts.push(text(860, gridY + 92, `峰宽 / 离散度（右）：${n(params.right.peakWidthPct)}% / ${n(params.right.dispersionPct)}%`, `font-family="${BODY_FONT}" font-size="15" fill="${MUTED}"`))
  parts.push('</svg>')
  return parts.join('')
}
