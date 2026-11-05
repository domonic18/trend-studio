/**
 * 适配层：契约真相源在 @trend/contracts；此处只保留 producer 私有的错误包装。
 * 入参边界：schema 不合法即 bad-request，错误消息直接可回灌。
 */

import type { z } from 'zod'
import { firstIssueDetail } from '@trend/contracts'
import { InputError, InvalidResponseError } from '../errors.js'

export * from '@trend/contracts'

export function parseInput<T extends z.ZodType>(schema: T, value: unknown, label: string): z.output<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new InputError(`${label} 校验失败: ${firstIssueDetail(result.error)}`)
}

/** 出参边界：云端响应不合法整体失败，不静默；属服务侧异常而非入参错误。 */
export function parseOutput<T extends z.ZodType>(schema: T, value: unknown, label: string): z.output<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new InvalidResponseError(`${label} 响应与契约不符: ${firstIssueDetail(result.error)}`)
}
