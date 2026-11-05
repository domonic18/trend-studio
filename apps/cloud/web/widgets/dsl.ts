/** 正文游程切分（宽容模式）：写入时服务端已严格校验，前端只分段渲染；异常行原样回落 markdown。 */

import type { ArticleSegment } from './types.js'

const DIRECTIVES = new Set(['board', 'bignum', 'cmp', 'timeline', 'warn', 'figure', 'clip'])
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

/** [[stock:code|label]] 预替换为 react-markdown 可渲染的 stock-anchor: 链接。 */
export function rewriteStockAnchors(text: string): string {
  return text.replace(/\[\[stock:([^\]|]*)\|([^\]]*)\]\]/g, (_all, code: string, label: string) => {
    return `[${label}](stock-anchor:${code})`
  })
}
