/**
 * 把本地媒体同步到对象存储（COS）：按 media_assets.hls_path 定位本地文件，
 * 逐对象 PUT，键与 hls_path 一一对应（hls/<assetId>/index.m3u8 等）。
 *
 * 用法：
 *   node --import tsx scripts/sync-media-to-cos.ts [--courses TC-101,TC-ZONGLUN] [--dry-run]
 *
 * 约束：
 *   - 上传前校验播放列表完整性（#EXT-X-ENDLIST + 分片齐备），不完整的素材直接跳过
 *   - 已存在且大小一致的对象跳过，可重复执行
 *   - 图示候选按 figures/<rel_path> 同步（与运行时的读取路径一致）
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import pg from 'pg'
import { loadConfig } from '../src/config.js'
import { createCosStore } from '../src/media/cos-store.js'
import { assertCompleteHls } from '../src/pipeline/media-store.js'

const { Pool } = pg

const DEFAULT_COURSES = ['TC-101', 'TC-ZONGLUN']
const CONCURRENCY = 8

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.key': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

interface UploadTask {
  key: string
  file: string
  size: number
}

interface SyncReport {
  uploaded: number
  skipped: number
  failed: number
  bytes: number
  problems: string[]
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const courses = argValue(args, '--courses')?.split(',').map(item => item.trim()).filter(item => item !== '')
    ?? DEFAULT_COURSES
  const dryRun = args.includes('--dry-run')
  const mediaRoot = resolve(argValue(args, '--media-root') ?? 'workspace/media')
  const figuresRoot = resolve(argValue(args, '--figures-root') ?? 'workspace/pipeline/figures')

  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 必填（本地同步用 apps/cloud/.env 的连接串）')
  }
  // COS 配置口径与运行期一致：配置解析只走 config.ts 一处
  const config = loadConfig({
    APP_ENV: 'local',
    DATABASE_URL: databaseUrl,
    MEDIA_STORAGE: 'cos',
    COS_REGION: process.env.COS_REGION,
    COS_BUCKET: process.env.COS_BUCKET,
    COS_ENDPOINT: process.env.COS_ENDPOINT,
    COS_SECRET_ID: process.env.COS_SECRET_ID,
    COS_SECRET_KEY: process.env.COS_SECRET_KEY,
    COS_VIRTUAL_HOST: process.env.COS_VIRTUAL_HOST,
    COS_SECURE: process.env.COS_SECURE,
  })
  if (config.cos === undefined) throw new Error('COS 配置缺失')
  const store = createCosStore(config.cos)

  const pool = new Pool({ connectionString: databaseUrl })
  const report: SyncReport = { uploaded: 0, skipped: 0, failed: 0, bytes: 0, problems: [] }
  try {
    const tasks: UploadTask[] = []

    const { rows: assets } = await pool.query(
      `SELECT asset_id, hls_path FROM media_assets
       WHERE course_id = ANY($1) AND hls_path IS NOT NULL
       ORDER BY asset_id`,
      [courses],
    )
    for (const asset of assets as { asset_id: string; hls_path: string }[]) {
      const dir = join(mediaRoot, dirname(asset.hls_path))
      const playlist = join(mediaRoot, asset.hls_path)
      if (!existsSync(playlist)) {
        report.problems.push(`${asset.asset_id}：本地没有播放列表 ${asset.hls_path}`)
        continue
      }
      try {
        await assertCompleteHls(dir)
      } catch (error) {
        report.problems.push(`${asset.asset_id}：播放列表不完整，跳过（${(error as Error).message}）`)
        continue
      }
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const file = join(dir, entry.name)
        const info = await stat(file)
        tasks.push({
          key: relative(mediaRoot, file).split('\\').join('/'),
          file,
          size: info.size,
        })
      }
    }

    const { rows: figures } = await pool.query(
      `SELECT c.rel_path FROM figure_candidates c
       JOIN figures f ON f.figure_id = c.figure_id
       WHERE f.course_id = ANY($1)
       ORDER BY c.rel_path`,
      [courses],
    )
    for (const figure of figures as { rel_path: string }[]) {
      const file = join(figuresRoot, figure.rel_path)
      if (!existsSync(file)) {
        report.problems.push(`图示缺失：${figure.rel_path}`)
        continue
      }
      const info = await stat(file)
      tasks.push({
        key: `figures/${figure.rel_path}`,
        file,
        size: info.size,
      })
    }

    console.log(`待同步 ${tasks.length} 个对象（课程：${courses.join(', ')}${dryRun ? '，dry-run' : ''}）`)
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(tasks.length, 1)) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        const task = tasks[index]
        if (task === undefined) return
        try {
          const existing = await store.stat(task.key)
          if (existing !== undefined && existing.size === task.size) {
            report.skipped += 1
            continue
          }
          if (dryRun) {
            report.uploaded += 1
            report.bytes += task.size
            continue
          }
          const body = await readFile(task.file)
          await store.put(task.key, body, CONTENT_TYPES[extname(task.file).toLowerCase()])
          report.uploaded += 1
          report.bytes += task.size
        } catch (error) {
          report.failed += 1
          report.problems.push(`${task.key}：${(error as Error).message}`)
        }
      }
    })
    await Promise.all(workers)

    console.log(JSON.stringify({
      courses,
      dryRun,
      uploaded: report.uploaded,
      skipped: report.skipped,
      failed: report.failed,
      bytes: report.bytes,
      problems: report.problems,
    }, null, 2))
    if (report.failed > 0) process.exitCode = 1
  } finally {
    await pool.end()
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined) throw new Error(`${flag} 缺少取值`)
  return value
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
