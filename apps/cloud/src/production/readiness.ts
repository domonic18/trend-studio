/**
 * 发布就绪度（B2）：把发布事务的硬门禁判定抽成**返回检查结果**的函数。
 *
 * 发布与就绪度卡片读同一份实现——避免「卡片全绿、点发布就 409」。
 * 每个问题的三元组（code / message / details）与历史发布冲突**逐字一致**：
 * 发布侧抛 codedConflict 三元组，就绪度侧原样呈现。
 */

import type { Pool } from 'pg'
import type { ReadinessGate } from '@trend/contracts'
import { notFound } from '../errors.js'
import { computeCourseDigest } from './digest.js'
import { parseArticleDsl, type DslBlock } from './dsl/parse.js'

const FIGURE_REF = /!\[[^\]\n]*\]\(figure:([A-Za-z0-9._-]{1,64})\)/g

export interface ReadinessIssue {
  /** 与发布冲突码同名，便于按码给中文指引。 */
  code: string
  message: string
  /** 发布冲突载荷（逐字不变）。 */
  details: Record<string, unknown>
  /** 命中对象，供界面定位。 */
  targets: string[]
  /** block=硬伤，发布会拦；pending=还没到（例：尚未签批）。 */
  severity: 'block' | 'pending'
}

export interface ReadinessGateCheck {
  gate: ReadinessGate
  label: string
  status: 'pass' | 'fail' | 'pending'
  summary: string
  issues: Array<{ code: string; message: string; targets?: string[] }>
}

/** 发布事务按此顺序取第一个有问题的检查段——与历史发布顺序一致。 */
export interface GateSegment {
  gate: ReadinessGate
  issues: ReadinessIssue[]
}

export interface ReadinessReport {
  courseId: string
  fingerprint: string
  approvedFingerprint: string | null
  gates: ReadinessGateCheck[]
  publishable: boolean
  pending: string[]
}

export interface GateRun {
  report: ReadinessReport
  segments: GateSegment[]
}

const GATE_LABELS: Record<ReadinessGate, string> = {
  figures: '图示',
  widgets: '课件断言',
  clips: '片段窗',
  annotations: '标注与回放',
  approval: '终审签批',
}

function gateStatus(issues: ReadinessIssue[]): 'pass' | 'fail' | 'pending' {
  if (issues.some(issue => issue.severity === 'block')) return 'fail'
  if (issues.length > 0) return 'pending'
  return 'pass'
}

/** 跑完全部门禁：发布事务与就绪度卡片共用这一份结果。 */
export async function runPublishGates(pool: Pool, courseId: string): Promise<GateRun> {
  const digest = await computeCourseDigest(pool, courseId)

  const chapterFigures = await checkChapterFigures(pool, courseId)
  const widgets = await checkWidgets(pool, courseId)
  const media = await checkSectionMedia(pool, courseId)
  const annotations = await checkAnnotationsAndReplays(pool, courseId)
  const approval = await checkApproval(pool, courseId, digest.digest)
  const segments: GateSegment[] = [
    { gate: 'figures', issues: chapterFigures },
    { gate: 'widgets', issues: widgets },
    { gate: 'figures', issues: media.figures },
    { gate: 'clips', issues: media.clips },
    { gate: 'annotations', issues: annotations },
    { gate: 'approval', issues: approval.issues },
  ]

  const issuesByGate = new Map<ReadinessGate, ReadinessIssue[]>([
    ['figures', [...chapterFigures, ...media.figures]],
    ['widgets', widgets],
    ['clips', media.clips],
    ['annotations', annotations],
    ['approval', approval.issues],
  ])

  const gates = (Object.keys(GATE_LABELS) as ReadinessGate[]).map(gate => {
    const issues = issuesByGate.get(gate) ?? []
    return {
      gate,
      label: GATE_LABELS[gate],
      status: gateStatus(issues),
      summary: gateSummary(gate, issues),
      issues: issues.map(issue => ({
        code: issue.code,
        message: issue.message,
        targets: issue.targets,
      })),
    }
  })

  return {
    report: {
      courseId,
      fingerprint: digest.digest,
      approvedFingerprint: approval.approvedDigest,
      gates,
      publishable: gates.every(gate => gate.status === 'pass'),
      pending: buildPending(issuesByGate),
    },
    segments,
  }
}

