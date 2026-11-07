import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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

const COURSE_ID = 'T-PT-01'
const CHAPTER_ID = 'CH-PT-01'

const pool = createPool(DATABASE_URL)
let app: FastifyInstance
let adminHeaders: Record<string, string>
let producerHeaders: Record<string, string>
let studentHeaders: Record<string, string>
let sectionId = ''

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

async function createUser(username: string, role: 'producer' | 'student'): Promise<void> {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: adminHeaders,
    payload: { username, displayName: username, role, password: 'user-password-1234' },
  })
  assert.equal(created.statusCode, 201, created.body)
}

before(async () => {
  await runMigrations(pool, { reset: true })
  await seedDatabase(pool)

  app = await buildApp({ config: loadConfig(env()), pool })
  await app.ready()

  adminHeaders = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
  await createUser('producer-pt', 'producer')
  await createUser('student-pt', 'student')
  producerHeaders = await login('producer-pt', 'user-password-1234')
  // 学员不能开控制台会话（登录被拒），直接落一条门户会话来验证越权被拦。
  const studentToken = 'student-session-token-pt'
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, scope)
     SELECT $1, user_id, now() + interval '1 hour', 'portal' FROM users WHERE username = 'student-pt'`,
    [createHash('sha256').update(studentToken).digest('hex')],
  )
  studentHeaders = { authorization: `Bearer ${studentToken}` }

  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, title: '生产任务测试课程' },
  })
  assert.equal(course.statusCode, 201, course.body)

  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${COURSE_ID}/chapters`,
    headers: adminHeaders,
    payload: { chapterId: CHAPTER_ID, title: '第一章', position: 1 },
  })
  assert.equal(chapter.statusCode, 201, chapter.body)

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders,
    payload: { courseId: COURSE_ID, chapterId: CHAPTER_ID, title: '第1节', position: 1 },
  })
  assert.equal(section.statusCode, 200, section.body)
  sectionId = section.json().section.sectionId as string
})

after(async () => {
  await app.close()
  await pool.end()
})

test('生产任务：按 (课程, 节, 步骤) 幂等 upsert', async () => {
  const first = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId, step: 'case_stocks', status: 'running', attempt: 1, maxAttempts: 3 },
  })
  assert.equal(first.statusCode, 200, first.body)
  const task = first.json().task as { taskId: string; step: string; status: string; attempt: number; maxAttempts: number; note: string | null }
  assert.match(task.taskId, /^pt_[0-9a-f]{16}$/)
  assert.equal(task.step, 'case_stocks')
  assert.equal(task.status, 'running')
  assert.equal(task.attempt, 1)
  assert.equal(task.maxAttempts, 3)
  assert.equal(task.note, null)

  const second = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId, step: 'case_stocks', status: 'done', note: '2 只案例股' },
  })
  assert.equal(second.statusCode, 200, second.body)
  const updated = second.json().task as { taskId: string; status: string; note: string | null }
  assert.equal(updated.taskId, task.taskId, '同一 (课程,节,步骤) 复用同一任务行')
  assert.equal(updated.status, 'done')
  assert.equal(updated.note, '2 只案例股')
})

test('生产任务：非法步骤/状态报 400，节不存在报 404', async () => {
  const badStep = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId, step: 'not_a_step', status: 'done' },
  })
  assert.equal(badStep.statusCode, 400)

  const badStatus = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId, step: 'article', status: 'finished' },
  })
  assert.equal(badStatus.statusCode, 400)

  const missing = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/production-tasks',
    headers: producerHeaders,
    payload: { courseId: COURSE_ID, sectionId: 'sec_0000000000000000', step: 'article', status: 'done' },
  })
  assert.equal(missing.statusCode, 404)
})

test('生产任务列表：按课程列出，按节过滤', async () => {
  const list = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/production-tasks?courseId=${COURSE_ID}`,
    headers: producerHeaders,
  })
  assert.equal(list.statusCode, 200, list.body)
  const tasks = list.json().tasks as { step: string; sectionId: string }[]
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0]?.step, 'case_stocks')

  const filtered = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/production-tasks?courseId=${COURSE_ID}&sectionId=${sectionId}`,
    headers: producerHeaders,
  })
  assert.equal(filtered.statusCode, 200, filtered.body)
  assert.equal((filtered.json().tasks as unknown[]).length, 1)

  const other = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/production-tasks?courseId=${COURSE_ID}&sectionId=sec_0000000000000000`,
    headers: producerHeaders,
  })
  assert.equal(other.statusCode, 200, other.body)
  assert.deepEqual(other.json().tasks, [])
})

test('生产看板：每节一行，含步骤、产出计数与最近评审结论', async () => {
  await pool.query(
    `INSERT INTO ai_runs (run_id, task_key, source, source_id, status, step_seq, started_at, finished_at, summary)
     VALUES ($1, 'content.rubric_review', 'producer', $2, 'succeeded', 1, now(), now(), $3::jsonb)`,
    [randomUUID(), sectionId, JSON.stringify({ scores: { coverage: 9 }, verdict: 'approve' })],
  )

  const board = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${COURSE_ID}/production-board`,
    headers: producerHeaders,
  })
  assert.equal(board.statusCode, 200, board.body)
  const body = board.json() as {
    courseId: string
    courseTitle: string
    sections: {
      sectionId: string
      title: string
      steps: { step: string; status: string }[]
      articleVersion: number | null
      widgetCount: number
      figureCount: number
      caseStockCount: number
      reviewVerdict: string | null
    }[]
  }
  assert.equal(body.courseId, COURSE_ID)
  assert.equal(body.courseTitle, '生产任务测试课程')
  assert.equal(body.sections.length, 1)
  const section = body.sections[0]
  assert.ok(section !== undefined)
  assert.equal(section.sectionId, sectionId)
  assert.equal(section.title, '第1节')
  assert.deepEqual(section.steps.map(step => step.step), ['case_stocks'])
  assert.equal(section.steps[0]?.status, 'done')
  assert.equal(section.articleVersion, null)
  assert.equal(section.widgetCount, 0)
  assert.equal(section.figureCount, 0)
  assert.equal(section.caseStockCount, 0)
  assert.equal(section.reviewVerdict, 'approve')
})

test('生产看板：课程不存在报 404', async () => {
  const board = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/courses/NOPE-PT/production-board',
    headers: producerHeaders,
  })
  assert.equal(board.statusCode, 404)
})

test('生产任务端点：学员 403', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/production-tasks?courseId=${COURSE_ID}`,
    headers: studentHeaders,
  })
  assert.equal(response.statusCode, 403)
})
