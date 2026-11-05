// 云端文本（转写/摘要/帧描述/回执）一律按不可信数据渲染：固定边界 + 转义，避免伪造边界跳出资料区。

function isHighSurrogate(value: string): boolean {
  return value >= '\ud800' && value <= '\udbff'
}

function isLowSurrogate(value: string): boolean {
  return value >= '\udc00' && value <= '\udfff'
}

function stripControlChars(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (char === '\t' || char === '\n' || char === '\r' || (code >= 32 && code !== 127)) {
      // 孤代理对替换为占位符，避免拼回字符串时产生非法序列。
      out += isHighSurrogate(char) || isLowSurrogate(char) ? '�' : char
    }
  }
  return out
}

/** 剥离控制字符并把 `<` 换成全角，防正文伪造工具边界标签。 */
export function sanitizeUntrusted(value: string): string {
  return stripControlChars(value).replace(/</g, '＜')
}

/** 单行场景再压平空白，供标题/文件名等。 */
export function sanitizeInlineUntrusted(value: string): string {
  return sanitizeUntrusted(value).replace(/\s+/g, ' ').trim()
}

/** 教材正文场景：保留 `<br/>`（Mermaid 标签内唯一允许的标记），其余 `<` 一律转义。 */
export function sanitizeMarkdownUntrusted(value: string): string {
  return stripControlChars(value).replace(/<(?!br\s*\/?>)/gi, '＜')
}

export function truncateCodePoints(value: string, max: number): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, max).join('')
}

export const SOURCE_UNIT_DATA_OPEN = '<source_unit_data>'
export const SOURCE_UNIT_DATA_CLOSE = '</source_unit_data>'
export const TRANSCRIPT_DATA_OPEN = '<cloud_transcript_data>'
export const TRANSCRIPT_DATA_CLOSE = '</cloud_transcript_data>'

export function wrapUntrusted(value: string): string {
  return `${SOURCE_UNIT_DATA_OPEN}\n${sanitizeUntrusted(value)}\n${SOURCE_UNIT_DATA_CLOSE}`
}

export function wrapTranscript(value: string): string {
  return `${TRANSCRIPT_DATA_OPEN}\n${sanitizeUntrusted(value)}\n${TRANSCRIPT_DATA_CLOSE}`
}

export function wrapMarkdownUntrusted(value: string): string {
  return `${SOURCE_UNIT_DATA_OPEN}\n${sanitizeMarkdownUntrusted(value)}\n${SOURCE_UNIT_DATA_CLOSE}`
}

export { stripControlChars }
