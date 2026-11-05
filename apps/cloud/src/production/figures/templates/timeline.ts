/** timeline：阶段推进时间轴——水平轴节点 + 日期/标题标签（3–8 事件）。 */

import { z } from 'zod'
import { badRequest } from '../../../errors.js'
import {
  ACCENT, BODY_FONT, INK, LINE, MUTED, SVG_HEIGHT, SVG_WIDTH, SURFACE, TITLE_FONT,
  rect, svgOpen, text,
} from './xml.js'

export const timelineParams = z.strictObject({
  title: z.string().trim().min(1).max(50).optional(),
  events: z.array(z.strictObject({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    title: z.string().trim().min(1).max(50),
    desc: z.string().trim().min(1).max(120).optional(),
  })).min(3).max(8),
})

export type TimelineParams = z.infer<typeof timelineParams>

export function renderTimeline(input: unknown): string {
  const parsed = timelineParams.safeParse(input)
  if (!parsed.success) {
    throw badRequest(`figure template 'timeline' params invalid: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const params = parsed.data
  const parts: string[] = [svgOpen()]
  parts.push(rect(0, 0, SVG_WIDTH, SVG_HEIGHT, SURFACE))
  if (params.title !== undefined) {
    parts.push(text(60, 78, params.title, `font-family="${TITLE_FONT}" font-size="34" font-weight="700" fill="${INK}"`))
  }
  const axisY = SVG_HEIGHT / 2
  const left = 100
  const right = SVG_WIDTH - 100
  parts.push(`<line x1="${left - 30}" y1="${axisY}" x2="${right + 30}" y2="${axisY}" stroke="${LINE}" stroke-width="2"/>`)
  const count = params.events.length
  const step = (right - left) / (count - 1)
  params.events.forEach((event, index) => {
    const x = left + index * step
    const above = index % 2 === 0
    parts.push(`<circle cx="${x}" cy="${axisY}" r="9" fill="${above ? ACCENT : INK}"/>`)
    const dateY = above ? axisY - 96 : axisY + 126
    const titleY = above ? axisY - 66 : axisY + 156
    const descY = above ? axisY - 40 : axisY + 182
    parts.push(text(x, dateY, event.date, `font-family="${BODY_FONT}" font-size="16" fill="${MUTED}" text-anchor="middle"`))
    parts.push(text(x, titleY, event.title, `font-family="${BODY_FONT}" font-size="19" font-weight="600" fill="${INK}" text-anchor="middle"`))
    if (event.desc !== undefined) {
      parts.push(text(x, descY, event.desc.length > 24 ? `${event.desc.slice(0, 23)}…` : event.desc, `font-family="${BODY_FONT}" font-size="14" fill="${MUTED}" text-anchor="middle"`))
    }
    parts.push(`<line x1="${x}" y1="${axisY + (above ? -12 : 12)}" x2="${x}" y2="${titleY + (above ? 14 : -30)}" stroke="${LINE}" stroke-width="1"/>`)
  })
  parts.push('</svg>')
  return parts.join('')
}
