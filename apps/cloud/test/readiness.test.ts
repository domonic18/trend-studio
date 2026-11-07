import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db.js'
import { runMigrations } from '../src/migrate.js'
import { seedDatabase } from '../src/seed.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://trend_coach:trend_coach@127.0.0.1:5432/trend_coach_test'
const ADMIN_USERNAME = 'admin01'
const ADMIN_PASSWORD = 'bootstrap-password-123'
const MEDIA_SECRET = 'test-media-signing-secret-1234'
const MEDIA_BASE_URL = 'http://127.0.0.1:3939/media'

const COURSE_ID = 'T-READY-01'
const CHAPTER_ID = 'CH-READY-01'

const pool = createPool(DATABASE_URL)
let app: FastifyInstance
let adminHeaders: Record<string, string>
let producerHeaders: Record<string, string>
let studentHeaders: Record<string, string>
let sectionId = ''
let mediaDir = ''
let figureDir = ''
let storageDir = ''

interface ReadinessGate {
  gate: string
  label: string
  status: 'pass' | 'fail' | 'pending'
  summary: string
  issues: { code: string; message: string; targets?: string[] }[]
}

interface ReadinessReport {
  courseId: string
  fingerprint: string
  approvedFingerprint: string | null
  gates: ReadinessGate[]
  publishable: boolean
  pending: string[]
}

function env(overrides: Record<string, unknown> = {}): Record<string, string> {
  return {
    APP_ENV: 'local',
    DATABASE_URL,
    LOG_LEVEL: 'silent',
    METRICS_TOKEN: 'test-metrics-token-1234',
    BOOTSTRAP_ADMIN_USERNAME: ADMIN_USERNAME,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    MEDIA_SIGNING_SECRET: MEDIA_SECRET,
    MEDIA_LOCAL_DIR: mediaDir,
    MEDIA_BASE_URL,
    PIPELINE_ENABLED: 'true',
    PIPELINE_STORAGE_DIR: storageDir,
    PIPELINE_HLS_DIR: mediaDir,
    PIPELINE_FIGURE_DIR: figureDir,
    RATE_LIMIT_CONTENT_PER_MINUTE: '1000',
    RATE_LIMIT_LOGIN_PER_MINUTE: '1000',
    ...overrides,
  } as Record<string, string>
}

async function login(username: string, password: string): Promise<Record<string, string>> {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/session', payload: { username, password } })
  assert.equal(response.statusCode, 200, response.body)
  return { authorization: `Bearer ${response.json().token as string}` }
}

async function createUser(username: string, role: 'producer' | 'student'): Promise<void> {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: adminHeaders,
    payload: { username, displayName: username, role, password: 'user-password-1234' },
  })
  assert.equal(created.statusCode, 201, created.body)
}

async function insertAsset(courseId: string, title: string): Promise<string> {
  const assetId = `asset_${randomBytes(8).toString('hex')}`
  await pool.query(
    `INSERT INTO media_assets (asset_id, course_id, title, status, hls_path)
     VALUES ($1, $2, $3, 'uploaded', $4)`,
    [assetId, courseId, title, `hls/${assetId}/index.m3u8`],
  )
  return assetId
}

