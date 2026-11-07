import { ApiError } from '../api'

/**
 * 生产链路的错误文案：素材类、生产任务类、行情同步类。
 *
 * 云端这些路径多数返回英文 message 而非机器码（素材直传/入队/转写、生产任务上报），
 * 所以按已知文案映射成可执行的中文；带机器码的走 code 优先。
 * 未命中的回落成「操作失败 + 原文」，不吞掉服务端信息。
 */

const MATERIAL_ERRORS: Record<string, string> = {
  'course not found': '课程不存在或已归档。',
  'course must be draft': '课程不是草稿态，无法新建素材。',
  'media asset not found': '素材不存在或已删除。',
  'asset is not accepting uploads': '素材当前不接受上传：请新建素材后再传。',
  'source checksum mismatch': '上传内容摘要与声明不符：文件可能传错或中途被改动，请重传同一个素材。',
  'source size mismatch': '上传字节数与声明不符：文件可能没传完，请重传同一个素材。',
  'upload does not match declared bytes': '上传字节数与声明不符：文件可能没传完，请重传同一个素材。',
  'source is missing': '素材尚未上传原片：请先完成直传再入队转写。',
  'asset is archived': '素材已归档：请新建素材，不要在归档素材上继续。',
  'asset must be ready': '素材尚未就绪：请先完成转写与入库。',
  'asset is already processing': '素材正在处理中：请勿重复入队转写（会重复消耗转写额度）。',
  'job already active': '该素材已有进行中的作业：请等它跑完，不要重复入队。',
  'transcript must be ready': '转写尚未完成：等转写收尾后再读（转写中只覆盖已转写前缀）。',
  'transcript not found': '该素材还没有转写记录：请先入队转写。',
  'media asset unavailable': '素材暂不可播放：转码或转写还没完成。',
}

const TASK_ERRORS: Record<string, string> = {
  'course not found': '课程不存在或已归档。',
  'section not found': '节不存在或已归档。',
}

const QUOTES_ERRORS: Record<string, string> = {
  'course not found': '课程不存在或已归档。',
  'course is archived': '课程已归档：无法同步行情。',
}

function mappedText(error: unknown, table: Record<string, string>, prefix: string): string {
  if (error instanceof ApiError) {
    const byMessage = table[error.message]
    if (byMessage !== undefined) return byMessage
    if (error.status === 403) return '当前账号无权执行该操作（生产端操作限 producer/operator/admin）。'
    return `${prefix}：${error.message}`
  }
  return error instanceof Error ? error.message : prefix
}

/** 素材类：直传、入队转写、读转写、读证据。 */
export function materialErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'unit_not_readable') {
    return '素材证据不可读：素材可能仍在转写（部分可读）或已失败/归档，请检查素材状态。'
  }
  return mappedText(error, MATERIAL_ERRORS, '素材操作失败')
}

/** 生产任务类：任务上报、看板读取、素材决策。 */
export function taskErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message.startsWith('step must be one of')) {
      return '步骤名不合法：九步只能是 case_stocks / quotes_sync / quotes_read / figures / replay_widget / article / widgets / review / provenance。'
    }
    if (error.message.startsWith('status must be one of')) {
      return '状态不合法：只能是 pending / running / done / blocked / failed。'
    }
    if (error.message === 'choice must be one of A/B/C') {
      return '处理方式不合法：只能是 A（只补这节）/ B（重做课程骨架）/ C（只入库）。'
    }
  }
  return mappedText(error, TASK_ERRORS, '生产任务操作失败')
}

/** 行情同步类：quotes-sync。 */
export function quotesSyncErrorText(error: unknown): string {
  return mappedText(error, QUOTES_ERRORS, '行情同步失败')
}
