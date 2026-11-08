/**
 * 导出内容 bundle：把本地课程内容（章节/知识点/片段/节/课件 spec/图示/语料/向量）
 * 导成一份幂等 SQL，拿到生产库里单事务执行即可。
 *
 * 用法：
 *   node --import tsx scripts/export-content-bundle.ts [--courses TC-101,TC-ZONGLUN] [--out <目录>]
 *
 * 边界：
 *   - 只导内容，不导认证态与运行态（账号/令牌/会话/播放会话/进度/事件/AI 运行/管线任务）
 *   - 密钥不进 bundle：模型配置只导非密字段，api_key_encrypted 一律 NULL，由人在生产后台重录
 *   - 指向不导出表的外键列置空（如 content_generations.job_id），避免外键断裂
 *   - figures ↔ figure_candidates 是双向外键：先写图示（选定候选置空）再写候选，最后回填
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Pool } = pg

// 日期与时间戳按原始文本保留：node-pg 默认转成 JS Date 会带时区偏移，往返可能改值
pg.types.setTypeParser(1082, value => value)
pg.types.setTypeParser(1114, value => value)
pg.types.setTypeParser(1184, value => value)

const DEFAULT_COURSES = ['TC-101', 'TC-ZONGLUN']

interface TableExport {
  table: string
  /** 主键列（ON CONFLICT 目标） */
  pk: string[]
  /** 作用域查询 */
  scope: string
  /** 指向不导出表的外键列，导出时置空 */
  nullOut?: string[]
}

/** 作用域都挂在白名单课程上（子表用子查询回溯到课程）。 */
const CONTENT_TABLES: TableExport[] = [
  { table: 'courses', pk: ['course_id'], scope: 'course_id = ANY($1)' },
  { table: 'chapters', pk: ['course_id', 'chapter_id'], scope: 'course_id = ANY($1)' },
  { table: 'knowledge_points', pk: ['knowledge_point_id'], scope: 'course_id = ANY($1)' },
  { table: 'segments', pk: ['segment_id'], scope: 'course_id = ANY($1)' },
  { table: 'chapter_articles', pk: ['course_id', 'chapter_id'], scope: 'course_id = ANY($1)' },
  { table: 'chapter_quizzes', pk: ['course_id', 'chapter_id'], scope: 'course_id = ANY($1)' },
  {
    table: 'articles',
    pk: ['knowledge_point_id'],
    scope: 'knowledge_point_id IN (SELECT knowledge_point_id FROM knowledge_points WHERE course_id = ANY($1))',
  },
  { table: 'media_assets', pk: ['asset_id'], scope: 'course_id = ANY($1)' },
  {
    table: 'media_transcripts',
    pk: ['transcript_id'],
    scope: 'asset_id IN (SELECT asset_id FROM media_assets WHERE course_id = ANY($1))',
    nullOut: ['job_id'],
  },
  {
    table: 'transcript_chunks',
    pk: ['chunk_id'],
    scope: `transcript_id IN (
      SELECT transcript_id FROM media_transcripts
      WHERE asset_id IN (SELECT asset_id FROM media_assets WHERE course_id = ANY($1)))`,
  },
  {
    table: 'transcript_segments',
    pk: ['transcript_id', 'idx'],
    scope: `transcript_id IN (
      SELECT transcript_id FROM media_transcripts
      WHERE asset_id IN (SELECT asset_id FROM media_assets WHERE course_id = ANY($1)))`,
  },
  {
    table: 'source_units',
    pk: ['unit_id'],
    scope: `(
      (asset_id IS NOT NULL AND asset_id IN (SELECT asset_id FROM media_assets WHERE course_id = ANY($1)))
      OR (transcript_id IS NOT NULL AND transcript_id IN (
        SELECT transcript_id FROM media_transcripts
        WHERE asset_id IN (SELECT asset_id FROM media_assets WHERE course_id = ANY($1))))
    )`,
  },
  {
    table: 'content_generations',
    pk: ['generation_id'],
    scope: 'course_id = ANY($1)',
    nullOut: ['job_id'],
  },
  { table: 'sections', pk: ['section_id'], scope: 'course_id = ANY($1)' },
  {
    table: 'section_articles',
    pk: ['section_id'],
    scope: 'section_id IN (SELECT section_id FROM sections WHERE course_id = ANY($1))',
  },
  {
    table: 'section_case_stocks',
    pk: ['stock_ref_id'],
    scope: 'section_id IN (SELECT section_id FROM sections WHERE course_id = ANY($1))',
  },
  { table: 'widget_specs', pk: ['widget_id'], scope: 'course_id = ANY($1)' },
  { table: 'concepts', pk: ['concept_id'], scope: 'course_id = ANY($1)' },
  { table: 'concept_edges', pk: ['edge_id'], scope: 'course_id = ANY($1)' },
  {
    table: 'figures',
    pk: ['figure_id'],
    scope: 'course_id = ANY($1)',
    // 双向外键：候选先于图示写入，这里先留空，最后回填
    nullOut: ['selected_candidate_id'],
  },
  {
    table: 'figure_candidates',
    pk: ['candidate_id'],
    scope: 'figure_id IN (SELECT figure_id FROM figures WHERE course_id = ANY($1))',
  },
  // content_approvals 不导出：approved_by 必填且指向本地用户，生产的审批由管理员重新签署
  {
    table: 'course_stock_quotes',
    pk: ['code', 'period', 'trade_date'],
    scope: 'code IN (SELECT code FROM section_case_stocks WHERE course_id = ANY($1))',
  },
]

interface ModelTableExport {
  table: string
  pk: string[]
  scope: string
  /** 导出时置空或清零的列（密钥与测试痕迹） */
  reset?: Record<string, 'null' | 'zero'>
}