async function readiness(headers: Record<string, string>, courseId = COURSE_ID): Promise<ReadinessReport> {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${courseId}/readiness`,
    headers,
  })
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as ReadinessReport
}

function gate(report: ReadinessReport, name: string): ReadinessGate {
  const found = report.gates.find(item => item.gate === name)
  assert.ok(found !== undefined, `缺少门禁 ${name}`)
  return found
}

before(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'trend-coach-media-'))
  figureDir = await mkdtemp(join(tmpdir(), 'trend-coach-figures-'))
  storageDir = await mkdtemp(join(tmpdir(), 'trend-coach-storage-'))
  await runMigrations(pool, { reset: true })
  await seedDatabase(pool)

  app = await buildApp({ config: loadConfig(env()), pool })
  await app.ready()

  adminHeaders = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
  await createUser('producer-rd', 'producer')
  await createUser('student-rd', 'student')
  producerHeaders = await login('producer-rd', 'user-password-1234')
  const studentToken = 'student-session-token-rd'
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, scope)
     SELECT $1, user_id, now() + interval '1 hour', 'portal' FROM users WHERE username = 'student-rd'`,
    [createHash('sha256').update(studentToken).digest('hex')],
  )
  studentHeaders = { authorization: `Bearer ${studentToken}` }

  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, title: '发布就绪度测试课程' },
  })
  assert.equal(course.statusCode, 201, course.body)

  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}/chapters`,
    headers: adminHeaders,
    payload: { chapterId: CHAPTER_ID, title: '第一章', position: 1 },
  })
  assert.equal(chapter.statusCode, 201, chapter.body)

  const assetId = await insertAsset(COURSE_ID, '就绪度素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders,
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300_000, transcriptText: '就绪度用例转写', summary: '就绪度单元' }],
    },
  })
  assert.equal(unit.statusCode, 200, unit.body)
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, chapterId: CHAPTER_ID, title: '第1节', position: 1, sourceAssetIds: [assetId] },
  })
  assert.equal(section.statusCode, 200, section.body)
  sectionId = section.json().section.sectionId as string

  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders,
    payload: { markdown: '就绪度用例的教材正文。', citations: [unitId] },
  })
  assert.equal(article.statusCode, 200, article.body)
})

after(async () => {
  await app.close()
  await pool.end()
})

test('就绪度：五道门禁齐备，未签批时签批门为 pending 且不可发布', async () => {
  const report = await readiness(adminHeaders)
  assert.equal(report.courseId, COURSE_ID)
  assert.match(report.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(report.approvedFingerprint, null)
  assert.deepEqual(report.gates.map(item => item.gate), ['figures', 'widgets', 'clips', 'annotations', 'approval'])
  assert.equal(gate(report, 'figures').status, 'pass')
  assert.equal(gate(report, 'widgets').status, 'pass')
  assert.equal(gate(report, 'clips').status, 'pass')
  assert.equal(gate(report, 'annotations').status, 'pass')
  assert.equal(gate(report, 'approval').status, 'pending')
  assert.equal(report.publishable, false)
  assert.ok(report.pending.includes('等待 operator/admin 终审签批'))

  // 未知课程 404
  const missing = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/courses/T-NOT-EXIST/readiness',
    headers: adminHeaders,
  })
  assert.equal(missing.statusCode, 404)
})

test('就绪度：producer 可读，学员 403', async () => {
  const producer = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}/readiness`,
    headers: producerHeaders,
  })
  assert.equal(producer.statusCode, 200, producer.body)

  const student = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}/readiness`,
    headers: studentHeaders,
  })
  assert.equal(student.statusCode, 403, student.body)
})

test('就绪度与发布同源：签批后卡片可发布、发布成功；改内容后卡片与发布同步报 stale', async () => {
  const approved = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}/approvals`,
    headers: adminHeaders,
    payload: { gate: 'final' },
  })
  assert.equal(approved.statusCode, 200, approved.body)
  const approvalDigest = (approved.json() as { approval: { digest: string } }).approval.digest

  const afterApproval = await readiness(adminHeaders)
  assert.equal(afterApproval.approvedFingerprint, approvalDigest)
  assert.equal(afterApproval.fingerprint, approvalDigest)
  assert.equal(gate(afterApproval, 'approval').status, 'pass')
  assert.equal(afterApproval.publishable, true)
  assert.deepEqual(afterApproval.pending, [])

  const published = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}/publish`,
    headers: adminHeaders,
  })
  assert.equal(published.statusCode, 200, published.body)
})

test('就绪度与发布同源：改内容后卡片签批门 fail、发布同样 409 stale', async () => {
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders,
    payload: { courseId: `${COURSE_ID}-2`, title: '就绪度漂移测试课程' },
  })
  assert.equal(course.statusCode, 201, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}-2/chapters`,
    headers: adminHeaders,
    payload: { chapterId: `${CHAPTER_ID}-2`, title: '第一章', position: 1 },
  })
  assert.equal(chapter.statusCode, 201, chapter.body)
  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders,
    payload: { courseId: `${COURSE_ID}-2`, chapterId: `${CHAPTER_ID}-2`, title: '第1节', position: 1 },
  })
  assert.equal(section.statusCode, 200, section.body)
  const driftedSectionId = section.json().section.sectionId as string
  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${driftedSectionId}/article`,
    headers: adminHeaders,
    payload: { markdown: '签批之前的教材正文。', citations: [] },
  })
  assert.equal(article.statusCode, 200, article.body)

  const approved = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}-2/approvals`,
    headers: adminHeaders,
    payload: { gate: 'final' },
  })
  assert.equal(approved.statusCode, 200, approved.body)
  const approvalDigest = (approved.json() as { approval: { digest: string } }).approval.digest

  const card = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}-2/readiness`,
    headers: adminHeaders,
  })
  assert.equal(card.statusCode, 200, card.body)
  const ready = card.json() as ReadinessReport
  assert.equal(gate(ready, 'approval').status, 'pass')
  assert.equal(ready.publishable, true)

  // 改教材 → 卡片签批门 fail、发布同样 409（同一份判定）
  const changed = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${driftedSectionId}/article`,
    headers: adminHeaders,
    payload: { markdown: '签批之后被改写的教材正文。', citations: [] },
  })
  assert.equal(changed.statusCode, 200, changed.body)

  const stale = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}-2/readiness`,
    headers: adminHeaders,
  })
  assert.equal(stale.statusCode, 200, stale.body)
  const staleReport = stale.json() as ReadinessReport
  assert.equal(gate(staleReport, 'approval').status, 'fail')
  assert.equal(staleReport.publishable, false)
  assert.ok(staleReport.pending.includes('内容已变更，需重新终审签批'))
  assert.equal(staleReport.approvedFingerprint, approvalDigest)
  assert.notEqual(staleReport.fingerprint, approvalDigest)

  const publishStale = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}-2/publish`,
    headers: adminHeaders,
  })
  assert.equal(publishStale.statusCode, 409, publishStale.body)
  assert.equal((publishStale.json() as { error: { code: string } }).error.code, 'approval_stale')
})

