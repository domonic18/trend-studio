import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
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

const COURSE_ID = 'T-MC-01'
const CHAPTER_ID = 'CH-MC-01'

const pool = createPool(DATABASE_URL)
let app: FastifyInstance
let adminHeaders: Record<string, string>
let producerHeaders: Record<string, string>
let sectionA = ''
let sectionB = ''
let assetId = ''

function env(overrides: Record<string, unknown> = {}): Record<string, string> {
  return {
    APP_ENV: 'local',
    DATABASE_URL,
    LOG_LEVEL: 'silent',
    METRICS_TOKEN: 'test-metrics-token-1234',
    BOOTSTRAP_ADMIN_USERNAME: ADMIN_USERNAME,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
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

async function createSection(position: number, title: string): Promise<string> {
  const response = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, chapterId: CHAPTER_ID, title, position },
  })
  assert.equal(response.statusCode, 200, response.body)
  return response.json().section.sectionId as string
}

async function createAsset(title: string): Promise<string> {
  // 素材入库要起管线（ffmpeg/存储），与本测试无关；直接落一行够用（FK + 归属校验）。
  const id = `asset_${randomBytes(8).toString('hex')}`
  await pool.query(
    `INSERT INTO media_assets (asset_id, course_id, title, status) VALUES ($1, $2, $3, 'ready')`,
    [id, COURSE_ID, title],
  )
  return id
}

async function writeTask(sectionId: string, step: string, status: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId, step, status },
  })
  assert.equal(response.statusCode, 200, response.body)
}

async function stepStatuses(sectionId: string): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ step: string; status: string }>(
    'SELECT step, status FROM production_tasks WHERE section_id = $1 ORDER BY step',
    [sectionId],
  )
  return Object.fromEntries(rows.map(row => [row.step, row.status]))
}

before(async () => {
  await runMigrations(pool, { reset: true })
  await seedDatabase(pool)

  app = await buildApp({ config: loadConfig(env()), pool })
  await app.ready()

  adminHeaders = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
  await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: adminHeaders,
    payload: { username: 'producer-mc', displayName: 'producer-mc', role: 'producer', password: 'user-password-1234' },
  })
  producerHeaders = await login('producer-mc', 'user-password-1234')

  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, title: '追加素材测试课程' },
  })
  assert.equal(course.statusCode, 201, course.body)

  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}/chapters`,
    headers: producerHeaders,
    payload: { chapterId: CHAPTER_ID, title: '第一章', position: 1 },
  })
  assert.equal(chapter.statusCode, 201, chapter.body)

  sectionA = await createSection(1, '第1节')
  sectionB = await createSection(2, '第2节')
  assetId = await createAsset('第2讲 原片')
})

after(async () => {
  await app.close()
  await pool.end()
})

test('影响面：A 只补一节，B 影响全课程，C 不影响任何节', async () => {
  const onlyA = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-impact',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'A', sectionId: sectionA },
  })
  assert.equal(onlyA.statusCode, 200, onlyA.body)
  const impactA = onlyA.json() as {
    choice: string
    affectedSectionIds: string[]
    affectedTitles: string[]
    resetStepCount: number
  }
  assert.equal(impactA.choice, 'A')
  assert.deepEqual(impactA.affectedSectionIds, [sectionA])
  assert.deepEqual(impactA.affectedTitles, ['第1节'])
  assert.equal(impactA.resetStepCount, 9)

  const all = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-impact',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'B' },
  })
  assert.equal(all.statusCode, 200, all.body)
  const impactB = all.json() as { affectedSectionIds: string[]; resetStepCount: number }
  assert.deepEqual(impactB.affectedSectionIds, [sectionA, sectionB])
  assert.equal(impactB.resetStepCount, 18)

  const none = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-impact',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'C' },
  })
  assert.equal(none.statusCode, 200, none.body)
  const impactC = none.json() as { affectedSectionIds: string[]; resetStepCount: number }
  assert.deepEqual(impactC.affectedSectionIds, [])
  assert.equal(impactC.resetStepCount, 0)
})

test('影响面：A 缺 sectionId 报 400，素材不属于课程报 404', async () => {
  const missingSection = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-impact',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'A' },
  })
  assert.equal(missingSection.statusCode, 400)

  const unknownAsset = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-impact',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId: 'asset_0000000000000000', choice: 'C' },
  })
  assert.equal(unknownAsset.statusCode, 404)
})

test('决策 A：落库、重置该节九步、把新素材挂进该节素材清单', async () => {
  await writeTask(sectionA, 'case_stocks', 'done')
  await writeTask(sectionA, 'article', 'done')

  const response = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-choices',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'A', sectionId: sectionA, note: '补第1节的证据' },
  })
  assert.equal(response.statusCode, 200, response.body)
  const choice = response.json().choice as {
    choiceId: string
    choice: string
    sectionId: string | null
    affectedSectionIds: string[]
  }
  assert.match(choice.choiceId, /^pmc_[0-9a-f]{16}$/)
  assert.equal(choice.choice, 'A')
  assert.equal(choice.sectionId, sectionA)
  assert.deepEqual(choice.affectedSectionIds, [sectionA])

  const statuses = await stepStatuses(sectionA)
  assert.equal(statuses.case_stocks, 'pending')
  assert.equal(statuses.article, 'pending')
  assert.equal(statuses.figures, 'pending', '未开始的步骤也要补建为 pending，断点续跑才完整')

  const { rows } = await pool.query<{ source_asset_ids: string[] }>(
    'SELECT source_asset_ids FROM sections WHERE section_id = $1',
    [sectionA],
  )
  assert.deepEqual(rows[0]?.source_asset_ids, [assetId])

  const other = await stepStatuses(sectionB)
  assert.deepEqual(other, {}, 'A 场景不动其他节')
})

test('决策 B：全课程九步重置为 pending', async () => {
  await writeTask(sectionB, 'case_stocks', 'done')

  const response = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-choices',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'B' },
  })
  assert.equal(response.statusCode, 200, response.body)
  const choice = response.json().choice as { affectedSectionIds: string[] }
  assert.deepEqual(choice.affectedSectionIds, [sectionA, sectionB])
  assert.equal((await stepStatuses(sectionB)).case_stocks, 'pending')
})

test('决策 C：只入库，不动任何节', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/material-choices',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, assetId, choice: 'C' },
  })
  assert.equal(response.statusCode, 200, response.body)
  const choice = response.json().choice as { affectedSectionIds: string[]; sectionId: string | null }
  assert.deepEqual(choice.affectedSectionIds, [])
  assert.equal(choice.sectionId, null)
})

test('生产看板带出最近的追加素材决策', async () => {
  const board = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}/production-board`,
    headers: producerHeaders,
  })
  assert.equal(board.statusCode, 200, board.body)
  const body = board.json() as { materialChoices: { choice: string; affectedSectionIds: string[] }[] }
  assert.ok(body.materialChoices.length >= 3)
  assert.equal(body.materialChoices[0]?.choice, 'C')
})
