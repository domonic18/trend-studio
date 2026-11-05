import { badRequest, codedBadRequest } from '../../errors.js'
import type { DslErrorSink } from '@trend/contracts'

/** 把契约校验失败接到 cloud 的 HTTP 错误形状（消息与错误码原样透传）。 */
export const cloudDslSink: DslErrorSink = {
  bad: (message) => {
    throw badRequest(message)
  },
  coded: (code, message, details) => {
    throw codedBadRequest(code, message, details)
  },
}
