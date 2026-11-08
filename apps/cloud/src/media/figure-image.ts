import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** 图示候选落盘在图示根目录下；相对路径形如 fig_xxx/cand_xxx.(jpg|png|svg)。 */
const CANDIDATE_PATH = /^fig_[A-Za-z0-9._-]{1,60}\/cand_[A-Za-z0-9._-]{1,59}\.(?:jpg|png|svg)$/

export interface FigureImage {
  bytes: Buffer
  mime: string
}

function mimeOf(relPath: string): string {
  if (relPath.endsWith('.svg')) return 'image/svg+xml'
  if (relPath.endsWith('.png')) return 'image/png'
  return 'image/jpeg'
}

/** 图示候选的 MIME（对象存储分支复用同一口径）。 */
export function figureMimeOf(relPath: string): string {
  return mimeOf(relPath)
}

/**
 * 读图示候选字节：路径越界一律拒绝（不回显磁盘结构），文件缺失返回 undefined。
 */
export async function readFigureImageBytes(
  root: string,
  relPath: string,
): Promise<FigureImage | undefined> {
  if (!CANDIDATE_PATH.test(relPath)) return undefined
  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(`${base}${sep}`)) return undefined
  try {
    return { bytes: await readFile(target), mime: mimeOf(relPath) }
  } catch {
    return undefined
  }
}
