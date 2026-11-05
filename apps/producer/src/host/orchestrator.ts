/**
 * 理解阶段编排的确定性部分（F2）：分块规划与断点恢复差集。
 * 模型循环由 dsh agent 按 transcript-understanding skill 驱动；本模块只做
 * 云 DB 即 checkpoint 的差集计算——同一输入永远得到同一待办队列。
 */

export interface TranscriptSegment {
  idx: number
  startMs: number
  endMs: number
  text: string
}

export interface ChunkPlan {
  /** 窗口序号（0 起）。 */
  index: number
  startMs: number
  endMs: number
  /** 落在该窗口内的转写段 idx 列表。 */
  segmentIdxs: number[]
}

export interface PlanOptions {
  /** 目标窗口时长（毫秒），默认 480s：与 ASR 块边界数量对齐，单窗口 12–15 帧（30s 口径）。 */
  chunkMs?: number
  /** 窗口间留 30s 重叠，避免讲解跨窗口被腰斩。 */
  overlapMs?: number
}

const DEFAULT_CHUNK_MS = 480_000
const DEFAULT_OVERLAP_MS = 30_000

/**
 * 把转写段聚合成理解窗口：以段边界切分（不在句子中间断开），
 * 相邻窗口重叠 overlapMs；转写缺口（片头/广告）不产生空窗口。
 */
export function planUnderstandingChunks(
  durationMs: number,
  segments: TranscriptSegment[],
  options: PlanOptions = {},
): ChunkPlan[] {
  const chunkMs = options.chunkMs ?? DEFAULT_CHUNK_MS
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS
  if (segments.length === 0) return []

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const plans: ChunkPlan[] = []
  let windowStart = sorted[0].startMs
  let current: TranscriptSegment[] = []
  let index = 0

  const flush = (nextStart: number): void => {
    if (current.length === 0) return
    plans.push({
      index,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      segmentIdxs: current.map(seg => seg.idx),
    })
    index += 1
    windowStart = nextStart
    current = []
  }

  for (const seg of sorted) {
    // 窗口以段起点度量：当前段起点已越过（windowStart + chunkMs）即收口当前窗口，
    // 新窗口回退 overlapMs 与上一窗尾重叠。
    if (current.length > 0 && seg.startMs - windowStart >= chunkMs) {
      flush(Math.max(seg.startMs - overlapMs, windowStart + 1))
    }
    current.push(seg)
  }
  flush(windowStart + 1)
  void durationMs
  return plans
}

export interface CoverageInput {
  plans: ChunkPlan[]
  /** 云端已有的 source units（assetId 维度），取其 startMs。 */
  existingStartMs: number[]
}

export interface ChunkTodo extends ChunkPlan {
  /** 该窗口覆盖区间内已有 unit 数。 */
  covered: number
}

/**
 * 断点恢复差集（原则 10）：窗口内没有任何既有 unit 起点即视为待办；
 * 部分覆盖的窗口整体重跑——(assetId, startMs) 幂等保证重跑不产生重复。
 */
export function diffUnderstandingTodos(input: CoverageInput): ChunkTodo[] {
  const starts = new Set(input.existingStartMs)
  return input.plans.map(plan => ({
    ...plan,
    covered: plan.segmentIdxs.length > 0
      ? [...starts].filter(start => start >= plan.startMs && start < plan.endMs).length
      : 0,
  })).filter(todo => todo.covered === 0)
}

/** 理解产物入库前的归一化：keyframes 允许裸 sec 或对象形态，统一为对象形态。 */
export function normalizeKeyframes(
  keyframes: unknown,
): { sec: number }[] | undefined {
  if (!Array.isArray(keyframes)) return undefined
  const normalized: { sec: number }[] = []
  for (const entry of keyframes) {
    const sec = typeof entry === 'object' && entry !== null && 'sec' in entry
      ? (entry as { sec: unknown }).sec
      : entry
    if (typeof sec === 'number' && Number.isInteger(sec) && sec >= 0) {
      normalized.push({ sec })
    }
  }
  return normalized.length > 0 ? normalized : undefined
}
