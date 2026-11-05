/** 关键帧轨道（M9）：采样规划、内容去重与 manifest 生成；worker 与 frames 接口共用契约。 */

import { createHash } from 'node:crypto'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface KeyframePlanInput {
  durationSec: number
  intervalSec: number
  sceneTimes: number[]
  maxPerAsset: number
}

/** 固定网格 + 场景切点（并入 1/3 网格距内的邻近网格位），升序去重后按上限截断。 */
export function planKeyframeSecs(input: KeyframePlanInput): number[] {
  const planned = new Set<number>()
  const durationSec = Math.max(0, Math.floor(input.durationSec))
  for (let sec = 0; sec < durationSec; sec += Math.max(1, input.intervalSec)) {
    planned.add(sec)
  }
  // 窗口必须小于网格半距，否则任何切点都并入网格、场景检测失去意义。
  const mergeWindow = Math.max(1, Math.floor(input.intervalSec / 3))
  for (const sceneSec of input.sceneTimes) {
    const sec = Math.floor(sceneSec)
    if (sec < 0 || sec > durationSec) continue
    const nearGrid = [...planned].some(existing => Math.abs(existing - sec) < mergeWindow)
    if (!nearGrid) planned.add(sec)
  }
  return [...planned].sort((a, b) => a - b).slice(0, input.maxPerAsset)
}

/** JPEG SOF 段读取尺寸；extractFrame 固定 800–2000 长边，清单写入真实值供生产端参考。 */
export function jpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === undefined) return undefined
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    if (length <= 0) return undefined
    offset += 2 + length
  }
  return undefined
}

export interface ManifestFrame {
  sec: number
  width: number
  height: number
}

export interface BuildManifestResult {
  frames: ManifestFrame[]
  removedDuplicates: number
}

/**
 * 扫描 keyframes 目录生成清单：按 sec 升序，内容一致（sha256）的后续帧剔除；
 * 帧轨道是生产端 VLM 的输入面，重复画面只会浪费 token。清单原子替换。
 */
export async function buildKeyframeManifest(directory: string): Promise<BuildManifestResult> {
  const entries = await readdir(directory).catch(() => [] as string[])
  const secs: number[] = []
  for (const name of entries) {
    const match = /^(\d{1,5})\.jpg$/.exec(name)
    if (match === null) continue
    const sec = Number(match[1])
    if (Number.isFinite(sec)) secs.push(sec)
  }
  secs.sort((a, b) => a - b)
  const frames: ManifestFrame[] = []
  const seenHashes = new Set<string>()
  let removedDuplicates = 0
  for (const sec of secs) {
    const content = await readFile(join(directory, `${sec}.jpg`)).catch(() => undefined)
    if (content === undefined) continue
    const hash = createHash('sha256').update(content).digest('hex')
    if (seenHashes.has(hash)) {
      removedDuplicates += 1
      continue
    }
    seenHashes.add(hash)
    const size = jpegDimensions(content)
    frames.push({
      sec,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
    })
  }
  const payload = `${JSON.stringify({ frames })}\n`
  const target = join(directory, 'manifest.json')
  const staging = join(directory, `manifest.${process.pid}.${Date.now()}.tmp`)
  await writeFile(staging, payload, 'utf8')
  await rename(staging, target)
  return { frames, removedDuplicates }
}