/** 读就绪度报告（管理台发布就绪度卡片）：与发布事务同一份判定。 */
export async function readCourseReadiness(pool: Pool, courseId: string): Promise<ReadinessReport> {
  const { rows } = await pool.query('SELECT 1 FROM courses WHERE course_id = $1', [courseId])
  if (rows.length === 0) throw notFound('course not found')
  const { report } = await runPublishGates(pool, courseId)
  return report
}

function gateSummary(gate: ReadinessGate, issues: ReadinessIssue[]): string {
  const blocked = issues.filter(issue => issue.severity === 'block').length
  switch (gate) {
    case 'figures':
      return blocked > 0 ? `${blocked} 个图示未解析` : '全部图示已选定且候选就绪'
    case 'widgets':
      return blocked > 0 ? `${blocked} 个课件缺断言证明` : '全部课件断言证明通过'
    case 'clips':
      return blocked > 0 ? `${blocked} 个片段窗未落地` : '片段窗全部落在源片段内'
    case 'annotations':
      return blocked > 0 ? `${blocked} 处标注/回放未解析` : '标注与回放引用全部可解析'
    case 'approval':
      if (issues.some(issue => issue.code === 'approval_stale')) return '内容已变更，需重新签批'
      if (issues.length > 0) return '尚未终审签批'
      return '终审签批有效'
  }
}

function buildPending(issuesByGate: Map<ReadinessGate, ReadinessIssue[]>): string[] {
  const pending: string[] = []
  const count = (gate: ReadinessGate) => (issuesByGate.get(gate) ?? []).filter(i => i.severity === 'block').length
  if (count('figures') > 0) pending.push(`解决 ${count('figures')} 个未解析图示`)
  if (count('widgets') > 0) pending.push(`补齐 ${count('widgets')} 个课件断言证明`)
  if (count('clips') > 0) pending.push(`修正 ${count('clips')} 个片段窗`)
  if (count('annotations') > 0) pending.push(`解决 ${count('annotations')} 处标注/回放引用`)
  const approval = issuesByGate.get('approval') ?? []
  if (approval.some(issue => issue.code === 'approval_stale')) pending.push('内容已变更，需重新终审签批')
  else if (approval.length > 0) pending.push('等待 operator/admin 终审签批')
  return pending
}

async function checkChapterFigures(pool: Pool, courseId: string): Promise<ReadinessIssue[]> {
  const { rows: articleRows } = await pool.query<{ chapter_id: string; markdown: string }>(
    `SELECT chapter_id, markdown FROM chapter_articles
     WHERE course_id = $1 AND status IN ('draft', 'published')`,
    [courseId],
  )
  const refs = new Map<string, string>()
  for (const article of articleRows) {
    for (const match of article.markdown.matchAll(FIGURE_REF)) {
      const figureId = match[1]
      if (figureId !== undefined) refs.set(figureId, article.chapter_id)
    }
  }
  if (refs.size === 0) return []

  const { rows } = await pool.query<{
    figure_id: string
    chapter_id: string
    selected_candidate_id: string | null
    candidate_status: string | null
  }>(
    `SELECT f.figure_id, f.chapter_id, f.selected_candidate_id, c.status AS candidate_status
     FROM figures f
     LEFT JOIN figure_candidates c ON c.candidate_id = f.selected_candidate_id
     WHERE f.course_id = $1 AND f.figure_id = ANY($2::text[])`,
    [courseId, [...refs.keys()]],
  )
  const ready = new Set<string>()
  for (const row of rows) {
    if (
      row.selected_candidate_id !== null
      && row.candidate_status === 'ready'
      && row.chapter_id === refs.get(row.figure_id)
    ) {
      ready.add(row.figure_id)
    }
  }
  const unresolved = [...refs.keys()].filter(figureId => !ready.has(figureId))
  if (unresolved.length === 0) return []
  return [{
    code: 'figure_unresolved',
    message: 'chapter article references unresolved figures',
    details: { figureIds: unresolved },
    targets: unresolved,
    severity: 'block',
  }]
}

