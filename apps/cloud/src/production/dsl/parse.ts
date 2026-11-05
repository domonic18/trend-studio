/** 富文本 DSL v1 容器块行扫描器（架构 §6.6.1 冻结）：解析不查库，语义校验在 validate.ts。 */

import { badRequest } from '../../errors.js'
import { DSL_DIRECTIVES } from './schemas.js'

export interface DslBlock {
  directive: string
  attrs: Record<string, string>
  /** body 原始行（未 trim，空 body 为空数组）。 */
  bodyLines: string[]
  /** 起始行号（1 基）。 */
  line: number
}

export interface StockAnchor {
  code: string
  label: string
  line: number
}

export interface DslParseResult {
  blocks: DslBlock[]
  anchors: StockAnchor[]
}

const OPEN_RE = /^:::([a-z][a-z0-9-]*)(.*)$/
const CLOSE_RE = /^:::\s*$/
const ATTR_RE = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^\s"=]+))/g
const ANCHOR_RE = /\[\[stock:([^\]|]*)(?:\|([^\]]*))?\]\]/g

export function parseArticleDsl(markdown: string): DslParseResult {
  const blocks: DslBlock[] = []
  const anchors: StockAnchor[] = []
  const lines = markdown.split('\n')
  let open: { block: DslBlock } | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (CLOSE_RE.test(line)) {
      if (open === undefined) throw badRequest(`dsl: unexpected closing ':::' at line ${index + 1}`)
      blocks.push(open.block)
      open = undefined
      continue
    }
    const openMatch = OPEN_RE.exec(line)
    if (openMatch !== null) {
      if (open !== undefined) {
        throw badRequest(`dsl: nested container at line ${index + 1} (inside '${open.block.directive}' opened at line ${open.block.line})`)
      }
      const directive = openMatch[1]
      if (directive === undefined || !(DSL_DIRECTIVES as readonly string[]).includes(directive)) {
        throw badRequest(`dsl: unknown directive '${directive ?? ''}' at line ${index + 1}`)
      }
      open = { block: { directive, attrs: parseAttrs(openMatch[2] ?? '', index + 1), bodyLines: [], line: index + 1 } }
      continue
    }
    if (open !== undefined) {
      open.block.bodyLines.push(line)
      continue
    }
    collectAnchors(line, index + 1, anchors)
  }
  if (open !== undefined) {
    throw badRequest(`dsl: container '${open.block.directive}' opened at line ${open.block.line} is not closed`)
  }
  return { blocks, anchors }
}

function parseAttrs(raw: string, lineNo: number): Record<string, string> {
  if (raw.trim() === '') return {}
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const key = match[1]
    if (key === undefined) continue
    if (key in attrs) throw badRequest(`dsl: duplicate attribute '${key}' at line ${lineNo}`)
    attrs[key] = match[2] ?? match[3] ?? ''
  }
  ATTR_RE.lastIndex = 0
  const leftover = raw.replace(ATTR_RE, '').trim()
  if (leftover !== '') throw badRequest(`dsl: malformed attribute '${leftover}' at line ${lineNo}`)
  return attrs
}

function collectAnchors(line: string, lineNo: number, anchors: StockAnchor[]): void {
  const opens = (line.match(/\[\[stock:/g) ?? []).length
  if (opens === 0) return
  ANCHOR_RE.lastIndex = 0
  const found: StockAnchor[] = []
  let match: RegExpExecArray | null
  while ((match = ANCHOR_RE.exec(line)) !== null) {
    found.push({ code: match[1] ?? '', label: match[2] ?? '', line: lineNo })
  }
  ANCHOR_RE.lastIndex = 0
  if (found.length !== opens) throw badRequest(`dsl: malformed stock anchor at line ${lineNo}`)
  anchors.push(...found)
}
