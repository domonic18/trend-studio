import type { z } from 'zod'

/** 取首个 issue 的「路径 消息」描述（无 issue 时回退「结构不合法」），供宿主包装成自家错误。 */
export function firstIssueDetail(error: z.ZodError): string {
  const issue = error.issues[0]
  if (issue === undefined) return '结构不合法'
  const path = issue.path.map(String).join('.')
  return path === '' ? issue.message : `${path} ${issue.message}`
}
