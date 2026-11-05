/** 参数化 SVG 模板注册表（架构 §6.6.4 白名单 v1，2026-11-05 冻结）：同参数逐字节一致。 */

import { badRequest } from '../../../errors.js'
import { chipContrastParams, renderChipContrast } from './chip-contrast.js'
import { chipHorizontalParams, renderChipHorizontal } from './chip-horizontal.js'
import { renderStatInline, statInlineParams } from './stat-inline.js'
import { renderTimeline, timelineParams } from './timeline.js'
import { SVG_HEIGHT, SVG_WIDTH } from './xml.js'

export const TEMPLATE_NAMES = ['chip-contrast', 'chip-horizontal', 'timeline', 'stat-inline'] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]

interface TemplateEntry {
  render: (input: unknown) => string
  paramsSchema: unknown
}

const TEMPLATES: Record<TemplateName, TemplateEntry> = {
  'chip-contrast': { render: renderChipContrast, paramsSchema: chipContrastParams },
  'chip-horizontal': { render: renderChipHorizontal, paramsSchema: chipHorizontalParams },
  timeline: { render: renderTimeline, paramsSchema: timelineParams },
  'stat-inline': { render: renderStatInline, paramsSchema: statInlineParams },
}

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value)
}

export interface RenderedDiagram {
  svg: string
  width: number
  height: number
}

/** 云端复检入口：模板存在 + 参数过 zod + 确定性出 SVG。 */
export function renderTemplate(template: string, params: unknown): RenderedDiagram {
  if (!isTemplateName(template)) {
    throw badRequest(`figure template '${template}' is not in the frozen whitelist`)
  }
  return { svg: TEMPLATES[template].render(params), width: SVG_WIDTH, height: SVG_HEIGHT }
}

export { chipContrastParams, chipHorizontalParams, statInlineParams, timelineParams }
