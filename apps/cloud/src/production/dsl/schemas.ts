/**
 * 适配层：DSL schema 真相源在 @trend/contracts（zod-first）。
 * 此处只做两件事：re-export 保持模块符号稳定；把契约校验失败接到 cloud 的 badRequest。
 */

import { badRequest } from '../../errors.js'
import {
  COMPONENT_SPECS,
  DSL_DIRECTIVES,
  DSL_VERSION,
  FIGURE_ID_REF,
  STOCK_CODE,
  checkAttrs as contractCheckAttrs,
  parseBody as contractParseBody,
  type AttrSpec,
  type BodyKind,
  type ComponentSpec,
  type DslDirectiveName,
} from '@trend/contracts'

export { COMPONENT_SPECS, DSL_DIRECTIVES, DSL_VERSION, FIGURE_ID_REF, STOCK_CODE }
export type { AttrSpec, BodyKind, ComponentSpec, DslDirectiveName }

/** 兼容旧符号名：cloud 内部历史上以 FIGURE_ID 指引用侧宽松形。 */
export const FIGURE_ID = FIGURE_ID_REF

const fail = (message: string): never => {
  throw badRequest(message)
}

export function checkAttrs(directive: DslDirectiveName, attrs: Record<string, string>, line: number): void {
  contractCheckAttrs(directive, attrs, line, fail)
}

export function parseBody(directive: DslDirectiveName, bodyLines: string[]): unknown {
  return contractParseBody(directive, bodyLines, fail)
}