const MODEL_TABLES: ModelTableExport[] = [
  {
    table: 'llm_configs',
    pk: ['config_id'],
    scope: 'TRUE',
    reset: { api_key_encrypted: 'null', last_tested_at: 'null', last_test_status: 'null', last_test_error: 'null' },
  },
  {
    table: 'asr_config',
    pk: ['id'],
    scope: 'TRUE',
    reset: { api_key_encrypted: 'null', last_tested_at: 'null', last_test_status: 'null', last_test_error: 'null' },
  },
  { table: 'llm_task_bindings', pk: ['task_key'], scope: 'TRUE' },
]

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (Buffer.isBuffer(value)) return `E'\\x${value.toString('hex')}'::bytea`
  if (typeof value === 'object') return quoteText(JSON.stringify(value))
  return quoteText(String(value))
}

/** E'' 字符串：反斜杠与单引号都要转义，保留原文（含换行与 JSON 转义）。 */
function quoteText(text: string): string {
  return `E'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function insertStatement(
  table: string,
  columns: string[],
  rows: unknown[][],
  pk: string[],
): string {
  const columnList = columns.map(quoteIdentifier).join(', ')
  const conflictTarget = pk.map(quoteIdentifier).join(', ')
  const updatable = columns.filter(column => !pk.includes(column))
  const conflict = updatable.length === 0
    ? `ON CONFLICT (${conflictTarget}) DO NOTHING`
    : `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updatable
        .map(column => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
        .join(', ')}`
  const values = rows
    .map(row => `  (${row.map(literal).join(', ')})`)
    .join(',\n')
  return `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES\n${values}\n${conflict};`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const courses = argValue(args, '--courses')?.split(',').map(item => item.trim()).filter(item => item !== '')
    ?? DEFAULT_COURSES
  const outDir = resolve(argValue(args, '--out') ?? 'workspace/export-bundle')
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 必填（本地导出用 apps/cloud/.env 的连接串）')
  }

  const pool = new Pool({ connectionString: databaseUrl })
  const manifest: Record<string, number> = {}
  const chunks: string[] = [
    '-- 由 apps/cloud/scripts/export-content-bundle.ts 生成：本地内容 → 生产的一次性导入包。',
    `-- 课程范围：${courses.join(', ')}`,
    '-- 幂等：全部语句为 INSERT ... ON CONFLICT DO UPDATE，可重复执行。',
    '-- 只含内容，不含账号/令牌/会话/进度/事件/AI 运行；模型密钥不在本文件（见 model-config.sql）。',
    '',
    'BEGIN;',
    '',
  ]

  try {
    for (const definition of CONTENT_TABLES) {
      const { rows } = await pool.query(
        `SELECT * FROM ${quoteIdentifier(definition.table)} WHERE ${definition.scope}`,
        [courses],
      )
      manifest[definition.table] = rows.length
      if (rows.length === 0) continue
      const columns = Object.keys(rows[0] as Record<string, unknown>)
      const nullOut = new Set(definition.nullOut ?? [])
      const values = rows.map(row => {
        const record = row as Record<string, unknown>
        return columns.map(column => (nullOut.has(column) ? null : record[column]))
      })
      chunks.push(`-- ${definition.table}：${rows.length} 行`)
      chunks.push(insertStatement(definition.table, columns, values, definition.pk))
      chunks.push('')
    }

    // 回填图示选定候选（figures → figure_candidates 双向外键的第二步）
    chunks.push('-- 回填图示选定候选（双向外键的第二步）')
    chunks.push(`UPDATE figures f SET selected_candidate_id = c.candidate_id
FROM figure_candidates c
WHERE c.figure_id = f.figure_id AND f.selected_candidate_id IS NULL
  AND f.course_id = ANY(ARRAY[${courses.map(course => quoteText(course)).join(', ')}]::text[]);`)
    chunks.push('')
    chunks.push('COMMIT;')
    chunks.push('')

    const modelChunks: string[] = [
      '-- 模型配置（只含非密字段）：密钥由人在生产后台「模型配置」页重录并点「测试连接」。',
      '',
      'BEGIN;',
      '',
    ]
    const modelManifest: Record<string, number> = {}
    for (const definition of MODEL_TABLES) {
      const { rows } = await pool.query(
        `SELECT * FROM ${quoteIdentifier(definition.table)} WHERE ${definition.scope}`,
      )
      modelManifest[definition.table] = rows.length
      if (rows.length === 0) continue
      const columns = Object.keys(rows[0] as Record<string, unknown>)
      const reset = definition.reset ?? {}
      const values = rows.map(row => {
        const record = row as Record<string, unknown>
        return columns.map(column => {
          const mode = reset[column]
          if (mode === 'null') return null
          if (mode === 'zero') return 0
          return record[column]
        })
      })
      modelChunks.push(`-- ${definition.table}：${rows.length} 行`)
      modelChunks.push(insertStatement(definition.table, columns, values, definition.pk))
      modelChunks.push('')
    }
    modelChunks.push('COMMIT;')
    modelChunks.push('')

    await mkdir(outDir, { recursive: true })
    const bundle = chunks.join('\n')
    const modelBundle = modelChunks.join('\n')
    await writeFile(resolve(outDir, 'content-bundle.sql'), bundle, 'utf8')
    await writeFile(resolve(outDir, 'model-config.sql'), modelBundle, 'utf8')

    const summary = {
      generatedAt: new Date().toISOString(),
      courses,
      contentRows: manifest,
      modelRows: modelManifest,
      contentSha256: createHash('sha256').update(bundle).digest('hex'),
      modelSha256: createHash('sha256').update(modelBundle).digest('hex'),
    }
    await writeFile(resolve(outDir, 'bundle-manifest.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(summary, null, 2))
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