interface SectionMediaIssues {
  figures: ReadinessIssue[]
  clips: ReadinessIssue[]
}

/** 节正文 DSL 的 figure 引用与片段窗（M10 发布硬门禁）。 */
async function checkSectionMedia(pool: Pool, courseId: string): Promise<SectionMediaIssues> {
  const { rows: articleRows } = await pool.query<{ section_id: string; markdown: string }>(
    `SELECT section_id, markdown FROM section_articles
     WHERE status IN ('draft', 'published')
       AND section_id IN (SELECT section_id FROM sections WHERE course_id = $1)`,
    [courseId],
  )

  const figureRefs = new Set<string>()
  const clips: Array<{ sectionId: string; assetId: string; from: number; to: number }> = []
  for (const article of articleRows) {
    const parsed = parseArticleDsl(article.markdown)
    for (const block of parsed.blocks) {
      if (block.directive === 'figure' && block.attrs.figureId !== undefined) {
        figureRefs.add(block.attrs.figureId)
      }
      if (block.directive === 'clip') {
        clips.push({
          sectionId: article.section_id,
          assetId: block.attrs.assetId ?? '',
          from: Number(block.attrs.from),
          to: Number(block.attrs.to),
        })
      }
    }
    for (const match of article.markdown.matchAll(FIGURE_REF)) {
      const figureId = match[1]
      if (figureId !== undefined) figureRefs.add(figureId)
    }
  }

  const figures: ReadinessIssue[] = []
  if (figureRefs.size > 0) {
    const { rows } = await pool.query<{ figure_id: string }>(
      `SELECT f.figure_id
       FROM figures f
       LEFT JOIN figure_candidates c ON c.candidate_id = f.selected_candidate_id
       WHERE f.course_id = $1 AND f.figure_id = ANY($2::text[])
         AND f.selected_candidate_id IS NOT NULL AND c.status = 'ready'`,
      [courseId, [...figureRefs]],
    )
    const resolved = new Set(rows.map(row => row.figure_id))
    const unresolved = [...figureRefs].filter(figureId => !resolved.has(figureId))
    if (unresolved.length > 0) {
      figures.push({
        code: 'figure_unresolved',
        message: 'section articles reference unresolved figures',
        details: { figureIds: unresolved },
        targets: unresolved,
        severity: 'block',
      })
    }
  }

  const unitCache = new Map<string, Array<{ startMs: number; endMs: number }>>()
  const invalid: Array<{ sectionId: string; assetId: string; from: number; to: number }> = []
  for (const clip of clips) {
    const windowOk = Number.isInteger(clip.from) && Number.isInteger(clip.to)
      && clip.from >= 0 && clip.from < clip.to && clip.to - clip.from <= 60
    if (!windowOk) {
      invalid.push(clip)
      continue
    }
    let units = unitCache.get(clip.assetId)
    if (units === undefined) {
      const { rows } = await pool.query<{ start_ms: string | bigint; end_ms: string | bigint }>(
        'SELECT start_ms, end_ms FROM source_units WHERE asset_id = $1',
        [clip.assetId],
      )
      units = rows.map(row => ({ startMs: Number(row.start_ms), endMs: Number(row.end_ms) }))
      unitCache.set(clip.assetId, units)
    }
    const fromMs = clip.from * 1000
    const toMs = clip.to * 1000
    const grounded = units.some(unit => fromMs >= unit.startMs && toMs <= unit.endMs)
    if (!grounded) invalid.push(clip)
  }
  const clipsIssue: ReadinessIssue[] = invalid.length === 0 ? [] : [{
    code: 'clip_invalid',
    message: 'section articles contain clip windows not grounded in source units',
    details: { clips: invalid },
    targets: invalid.map(clip => `${clip.sectionId}:${clip.assetId}`),
    severity: 'block',
  }]

  return { figures, clips: clipsIssue }
}

