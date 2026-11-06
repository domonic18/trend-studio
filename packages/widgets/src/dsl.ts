/** 正文游程切分（宽容模式）：写入时服务端已严格校验，前端只分段渲染；异常行原样回落 markdown。 */

import type { ArticleSegment } from './types.js'

const DIRECTIVES = new Set(['board', 'bignum', 'cmp', 'timeline', 'warn', 'figure', 'clip', 'annotation', 'replay'])
const OPEN_RE = /^:::([a-z][a-z0-9-]*)(.*)$/
const CLOSE_RE = /^:::\s*$/
const ATTR_RE = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^\s"=]+))/g

export function splitArticle(markdown: string): ArticleSegment[] {
  const segments: ArticleSegment[] = []
  const lines = markdown.split('\n')
  let markdownRun: string[] = []
  let open: { directive: string; attrs: Record<string, string>; bodyLines: string[] } | undefined

  const flushMarkdown = (): void => {
    if (markdownRun.some(line => line.trim() !== '')) {
      segments.push({ kind: 'markdown', text: markdownRun.join('\n') })
    }
    markdownRun = []
  }

  for (const line of lines) {
    if (open === undefined) {
      const match = OPEN_RE.exec(line)
      const directive = match?.[1]
      if (match !== null && directive !== undefined && DIRECTIVES.has(directive)) {
        flushMarkdown()
        open = { directive, attrs: parseAttrs(match[2] ?? ''), bodyLines: [] }
        continue
      }
      markdownRun.push(line)
      continue
    }
    if (CLOSE_RE.test(line)) {
      segments.push({ kind: 'block', directive: open.directive, attrs: open.attrs, bodyLines: open.bodyLines })
      open = undefined
      continue
    }
    open.bodyLines.push(line)
  }

  // 未闭合的块（服务端数据异常）：正文行原样回落，保真展示。
  if (open !== undefined) {
    segments.push({
      kind: 'markdown',
      text: [`:::${open.directive}`, ...open.bodyLines].join('\n'),
    })
  }
  flushMarkdown()
  return segments
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(ATTR_RE)) {
    const key = match[1]
    if (key !== undefined) attrs[key] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

export type InlineAnchor =
  | { kind: 'text'; text: string }
  | { kind: 'stock'; code: string; label: string }
  | { kind: 'unit'; unitId: string; label: string }

/**
 * 切出正文里的内联锚标记。markdown 游程走 react-markdown 链接重写，
 * 而 DSL 块正文是纯文本，需自行识别标记，否则 `[[unit:…]]` 会原样漏出。
 */
export function splitInlineAnchors(text: string): InlineAnchor[] {
  const parts: InlineAnchor[] = []
  let cursor = 0
  for (const match of text.matchAll(/\[\[(stock|unit):([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, index) })
    const label = match[3] ?? ''
    if (match[1] === 'stock') parts.push({ kind: 'stock', code: match[2] ?? '', label })
    else {
      const unitId = match[2] ?? ''
      parts.push({ kind: 'unit', unitId, label: label !== '' ? label : unitId.slice(0, 8) })
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}

/**
 * 内联锚预替换为 react-markdown 可渲染的链接：
 * - `[[stock:code|label]]` → `stock-anchor:code`（个股徽章）
 * - `[[unit:su_xxx|label]]` → `unit-anchor:su_xxx`（证据徽章；label 为空时回退到 unitId 截短）
 */
export function rewriteStockAnchors(text: string): string {
  return text
    .replace(/\[\[stock:([^\]|]*)\|([^\]]*)\]\]/g, (_all, code: string, label: string) => {
      return `[${label}](stock-anchor:${code})`
    })
    .replace(/\[\[unit:([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_all, unitId: string, label?: string) => {
      const text = label !== undefined && label !== '' ? label : unitId.slice(0, 8)
      return `[${text}](unit-anchor:${unitId})`
    })
}
