/**
 * 富文本 DSL v1 容器块行扫描器（架构 §6.6.1 冻结）：解析不查库，语义校验在 dsl-validate。
 * 校验失败经注入的错误池抛出（消息文本是跨端契约的一部分，禁止改写）。
 */

import { DSL_DIRECTIVES } from './enums.js'
import { dslVersionOf } from './dsl.js'
import type { DslErrorSink } from './errors-sink.js'

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

export interface UnitAnchor {
  unitId: string
  /** 可空；为空时渲染端回退到 unitId 截短显示。 */
  label: string
  line: number
}

export interface DslParseResult {
  blocks: DslBlock[]
  anchors: StockAnchor[]
  unitAnchors: UnitAnchor[]
}

const OPEN_RE = /^:::([a-z][a-z0-9-]*)(.*)$/
const CLOSE_RE = /^:::\s*$/
const ATTR_RE = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^\s"=]+))/g
const STOCK_ANCHOR_RE = /\[\[stock:([^\]|]*)(?:\|([^\]]*))?\]\]/g
const UNIT_ANCHOR_RE = /\[\[unit:([^\]|]*)(?:\|([^\]]*))?\]\]/g

export function parseArticleDsl(markdown: string, sink: DslErrorSink): DslParseResult {
  const blocks: DslBlock[] = []
  const anchors: StockAnchor[] = []
  const unitAnchors: UnitAnchor[] = []
  const lines = markdown.split('\n')
  let open: { block: DslBlock } | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (CLOSE_RE.test(line)) {
      if (open === undefined) sink.bad(`dsl: unexpected closing ':::' at line ${index + 1}`)
      blocks.push(open.block)
      open = undefined
      continue
    }
    const openMatch = OPEN_RE.exec(line)
    if (openMatch !== null) {
      if (open !== undefined) {
        sink.bad(`dsl: nested container at line ${index + 1} (inside '${open.block.directive}' opened at line ${open.block.line})`)
      }
      const directive = openMatch[1]
      if (directive === undefined || !(DSL_DIRECTIVES as readonly string[]).includes(directive)) {
        sink.bad(`dsl: unknown directive '${directive ?? ''}' at line ${index + 1}`)
      }
      open = { block: { directive, attrs: parseAttrs(openMatch[2] ?? '', index + 1, sink), bodyLines: [], line: index + 1 } }
      continue
    }
    if (open !== undefined) {
      open.block.bodyLines.push(line)
      continue
    }
    collectInlineAnchors(line, index + 1, 'stock', STOCK_ANCHOR_RE, anchors, sink,
      (code, label, line): StockAnchor => ({ code, label, line }))
    collectInlineAnchors(line, index + 1, 'unit', UNIT_ANCHOR_RE, unitAnchors, sink,
      (unitId, label, line): UnitAnchor => ({ unitId, label, line }))
  }
  if (open !== undefined) {
    sink.bad(`dsl: container '${open.block.directive}' opened at line ${open.block.line} is not closed`)
  }
  return { blocks, anchors, unitAnchors }
}

/** 正文实际用到的 DSL 组件版本（纯 v1 正文=1，含 annotation/replay=2）。 */
export function markdownDslVersion(markdown: string, sink: DslErrorSink): number {
  const parsed = parseArticleDsl(markdown, sink)
  return dslVersionOf(parsed.blocks.map(block => block.directive))
}

function parseAttrs(raw: string, lineNo: number, sink: DslErrorSink): Record<string, string> {
  if (raw.trim() === '') return {}
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const key = match[1]
    if (key === undefined) continue
    if (key in attrs) sink.bad(`dsl: duplicate attribute '${key}' at line ${lineNo}`)
    attrs[key] = match[2] ?? match[3] ?? ''
  }
  ATTR_RE.lastIndex = 0
  const leftover = raw.replace(ATTR_RE, '').trim()
  if (leftover !== '') sink.bad(`dsl: malformed attribute '${leftover}' at line ${lineNo}`)
  return attrs
}

function collectInlineAnchors<T extends { line: number }>(
  line: string,
  lineNo: number,
  name: 'stock' | 'unit',
  re: RegExp,
  out: T[],
  sink: DslErrorSink,
  make: (id: string, label: string, line: number) => T,
): void {
  const marker = `[[${name}:`
  const opens = line.split(marker).length - 1
  if (opens === 0) return
  re.lastIndex = 0
  const found: T[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    found.push(make(match[1] ?? '', match[2] ?? '', lineNo))
  }
  re.lastIndex = 0
  if (found.length !== opens) sink.bad(`dsl: malformed ${name} anchor at line ${lineNo}`)
  out.push(...found)
}