test('术语：更新别名与定义、归档可逆；术语改动会让内容指纹变化', async () => {
  const created = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, name: '缩量平台', aliases: ['缩量整理'], definition: '成交量萎缩的横盘。' },
  })
  assert.equal(created.statusCode, 200, created.body)
  const conceptId = (created.json() as { conceptId: string }).conceptId
  assert.match(conceptId, /^cpt_[0-9a-f]{16}$/)

  const listed = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/concepts?courseId=${COURSE_ID}`,
    headers: adminHeaders,
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const concepts = (listed.json() as { concepts: { conceptId: string; status: string }[] }).concepts
  assert.equal(concepts.find(item => item.conceptId === conceptId)?.status, 'draft')

  const before = await readiness(adminHeaders)

  const updated = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/concepts/${conceptId}`,
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, aliases: ['缩量整理', '低量横盘'], definition: '成交量萎缩的横盘形态。' },
  })
  assert.equal(updated.statusCode, 200, updated.body)

  const afterUpdate = await readiness(adminHeaders)
  assert.notEqual(afterUpdate.fingerprint, before.fingerprint, '术语别名/定义改动必须改指纹')

  const archived = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/concepts/${conceptId}`,
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, status: 'archived' },
  })
  assert.equal(archived.statusCode, 200, archived.body)

  const afterArchive = await readiness(adminHeaders)
  assert.notEqual(afterArchive.fingerprint, afterUpdate.fingerprint, '术语归档必须改指纹')

  const archivedList = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/concepts?courseId=${COURSE_ID}`,
    headers: adminHeaders,
  })
  assert.equal(archivedList.statusCode, 200, archivedList.body)
  const archivedConcepts = (archivedList.json() as { concepts: { conceptId: string; status: string }[] }).concepts
  assert.equal(archivedConcepts.find(item => item.conceptId === conceptId)?.status, 'archived')

  // 归档可逆：置回 draft 即恢复
  const restored = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/concepts/${conceptId}`,
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, status: 'draft' },
  })
  assert.equal(restored.statusCode, 200, restored.body)

  // 非法状态 → 400；未知术语 → 404
  const badStatus = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/concepts/${conceptId}`,
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, status: 'published' },
  })
  assert.equal(badStatus.statusCode, 400, badStatus.body)

  const unknown = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts/cpt_ffffffffffffffff',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, status: 'draft' },
  })
  assert.equal(unknown.statusCode, 404, unknown.body)
})

test('节编辑：改动落草稿并改指纹（标题 / 摘要进指纹）', async () => {
  const courseId = `${COURSE_ID}-2`
  const listed = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections?courseId=${courseId}`,
    headers: adminHeaders,
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const section = (listed.json() as { sections: { sectionId: string; position: number }[] }).sections[0]
  assert.ok(section !== undefined, '课程应有节')

  const before = await readiness(adminHeaders, courseId)
  const updated = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders,
    payload: {
      sectionId: section.sectionId,
      courseId,
      chapterId: `${CHAPTER_ID}-2`,
      title: '改过的节标题',
      position: section.position,
      summary: '改过的节摘要。',
      conceptRefs: [],
      sourceAssetIds: [],
    },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal((updated.json() as { section: { status: string } }).section.status, 'draft')

  const after = await readiness(adminHeaders, courseId)
  assert.notEqual(after.fingerprint, before.fingerprint, '节标题/摘要改动必须改指纹')
})

test('术语定义可清空：definition 传 null 落库为 null', async () => {
  const created = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, name: '待清空定义', definition: '初版定义。' },
  })
  assert.equal(created.statusCode, 200, created.body)
  const conceptId = (created.json() as { conceptId: string }).conceptId

  const cleared = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/concepts/${conceptId}`,
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, definition: null },
  })
  assert.equal(cleared.statusCode, 200, cleared.body)

  const listed = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/concepts?courseId=${COURSE_ID}`,
    headers: adminHeaders,
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const concepts = (listed.json() as { concepts: { conceptId: string; definition: string | null }[] }).concepts
  assert.equal(concepts.find(item => item.conceptId === conceptId)?.definition, null)
})
