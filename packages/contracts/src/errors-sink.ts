/** DSL 校验失败通道：宿主注入（cloud 接 badRequest/codedBadRequest，producer 接自家错误），消息与错误码原样透传。 */

export interface DslErrorSink {
  bad(message: string): never
  coded(code: string, message: string, details?: Record<string, unknown>): never
  /** 配额类冲突（409）：超出每节上限（annotation/replay 配额）。 */
  conflict(code: string, message: string, details?: Record<string, unknown>): never
}
