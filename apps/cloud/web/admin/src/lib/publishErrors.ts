import { ApiError } from '../api'

/**
 * 发布门禁错误码 → 可执行的中文提示。
 * 门禁顺序（云端架构 §6.5.9）：内容完整性先于签名问题报错——前者可定位修，后者只说明「内容变了」。
 */
const PUBLISH_ERRORS: Record<string, string> = {
  approval_required: '课程尚未签批终审：请先「签批终审」，再发布。',
  approval_stale: '签批后课程内容变更，指纹已不符：请重新「签批终审」后再发布。',
  figure_unresolved: '正文引用的图示未选定或候选未就绪：先在节预览里补齐图示。',
  widget_unproven: '存在未通过断言证明的课件：先修正课件 spec 再发布。',
  clip_invalid: '片段窗未落在素材时间窗内：先修正片段窗再发布。',
  annotation_unresolved: '正文标注未解析（证据、交易日或术语未对上）：先修正标注再发布。',
  replay_unproven: '正文回放块与回放课件不匹配：每只个股每节须恰好一份回放课件。',
}

export function publishErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const mapped = error.code === undefined ? undefined : PUBLISH_ERRORS[error.code]
    if (mapped !== undefined) return mapped
    if (error.status === 403) return '当前账号无权发布（签批与发布限 operator/admin）。'
    return `发布失败：${error.message}`
  }
  return error instanceof Error ? error.message : '发布失败'
}

/** 就绪度卡片上的门禁问题：给一句中文指引（门禁码与发布冲突码同名）。 */
export function gateIssueText(code: string): string {
  return PUBLISH_ERRORS[code] ?? `门禁未通过（${code}）`
}

/** 签批失败：分权不变——producer 负责生产，不能自签（云端架构 §6.5.1）。 */
export function approvalErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号无权签批（签批限 operator/admin；producer 只产内容）。'
  }
  return error instanceof Error ? error.message : '签批失败'
}
