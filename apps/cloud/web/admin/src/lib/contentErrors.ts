import { ApiError } from '../api'

/**
 * 内容编辑错误 → 可执行的中文指引。
 *
 * 云端错误体分两种：带机器可读码的 `{ error: { code, message } }` 与纯文本 `{ error: message }`。
 * 前者按码映射，后者按原文归一化——不把英文服务端原文甩给使用者。
 */
const CODE_HINTS: Record<string, string> = {
  event_date_out_of_window: '事件日期不在案例窗口内：请改事件日期，或把案例窗口放宽。',
  unit_ref_unknown: '事件锚点引用了不存在的 source unit：请核对 unitId。',
  approval_required: '课程尚未签批终审：请先「签批终审」，再发布。',
  approval_stale: '签批后课程内容变更，指纹已不符：请重新「签批终审」后再发布。',
  figure_unresolved: '正文引用的图示未选定或候选未就绪：先在节预览里补齐图示。',
  widget_unproven: '存在未通过断言证明的课件：先修正课件 spec 再发布。',
  clip_invalid: '片段窗未落在素材时间窗内：先修正片段窗再发布。',
  annotation_unresolved: '正文标注未解析（证据、交易日或术语未对上）：先修正标注再发布。',
  replay_unproven: '正文回放块与回放课件不匹配：每只个股每节须恰好一份回放课件。',
}

const MESSAGE_HINTS: Record<string, string> = {
  'course is not draft': '课程已发布，暂不能直接改内容：请先把课程状态改回草稿。',
  'sourceAssetIds contains unknown asset': '来源素材不存在：请重新选择素材源。',
  'conceptRefs contains unknown concept': '关联术语不存在：请重新选择术语。',
  'citations contain unknown source unit': '引用了不存在的 source unit：请核对引用。',
  'section not found': '节不存在或不属于该课程。',
  'course not found': '课程不存在。',
  'stocks must contain 1–10 items': '至少保留一只案例股（单次上限 10 只）。',
}

/** 字段级校验错误：云端原文带字段下标与英文条件，转成一句中文约束。 */
function fieldHint(message: string): string | undefined {
  if (message.startsWith('stocks[')) {
    return `案例股字段不合法（名称 ≤50 字、代号 6 位数字、交易所限深/沪/北、窗口日期 YYYY-MM-DD）：${message}`
  }
  if (message.startsWith('events[')) {
    return `事件锚点字段不合法（日期 YYYY-MM-DD、标签 ≤100 字、unitId 形如 su_xxxxxxxxxxxxxxxx）：${message}`
  }
  if (message.startsWith('aliases')) return '别名不合法：每条 ≤200 字，单次 ≤20 条。'
  if (message.startsWith('definition')) return '定义不合法：≤2000 字。'
  return undefined
}

export function contentErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code !== undefined) {
      const hinted = CODE_HINTS[error.code]
      if (hinted !== undefined) return hinted
    }
    const hinted = MESSAGE_HINTS[error.message]
    if (hinted !== undefined) return hinted
    const field = fieldHint(error.message)
    if (field !== undefined) return field
    if (error.status === 403) return '当前账号无权编辑内容（内容编辑限 operator/admin/producer）。'
    return `${fallback}：${error.message}`
  }
  return error instanceof Error ? error.message : fallback
}
