/** 适配层：语义校验真相源在 @trend/contracts；此处绑定 cloud 错误形状，保持模块签名稳定。 */

import { validateArticleDsl as contractValidateArticleDsl, type DslParseResult, type DslUnitRef, type DslValidateCtx } from '@trend/contracts'
import { cloudDslSink } from './sink.js'

export type { DslUnitRef, DslValidateCtx }

export async function validateArticleDsl(parsed: DslParseResult, ctx: DslValidateCtx): Promise<void> {
  await contractValidateArticleDsl(parsed, ctx, cloudDslSink)
}