/** M9 发布硬门禁：每个课件 validation 必须覆盖其全部断言且为 pass（架构 §6.5.8）。 */
async function checkWidgets(pool: Pool, courseId: string): Promise<ReadinessIssue[]> {
  const { rows } = await pool.query<{
    widget_id: string
    assertions: unknown
    validation: unknown
  }>(
    `SELECT widget_id, assertions, validation FROM widget_specs
     WHERE course_id = $1 AND status <> 'archived'`,
    [courseId],
  )
  const unproven: string[] = []
  for (const row of rows) {
    const assertions = row.assertions as Record<string, unknown> | null
    const validation = row.validation as Record<string, unknown> | null
    if (assertions === null || assertions === undefined || validation === null || validation === undefined) {
      unproven.push(row.widget_id)
      continue
    }
    const complete = Object.keys(assertions)
      .filter(key => assertions[key] !== undefined)
      .every(key => validation[key] === 'pass')
    if (!complete) unproven.push(row.widget_id)
  }
  if (unproven.length === 0) return []
  return [{
    code: 'widget_unproven',
    message: 'course widgets have incomplete assertion proofs',
    details: { widgetIds: unproven },
    targets: unproven,
    severity: 'block',
  }]
}

/** M3b 发布硬门禁：final 审批必须存在，且当前内容指纹与签批时一致。 */
async function checkApproval(
  pool: Pool,
  courseId: string,
  currentDigest: string,
): Promise<{ issues: ReadinessIssue[]; approvedDigest: string | null }> {
  const { rows } = await pool.query<{ digest: string }>(
    `SELECT digest FROM content_approvals WHERE course_id = $1 AND gate = 'final'`,
    [courseId],
  )
  const approved = rows[0]
  if (approved === undefined) {
    return {
      issues: [{
        code: 'approval_required',
        message: 'course has no final approval',
        details: { courseId },
        targets: [courseId],
        severity: 'pending',
      }],
      approvedDigest: null,
    }
  }
  if (currentDigest !== approved.digest) {
    return {
      issues: [{
        code: 'approval_stale',
        message: 'course content changed after the final approval',
        details: {
          courseId,
          expected: approved.digest.slice(0, 16),
          actual: currentDigest.slice(0, 16),
        },
        targets: [courseId],
        severity: 'block',
      }],
      approvedDigest: approved.digest,
    }
  }
  return { issues: [], approvedDigest: approved.digest }
}

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

/** M10 v2 发布硬门禁：节正文里的 :::annotation / :::replay 引用在发布时须完整可解析。 */
async function checkAnnotationsAndReplays(pool: Pool, courseId: string): Promise<ReadinessIssue[]> {
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

  const issues: ReadinessIssue[] = []
  if (unresolvedAnnotations.length > 0) {
    issues.push({
      code: 'annotation_unresolved',
      message: 'section articles contain unresolved annotations',
      details: { annotations: unresolvedAnnotations },
      targets: unresolvedAnnotations.map(item => `${String(item.sectionId)}#L${String(item.line)}`),
      severity: 'block',
    })
  }
  if (unresolvedReplays.length > 0) {
    issues.push({
      code: 'replay_unproven',
      message: 'section articles reference ambiguous or missing replay widgets',
      details: { replays: unresolvedReplays },
      targets: unresolvedReplays.map(item => `${String(item.sectionId)}#L${String(item.line)}`),
      severity: 'block',
    })
  }
  return issues
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
