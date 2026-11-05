export interface LessonSegment {
  id: string
  kind: 'heading' | 'paragraph' | 'list'
  level?: number
  text: string
  continued?: boolean
}

const MAX_SEGMENT_CHARS = 240
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const BULLET = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.+)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*(?:[-*_]\s*){3,}$/
const FENCE = /^\s*(?:```|~~~)/
const IMAGE_ONLY = /^\s*!\[([^\]]*)\]\([^)]*\)\s*$/
const SEGMENT_REF = /^\s*对应视频片段[：:]\s*`?seg-[A-Za-z0-9._-]+`?\s*$/

function cleanInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSpeech(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('；'),
      window.lastIndexOf('，'),
    )
    const at = cut >= max * 0.5 ? cut + 1 : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest.length > 0) parts.push(rest)
  return parts.filter((part) => part.length > 0)
}

/** 章节教材按标题/段落/列表切成讲解段；代码块不朗读，图示读 alt。 */
export function buildLessonScript(markdown: string): LessonSegment[] {
  const segments: LessonSegment[] = []
  let paragraph: string[] = []
  let inCode = false
  let serial = 0

  const push = (kind: LessonSegment['kind'], raw: string, level?: number): void => {
    const text = cleanInline(raw)
    if (text.length === 0) return
    const chunks = splitSpeech(text, MAX_SEGMENT_CHARS)
    chunks.forEach((chunk, chunkIndex) => {
      serial += 1
      segments.push({
        id: `lesson-${serial}`,
        kind,
        ...(level === undefined ? {} : { level }),
        text: chunk,
        ...(chunkIndex === 0 ? {} : { continued: true }),
      })
    })
  }

  const flush = (): void => {
    if (paragraph.length === 0) return
    push('paragraph', paragraph.join(' '))
    paragraph = []
  }

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    if (FENCE.test(line)) {
      flush()
      inCode = !inCode
      continue
    }
    if (inCode) continue
    if (line.trim().length === 0) {
      flush()
      continue
    }
    if (RULE.test(line)) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      push('heading', heading[2] ?? '', heading[1]?.length)
      continue
    }
    const image = IMAGE_ONLY.exec(line)
    if (image !== null) {
      flush()
      const alt = image[1]?.trim() ?? ''
      if (alt.length > 0) push('paragraph', `图示：${alt}`)
      continue
    }
    if (SEGMENT_REF.test(line)) {
      flush()
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      flush()
      push('list', bullet[1] ?? '')
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      flush()
      push('paragraph', quote[1] ?? '')
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return segments
}

export interface SpeechEngine {
  speak(text: string, options: {
    lang: string
    rate: number
    onEnd: () => void
    onError: (code: string) => void
  }): void
  pause(): void
  resume(): void
  cancel(): void
}

export type LessonStatus = 'idle' | 'playing' | 'paused' | 'ended' | 'manual'

export interface LessonSnapshot {
  index: number
  status: LessonStatus
  rate: number
  error?: string
}

export interface LessonPlayerOptions {
  segments: LessonSegment[]
  engine?: SpeechEngine
  onChange?: (snapshot: LessonSnapshot) => void
}

/** 语音不可用时进入 manual：仍可逐段翻页，但不朗读。 */
export class LessonPlayer {
  private readonly segments: LessonSegment[]
  private readonly engine: SpeechEngine | undefined
  private readonly onChange: ((snapshot: LessonSnapshot) => void) | undefined
  private index = 0
  private status: LessonStatus = 'idle'
  private rate = 1
  private error: string | undefined
  private generation = 0
  private disposed = false

  constructor(options: LessonPlayerOptions) {
    this.segments = options.segments
    this.engine = options.engine
    this.onChange = options.onChange
  }

  snapshot(): LessonSnapshot {
    return {
      index: this.index,
      status: this.status,
      rate: this.rate,
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  play(): void {
    if (this.segments.length === 0 || this.disposed) return
    if (this.status === 'playing') return
    if (this.status === 'paused' && this.engine !== undefined) {
      this.engine.resume()
      this.status = 'playing'
      this.emit()
      return
    }
    if (this.status === 'ended') this.index = 0
    this.speakCurrent()
  }

  pause(): void {
    if (this.status !== 'playing' || this.engine === undefined) return
    this.engine.pause()
    this.status = 'paused'
    this.emit()
  }

  toggle(): void {
    if (this.status === 'playing') this.pause()
    else this.play()
  }

  stop(): void {
    if (this.disposed) return
    this.generation += 1
    this.engine?.cancel()
    this.status = 'manual'
    this.emit()
  }

  next(): void {
    if (this.index + 1 >= this.segments.length) return
    this.moveTo(this.index + 1)
  }

  previous(): void {
    if (this.index === 0) return
    this.moveTo(this.index - 1)
  }

  setIndex(index: number): void {
    const clamped = Math.min(Math.max(0, index), Math.max(0, this.segments.length - 1))
    if (clamped === this.index) return
    this.moveTo(clamped)
  }

  setRate(rate: number): void {
    const clamped = Math.min(2, Math.max(0.5, rate))
    if (clamped === this.rate) return
    this.rate = clamped
    if (this.status === 'playing') {
      this.generation += 1
      this.engine?.cancel()
      this.speakCurrent()
    } else {
      this.emit()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.engine?.cancel()
  }

  private moveTo(index: number): void {
    if (this.disposed) return
    const speaking = this.status === 'playing' || this.status === 'paused'
    this.index = index
    if (this.status === 'ended') this.status = 'idle'
    if (speaking || this.status === 'manual') this.speakCurrent()
    else this.emit()
  }

  private speakCurrent(): void {
    if (this.disposed) return
    this.error = undefined
    if (this.engine === undefined) {
      this.status = 'manual'
      this.emit()
      return
    }
    const segment = this.segments[this.index]
    if (segment === undefined) return
    this.generation += 1
    const generation = this.generation
    this.status = 'playing'
    this.emit()
    this.engine.speak(segment.text, {
      lang: 'zh-CN',
      rate: this.rate,
      onEnd: () => {
        if (generation !== this.generation || this.disposed) return
        if (this.index + 1 < this.segments.length) {
          this.index += 1
          this.speakCurrent()
        } else {
          this.status = 'ended'
          this.emit()
        }
      },
      onError: (code) => {
        if (generation !== this.generation || this.disposed) return
        this.error = code
        this.status = 'manual'
        this.emit()
      },
    })
  }

  private emit(): void {
    if (this.disposed) return
    this.onChange?.(this.snapshot())
  }
}

/** 浏览器无 Web Speech 时返回 undefined，由课堂降级为文字讲解。 */
export function createBrowserSpeechEngine(): SpeechEngine | undefined {
  const scope = globalThis as {
    speechSynthesis?: SpeechSynthesis
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
  }
  const synth = scope.speechSynthesis
  const Utterance = scope.SpeechSynthesisUtterance
  if (synth === undefined || Utterance === undefined) return undefined
  return {
    speak(text, options) {
      const utterance = new Utterance(text)
      utterance.lang = options.lang
      utterance.rate = options.rate
      utterance.onend = () => options.onEnd()
      utterance.onerror = (event) => {
        const code = (event as SpeechSynthesisErrorEvent).error
        if (code === 'interrupted' || code === 'canceled') return
        options.onError(code.length > 0 ? code : 'speech-error')
      }
      synth.cancel()
      synth.speak(utterance)
    },
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    cancel: () => synth.cancel(),
  }
}
