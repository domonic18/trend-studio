/**
 * 富文本 DSL v1 组件 schema（架构 §6.6.1 冻结）：属性白名单 + 结构化 body zod 逐组件校验。
 * 校验失败经注入的 fail 抛出（消息文本是跨端契约的一部分，禁止改写）。
 */

import { z } from 'zod'
import { ASSET_ID, FIGURE_ID_REF, SOURCE_UNIT_ID, STOCK_CODE } from './ids.js'
import { DSL_DIRECTIVES, type DslDirectiveName } from './enums.js'

export const DSL_VERSION = 1

export type BodyKind = 'text' | 'json' | 'empty'

export interface AttrSpec {
  key: string
  required: boolean
  pattern?: RegExp
  /** 整数属性界（含）。 */
  min?: number
  max?: number
  codePointMax?: number
  enum?: readonly string[]
}

export interface ComponentSpec {
  attrs: readonly AttrSpec[]
  body: BodyKind
  /** text body 的码点长度界。 */
  textBody?: { min: number; max: number }
  bodySchema?: z.ZodType
}

const unitIdAttr: AttrSpec = { key: 'unitId', required: true, pattern: SOURCE_UNIT_ID }

export const COMPONENT_SPECS: Record<DslDirectiveName, ComponentSpec> = {
  board: {
    attrs: [unitIdAttr],
    body: 'text',
    textBody: { min: 1, max: 500 },
  },
  bignum: {
    attrs: [],
    body: 'json',
    bodySchema: z.strictObject({
      items: z.array(z.strictObject({
        label: z.string().trim().min(1).max(50),
        value: z.string().trim().min(1).max(50),
        note: z.string().trim().min(1).max(100).optional(),
      })).min(1).max(3),
    }),
  },
  cmp: {
    attrs: [{ key: 'mode', required: false, enum: ['card', 'table'] }],
    body: 'json',
    bodySchema: z.strictObject({
      title: z.string().trim().min(1).max(100).optional(),
      left: cmpSide(),
      right: cmpSide(),
    }),
  },
  timeline: {
    attrs: [],
    body: 'json',
    bodySchema: z.strictObject({
      events: z.array(z.strictObject({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
        title: z.string().trim().min(1).max(100),
        desc: z.string().trim().min(1).max(200).optional(),
      })).min(3).max(8),
    }),
  },
  warn: {
    attrs: [{ key: 'title', required: true, codePointMax: 50 }],
    body: 'text',
    textBody: { min: 1, max: 500 },
  },
  figure: {
    attrs: [
      { key: 'figureId', required: true, pattern: FIGURE_ID_REF },
      { key: 'caption', required: true, codePointMax: 200 },
      { key: 'unitId', required: false, pattern: SOURCE_UNIT_ID },
    ],
    body: 'empty',
  },
  clip: {
    attrs: [
      { key: 'assetId', required: true, pattern: ASSET_ID },
      { key: 'from', required: true, min: 0, max: 86_400 },
      { key: 'to', required: true, min: 1, max: 86_400 },
      { key: 'caption', required: true, codePointMax: 200 },
      unitIdAttr,
    ],
    body: 'empty',
  },
}

function cmpSide(): z.ZodType {
  return z.strictObject({
    head: z.string().trim().min(1).max(50),
    items: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  })
}

/** 失败通道：宿主注入（cloud 传 badRequest，producer 传自家入参错误），消息原样透传。 */
export type DslFail = (message: string) => never

/** 属性白名单与类型校验；越界/未知属性一律拒绝（沿用「边界即防线」）。 */
export function checkAttrs(directive: DslDirectiveName, attrs: Record<string, string>, line: number, fail: DslFail): void {
  const spec = COMPONENT_SPECS[directive]
  const known = new Set(spec.attrs.map(attr => attr.key))
  for (const key of Object.keys(attrs)) {
    if (!known.has(key)) fail(`dsl: attribute '${key}' is not allowed on :::${directive} (line ${line})`)
  }
  for (const attr of spec.attrs) {
    const value = attrs[attr.key]
    if (value === undefined) {
      if (attr.required) fail(`dsl: attribute '${attr.key}' is required on :::${directive} (line ${line})`)
      continue
    }
    if (attr.enum !== undefined && !attr.enum.includes(value)) {
      fail(`dsl: attribute '${attr.key}' must be one of ${attr.enum.join('|')} (line ${line})`)
    }
    if (attr.pattern !== undefined && !attr.pattern.test(value)) {
      fail(`dsl: attribute '${attr.key}' invalid (line ${line})`)
    }
    if (attr.min !== undefined || attr.max !== undefined) {
      const num = Number(value)
      if (!/^\d+$/.test(value) || !Number.isInteger(num)
        || num < (attr.min ?? 0) || num > (attr.max ?? Number.MAX_SAFE_INTEGER)) {
        fail(`dsl: attribute '${attr.key}' must be an integer between ${attr.min} and ${attr.max} (line ${line})`)
      }
    }
    if (attr.codePointMax !== undefined) {
      const length = [...value].length
      if (length < 1 || length > attr.codePointMax) {
        fail(`dsl: attribute '${attr.key}' must be 1–${attr.codePointMax} characters (line ${line})`)
      }
    }
  }
}

/** 解析并校验 body；text 返回原文、json 返回解析对象、empty 返回 undefined。 */
export function parseBody(directive: DslDirectiveName, bodyLines: string[], fail: DslFail): unknown {
  const spec = COMPONENT_SPECS[directive]
  const raw = bodyLines.join('\n').trim()
  if (spec.body === 'empty') {
    if (raw !== '') fail(`dsl: :::${directive} body must be empty`)
    return undefined
  }
  if (spec.body === 'text') {
    const bounds = spec.textBody ?? { min: 1, max: 500 }
    const length = [...raw].length
    if (length < bounds.min || length > bounds.max) {
      fail(`dsl: :::${directive} body must be ${bounds.min}–${bounds.max} characters`)
    }
    return raw
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(`dsl: :::${directive} body must be a single JSON object`)
  }
  const schema = spec.bodySchema
  if (schema === undefined) return parsed
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue === undefined ? '' : ` at '${issue.path.join('.')}'`
    fail(`dsl: :::${directive} body invalid${path}: ${issue?.message ?? 'schema mismatch'}`)
  }
  return result.data
}
