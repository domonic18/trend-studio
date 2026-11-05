/** M10 v2 发布硬门禁：节正文里的 :::annotation / :::replay 引用在发布时须完整可解析。 */

import type { Pool } from 'pg'
import { codedConflict } from '../errors.js'
import { parseArticleDsl, type DslBlock } from '../production/dsl/parse.js'

interface AnnotationRef {
  sectionId: string
  unitId: string
  assetId: string
  code: string
  kind: string
  atMs: number
  d: string
  glossary: string[]
  line: number
}

interface ReplayRef {
  sectionId: string
  code: string
  line: number
}

interface UnitRow {
  unit_id: string
  asset_id: string
  start_ms: string | bigint
  end_ms: string | bigint
}

function parseAnnotationBody(lines: string[]): { d: string; label: string; quote: string; glossary: string[] } | undefined {
  const text = lines.join('\n').trim()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as { d: string; label: string; quote: string; glossary: string[] }
  } catch {
    return undefined
  }
}

function toDateStr(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

function plainCode(code: string): string {
  return code.replace(/^(sz|sh|bj)/, '')
}

export async function requireResolvedAnnotationsAndReplays(pool: Pool, courseId: string): Promise<void> {
  const { rows: articleRows } = await pool.query<{ section_id: string; markdown: string }>(
    `SELECT section_id, markdown FROM section_articles
      WHERE status IN ('draft', 'published')
        AND section_id IN (SELECT section_id FROM sections WHERE course_id = $1)`,
    [courseId],
  )

  const annotations: AnnotationRef[] = []
  const replays: ReplayRef[] = []
  for (const article of articleRows) {
    const parsed = parseArticleDsl(article.markdown)
    for (const block of parsed.blocks) {
      if (block.directive === 'annotation') annotations.push(...extractAnnotations(article.section_id, block))
      if (block.directive === 'replay') {
        const code = block.attrs.code
        if (code !== undefined) replays.push({ sectionId: article.section_id, code, line: block.line })
      }
    }
  }

  const unresolvedAnnotations: Array<Record<string, unknown>> = []
  if (annotations.length > 0) {
    const unitIds = [...new Set(annotations.map(a => a.unitId))]
    const assetIds = [...new Set(annotations.map(a => a.assetId))]
    const sectionCodes = [...new Set(annotations.map(a => `${a.sectionId}:${plainCode(a.code)}`))]

    const { rows: unitRows } = await pool.query<UnitRow>(
      'SELECT unit_id, asset_id, start_ms, end_ms FROM source_units WHERE unit_id = ANY($1::text[])',
      [unitIds],
    )
    const units = new Map(unitRows.map(row => [row.unit_id, {
      assetId: row.asset_id,
      startMs: Number(row.start_ms),
      endMs: Number(row.end_ms),
    }]))

    const { rows: assetRows } = await pool.query<{ asset_id: string }>(
      'SELECT asset_id FROM media_assets WHERE asset_id = ANY($1::text[])',
      [assetIds],
    )
    const assets = new Set(assetRows.map(row => row.asset_id))

    const { rows: stockRows } = await pool.query<{
      section_id: string
      code: string
      window_start: string | Date
      window_end: string | Date
    }>(
      `SELECT section_id, code, window_start::text AS window_start, window_end::text AS window_end
         FROM section_case_stocks WHERE course_id = $1`,
      [courseId],
    )
    const caseStocks = new Map(stockRows.map(row => [`${row.section_id}:${row.code}`, {
      start: toDateStr(row.window_start),
      end: toDateStr(row.window_end),
    }]))

    const { rows: conceptRows } = await pool.query<{ name: string; aliases: unknown }>(
      'SELECT name, aliases FROM concepts WHERE course_id = $1 AND status <> $2',
      [courseId, 'archived'],
    )
    const conceptNames = new Set<string>()
    for (const row of conceptRows) {
      conceptNames.add(row.name)
      for (const alias of Array.isArray(row.aliases) ? row.aliases as unknown[] : []) {
        if (typeof alias === 'string') conceptNames.add(alias)
      }
    }

    const codes = [...new Set(annotations.map(a => plainCode(a.code)))]
    const minDate = annotations.length > 0 ? annotations.map(a => a.d).sort()[0] : undefined
    const maxDate = annotations.length > 0 ? annotations.map(a => a.d).sort().at(-1) : undefined
    const { rows: quoteRows } = await pool.query<{ code: string; trade_date: string | Date }>(
      'SELECT code, trade_date FROM course_stock_quotes WHERE code = ANY($1::text[]) AND trade_date BETWEEN $2::date AND $3::date',
      [codes, minDate ?? '1970-01-01', maxDate ?? '2999-12-31'],
    )
    const tradingDays = new Set(quoteRows.map(row => `${row.code}:${toDateStr(row.trade_date)}`))

    for (const annotation of annotations) {
      const unit = units.get(annotation.unitId)
      const atMs = annotation.atMs
      const reasons: string[] = []
      if (unit === undefined) reasons.push('unit not found')
      else {
        if (unit.assetId !== annotation.assetId) reasons.push('asset mismatch')
        if (atMs < unit.startMs || atMs > unit.endMs) reasons.push('atMs out of unit window')
      }
      if (!assets.has(annotation.assetId)) reasons.push('asset not found')
      const stockKey = `${annotation.sectionId}:${plainCode(annotation.code)}`
      const stockWindow = caseStocks.get(stockKey)
      if (stockWindow === undefined) reasons.push('stock not in section')
      else {
        if (annotation.d < stockWindow.start || annotation.d > stockWindow.end) reasons.push('date out of case window')
        else if (!tradingDays.has(`${plainCode(annotation.code)}:${annotation.d}`)) reasons.push('date not a trading day')
      }
      for (const term of annotation.glossary) {
        if (!conceptNames.has(term)) reasons.push(`term not in concepts: ${term}`)
      }
      if (reasons.length > 0) {
        unresolvedAnnotations.push({
          sectionId: annotation.sectionId,
          line: annotation.line,
          unitId: annotation.unitId,
          code: annotation.code,
          d: annotation.d,
          reasons,
        })
      }
    }
  }

  const unresolvedReplays: Array<Record<string, unknown>> = []
  if (replays.length > 0) {
    const sectionIds = [...new Set(replays.map(r => r.sectionId))]
    const { rows: widgetRows } = await pool.query<{ section_id: string; code: string; count: string }>(
      `SELECT section_id, spec->>'code' AS code, count(*)::text AS count
         FROM widget_specs
        WHERE section_id = ANY($1::text[]) AND type = 'bar-replay-decision'
        GROUP BY section_id, spec->>'code'`,
      [sectionIds],
    )
    const counts = new Map(widgetRows.map(row => [`${row.section_id}:${row.code}`, Number(row.count)]))
    for (const replay of replays) {
      const count = counts.get(`${replay.sectionId}:${replay.code}`) ?? 0
      if (count !== 1) {
        unresolvedReplays.push({
          sectionId: replay.sectionId,
          line: replay.line,
          code: replay.code,
          count,
        })
      }
    }
  }

  if (unresolvedAnnotations.length > 0) {
    throw codedConflict('annotation_unresolved', 'section articles contain unresolved annotations', {
      annotations: unresolvedAnnotations,
    })
  }
  if (unresolvedReplays.length > 0) {
    throw codedConflict('replay_unproven', 'section articles reference ambiguous or missing replay widgets', {
      replays: unresolvedReplays,
    })
  }
}

function extractAnnotations(sectionId: string, block: DslBlock): AnnotationRef[] {
  const body = parseAnnotationBody(block.bodyLines)
  const d = body?.d ?? ''
  const glossary = body?.glossary ?? []
  const atMs = Number(block.attrs.atMs)
  return [{
    sectionId,
    unitId: block.attrs.unitId ?? '',
    assetId: block.attrs.assetId ?? '',
    code: block.attrs.code ?? '',
    kind: block.attrs.kind ?? '',
    atMs: Number.isNaN(atMs) ? -1 : atMs,
    d,
    glossary,
    line: block.line,
  }]
}
