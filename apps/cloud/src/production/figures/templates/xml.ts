/** SVG 模板共用工具：XML 转义与固定版式常量（架构 §6.6.4，确定性渲染，无外部依赖）。 */

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => XML_ESCAPES[char] ?? char)
}

/** 模板设计尺寸：同时是 figure_candidates 记录的 width/height。 */
export const SVG_WIDTH = 1200
export const SVG_HEIGHT = 675

export const TITLE_FONT = `Georgia, 'Times New Roman', 'Songti SC', serif`
export const BODY_FONT = `-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif`

export const INK = '#1f2733'
export const MUTED = '#5b6472'
export const LINE = '#c9cfd8'
export const ACCENT = '#b03a2e'
export const SURFACE = '#f6f4ef'
export const CARD = '#ffffff'

/** 数字字符串直接转义展示，服务端不做数值格式化（producer 给什么渲染什么）。 */
export function svgOpen(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" role="img">`
}

export function rect(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra === '' ? '' : ` ${extra}`}/>`
}

export function text(x: number, y: number, content: string, attrs: string): string {
  return `<text x="${x}" y="${y}"${attrs === '' ? '' : ` ${attrs}`}>${escapeXml(content)}</text>`
}

/** 定点保留两位小数，避免浮点尾差破坏逐字节一致性。 */
export function n(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}
