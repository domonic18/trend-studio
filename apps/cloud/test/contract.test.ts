import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { parse as parseYaml } from 'yaml'
import { quotesListOutput } from '@trend/contracts/catalog'
import { buildApp } from '../src/app.js'
import { AsrError, type AsrProvider } from '../src/asr/provider.js'
import type { Grant } from '../src/auth/service.js'
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db.js'
import { runMigrations } from '../src/migrate.js'
import type { QuoteFetcher } from '../src/pipeline/quotes/tencent.js'
import { signPlaybackToken } from '../src/playback/sign.js'
import { seedDatabase } from '../src/seed.js'
import { wavBase64 } from './asr-fixtures.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://trend_coach:trend_coach@127.0.0.1:5432/trend_coach_test'
const METRICS_TOKEN = 'test-metrics-token-1234'
const MEDIA_SECRET = 'test-media-signing-secret-1234'
const MEDIA_BASE_URL = 'http://127.0.0.1:3939/media'
const SEGMENT_ID = 'seg-tc101-m1-kp1-1'
const ADMIN_USERNAME = 'admin01'
const ADMIN_PASSWORD = 'bootstrap-password-123'
const STUDENT_PASSWORD = 'student-password-1234'

const pool = createPool(DATABASE_URL)
let mediaDir = ''
let figureDir = ''
let storageDir = ''
let app: FastifyInstance
let routes: string[] = []
let mainGrant: Grant
let adminToken = ''

interface SessionBody {
  token: string
  expiresAt: number
  user: { userId: string; username: string; displayName: string | null; role: string }
}

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    APP_ENV: 'local',
    DATABASE_URL,
    LOG_LEVEL: 'silent',
    METRICS_TOKEN,
    BOOTSTRAP_ADMIN_USERNAME: ADMIN_USERNAME,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    MEDIA_SIGNING_SECRET: MEDIA_SECRET,
    MEDIA_LOCAL_DIR: mediaDir,
    MEDIA_BASE_URL,
    PIPELINE_ENABLED: 'true',
    PIPELINE_STORAGE_DIR: storageDir,
    PIPELINE_HLS_DIR: mediaDir,
    PIPELINE_FIGURE_DIR: figureDir,
    SEARCH_MIN_SIMILARITY: '0.01',
    RATE_LIMIT_SEARCH_PER_MINUTE: '1000',
    RATE_LIMIT_DEVICE_CODE_PER_MINUTE: '1000',
    RATE_LIMIT_EVENTS_PER_MINUTE: '1000',
    RATE_LIMIT_PROGRESS_PER_MINUTE: '1000',
    RATE_LIMIT_LOGIN_PER_MINUTE: '1000',
    RATE_LIMIT_INVITE_PER_MINUTE: '1000',
    RATE_LIMIT_DEVICE_APPROVE_PER_MINUTE: '1000',
    RATE_LIMIT_ASR_PER_MINUTE: '1000',
    RATE_LIMIT_DEVICE_TOKEN_PER_MINUTE: '1000',
    RATE_LIMIT_REFRESH_PER_MINUTE: '1000',
    RATE_LIMIT_CATALOG_PER_MINUTE: '1000',
    RATE_LIMIT_CONTENT_PER_MINUTE: '1000',
    ...overrides,
  }
}

const fakeAsr: AsrProvider = {
  async transcribe(_wav, durationMs) {
    if (durationMs === 1500) return ` ${String.fromCharCode(7)} `
    if (durationMs === 2000) throw new AsrError('rate_limited')
    if (durationMs === 2500) throw new AsrError('unavailable')
    if (durationMs === 3000) throw new AsrError('invalid_response')
    return '趋势反转的初步信号有哪些？'
  },
}

/** 行情拉取替身：按 symbol 返回固定日K，避免测试打外网。 */
const fakeQuoteFetcher: QuoteFetcher = async (symbol: string) => {
  if (symbol !== 'sz000713') throw new Error(`unexpected symbol ${symbol}`)
  return [
    { tradeDate: '2026-11-03', open: 8.1, high: 8.5, low: 8.0, close: 8.4, volume: 120_000 },
    { tradeDate: '2026-11-04', open: 8.4, high: 8.8, low: 8.3, close: 8.7, volume: 135_500 },
  ]
}

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${adminToken}` }
}

function usernameFor(deviceId: string): string {
  return `u${deviceId.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`.slice(0, 32)
}

async function adminCreateUser(payload: Record<string, unknown>): Promise<{ statusCode: number; body: any }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: adminHeaders(),
    payload,
  })
  return { statusCode: response.statusCode, body: response.json() }
}

async function ensureStudent(deviceId: string, displayName: string): Promise<string> {
  const username = usernameFor(deviceId)
  const created = await adminCreateUser({ username, displayName, role: 'student', password: STUDENT_PASSWORD })
  assert.ok(created.statusCode === 201 || created.statusCode === 409, JSON.stringify(created.body))
  return username
}

async function loginSession(username: string, password: string): Promise<{ statusCode: number; body: SessionBody & { error?: string } }> {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/session', payload: { username, password } })
  return { statusCode: response.statusCode, body: response.json() as SessionBody & { error?: string } }
}

function authHeaders(grant: Grant): Record<string, string> {
  return { authorization: `Bearer ${grant.accessToken}`, 'x-device-id': grant.deviceId }
}

async function grantFor(deviceId: string, displayName = '测试学员'): Promise<Grant> {
  const username = await ensureStudent(deviceId, displayName)
  const start = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/code',
    payload: { clientId: 'dsh-plugin-trend-coach', deviceId },
  })
  assert.equal(start.statusCode, 200, start.body)
  const { deviceCode, userCode } = start.json() as { deviceCode: string; userCode: string }

  const pending = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  assert.equal(pending.json().status, 'pending')

  const approve = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    payload: { userCode, username, password: STUDENT_PASSWORD },
  })
  assert.equal(approve.statusCode, 200, approve.body)

  const poll = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  const body = poll.json() as { status: string; grant?: Grant }
  assert.equal(body.status, 'authorized')
  const grant = body.grant
  assert.ok(grant !== undefined)
  return grant
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

async function userIdFor(deviceId: string): Promise<string> {
  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM devices WHERE device_id = $1',
    [deviceId],
  )
  const userId = rows[0]?.user_id
  assert.ok(userId !== undefined)
  return userId
}

before(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), 'trend-coach-media-'))
  figureDir = await mkdtemp(join(tmpdir(), 'trend-coach-figures-'))
  storageDir = await mkdtemp(join(tmpdir(), 'trend-coach-storage-'))
  await mkdir(join(mediaDir, 'hls'), { recursive: true })
  await writeFile(join(mediaDir, 'hls', 'index.m3u8'), [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x00000000000000000000000000000001',
    '#EXTINF:10.0,',
    'seg0001.ts',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n'))
  await writeFile(join(mediaDir, 'hls', 'enc.key'), Buffer.alloc(16, 7))
  await writeFile(join(mediaDir, 'hls', 'seg0001.ts'), Buffer.alloc(1024, 9))

  await runMigrations(pool, { reset: true })
  await seedDatabase(pool)

  const config = loadConfig(env())
  app = await buildApp({
    config,
    pool,
    asr: fakeAsr,
    quotes: fakeQuoteFetcher,
    onRoute: (method, url) => routes.push(`${method} ${url}`),
  })
  await app.ready()

  const admin = await loginSession(ADMIN_USERNAME, ADMIN_PASSWORD)
  assert.equal(admin.statusCode, 200, JSON.stringify(admin.body))
  assert.equal(admin.body.user.role, 'admin')
  adminToken = admin.body.token

  mainGrant = await grantFor('device-main-0001')
})

after(async () => {
  await app.close()
  await pool.end()
  await rm(mediaDir, { recursive: true, force: true })
  await rm(figureDir, { recursive: true, force: true })
  await rm(storageDir, { recursive: true, force: true })
})

test('GET /health 报告数据库可用', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true })
})

test('GET /metrics 需要指标令牌', async () => {
  const denied = await app.inject({ method: 'GET', url: '/metrics' })
  assert.equal(denied.statusCode, 401)

  const response = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] ?? '', /text\/plain/)
  assert.match(response.body, /trend_coach_http_requests_total/)
  assert.match(response.body, /trend_coach_http_request_duration_seconds/)
})

test('OpenAPI 与注册路由双向一致', async () => {
  const document = parseYaml(
    await readFile(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'),
  ) as { paths: Record<string, Record<string, unknown>> }
  const documented = new Set<string>()
  const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item)) {
      if (METHODS.has(method)) documented.add(`${method.toUpperCase()} ${path}`)
    }
  }
  const registered = new Set(
    routes
      .map(route => route.replace(/:([A-Za-z0-9_]+)/g, '{$1}'))
      // HEAD 由 GET 自动注册；/device、/media/*、/metrics、/admin 与门户静态资源是运维入口，不对外发布契约。
      .filter(route => !route.startsWith('HEAD '))
      .filter(route => route !== 'OPTIONS *')
      .filter(route => !route.endsWith(' /device'))
      .filter(route => !route.includes(' /media/'))
      .filter(route => !route.includes(' /admin'))
      .filter(route => route !== 'GET /metrics')
      .filter(route => !/^GET \/(assets\/|downloads\/)/.test(route))
      .filter(route => !/^GET \/.*\.html$/.test(route))
      .filter(route => !['GET /routes.json', 'GET /sitemap.xml', 'GET /robots.txt', 'GET /favicon.ico'].includes(route)),
  )
  assert.deepEqual([...registered].sort(), [...documented].sort())
})

test('设备码：待批准、错误凭据、批准、重复轮询', async () => {
  const start = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/code',
    payload: { clientId: 'unknown-client', deviceId: 'device-code-0001' },
  })
  assert.equal(start.statusCode, 400)

  const created = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/code',
    payload: { clientId: 'dsh-plugin-trend-coach', deviceId: 'device-code-0001' },
  })
  assert.equal(created.statusCode, 200)
  const { deviceCode, userCode, verificationUri, expiresIn, interval } = created.json() as {
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
  }
  assert.match(userCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal(verificationUri, `http://127.0.0.1:3939/device?code=${userCode}`)
  assert.equal(expiresIn, 300)
  assert.equal(interval, 2)

  const username = await ensureStudent('device-code-0001', '设备学员')

  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    payload: { userCode, username, password: 'wrong-password-123' },
  })
  assert.equal(wrongPassword.statusCode, 401)

  const unknownAccount = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    payload: { userCode, username: 'nobody-01', password: 'wrong-password-123' },
  })
  assert.equal(unknownAccount.statusCode, 401)

  // 设备码无效时先返回 404，不消耗一次密码校验。
  const badCode = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    payload: { userCode: 'ZZZZ-ZZZZ', username, password: STUDENT_PASSWORD },
  })
  assert.equal(badCode.statusCode, 404)

  const pending = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  assert.deepEqual(pending.json(), { status: 'pending' })

  const approved = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    payload: { userCode, username, password: STUDENT_PASSWORD },
  })
  assert.equal(approved.statusCode, 200)
  assert.deepEqual(approved.json(), { approved: true })

  const authorized = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  const grant = authorized.json() as { status: string; grant: Grant }
  assert.equal(grant.status, 'authorized')
  assert.equal(grant.grant.deviceId, 'device-code-0001')
  assert.ok(grant.grant.expiresAt > Date.now())

  const replay = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  assert.deepEqual(replay.json(), { status: 'expired' })
})

test('设备码：运营账号会话可直接批准并绑定自身', async () => {
  const username = 'operator-device-01'
  const created = await adminCreateUser({
    username,
    displayName: '运营设备',
    role: 'operator',
    password: 'operator-password-123',
  })
  assert.equal(created.statusCode, 201, JSON.stringify(created.body))

  const session = await loginSession(username, 'operator-password-123')
  assert.equal(session.statusCode, 200, JSON.stringify(session.body))

  const start = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/code',
    payload: { clientId: 'dsh-plugin-trend-coach', deviceId: 'device-session-0001' },
  })
  const { deviceCode, userCode } = start.json() as { deviceCode: string; userCode: string }

  const approve = await app.inject({
    method: 'POST',
    url: '/v1/auth/device/approve',
    headers: { authorization: `Bearer ${session.body.token}` },
    payload: { userCode },
  })
  assert.equal(approve.statusCode, 200, approve.body)

  const poll = await app.inject({ method: 'POST', url: '/v1/auth/device/token', payload: { deviceCode } })
  const grant = (poll.json() as { status: string; grant: Grant }).grant
  assert.equal(grant.deviceId, 'device-session-0001')

  const { rows } = await pool.query<{ role: string }>(
    'SELECT u.role FROM devices d JOIN users u ON u.user_id = d.user_id WHERE d.device_id = $1',
    [grant.deviceId],
  )
  assert.equal(rows[0]?.role, 'operator')
})

test('账号：管理员登录、会话查询与注销', async () => {
  const wrong = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    payload: { username: ADMIN_USERNAME, password: 'wrong-password-123' },
  })
  assert.equal(wrong.statusCode, 401)

  const created = await loginSession(ADMIN_USERNAME, ADMIN_PASSWORD)
  assert.equal(created.statusCode, 200, JSON.stringify(created.body))
  assert.equal(created.body.user.username, ADMIN_USERNAME)
  assert.equal(created.body.user.role, 'admin')
  assert.ok(created.body.expiresAt > Date.now())

  const current = await app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { authorization: `Bearer ${created.body.token}` },
  })
  assert.equal(current.statusCode, 200)
  assert.equal((current.json() as SessionBody).user.username, ADMIN_USERNAME)

  const deleted = await app.inject({
    method: 'DELETE',
    url: '/v1/auth/session',
    headers: { authorization: `Bearer ${created.body.token}` },
  })
  assert.equal(deleted.statusCode, 200)
  assert.deepEqual(deleted.json(), { revoked: true })

  const after = await app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { authorization: `Bearer ${created.body.token}` },
  })
  assert.equal(after.statusCode, 401)

  const anonymous = await app.inject({ method: 'GET', url: '/v1/auth/session' })
  assert.equal(anonymous.statusCode, 401)
})

test('账号：学员不可登录后台，运营只读，匿名不可访问', async () => {
  const student = await adminCreateUser({
    username: 'student-role-01',
    displayName: '学员角色',
    role: 'student',
    password: STUDENT_PASSWORD,
  })
  assert.equal(student.statusCode, 201, JSON.stringify(student.body))
  const studentLogin = await loginSession('student-role-01', STUDENT_PASSWORD)
  assert.equal(studentLogin.statusCode, 403)

  const operator = await adminCreateUser({
    username: 'operator-role-01',
    displayName: '运营角色',
    role: 'operator',
    password: 'operator-password-123',
  })
  assert.equal(operator.statusCode, 201, JSON.stringify(operator.body))
  const operatorLogin = await loginSession('operator-role-01', 'operator-password-123')
  assert.equal(operatorLogin.statusCode, 200, JSON.stringify(operatorLogin.body))
  const operatorHeaders = { authorization: `Bearer ${operatorLogin.body.token}` }

  const list = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: operatorHeaders })
  assert.equal(list.statusCode, 200, list.body)
  assert.ok((list.json() as { users: unknown[] }).users.length > 0)

  const createDenied = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: operatorHeaders,
    payload: { username: 'new-user-01', displayName: '新用户', role: 'student', password: STUDENT_PASSWORD },
  })
  assert.equal(createDenied.statusCode, 403)

  const targetId = (student.body as { user: { userId: string } }).user.userId
  const resetDenied = await app.inject({
    method: 'POST',
    url: `/v1/admin/users/${targetId}/reset`,
    headers: operatorHeaders,
    payload: { password: 'another-password-123' },
  })
  assert.equal(resetDenied.statusCode, 403)

  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/users' })
  assert.equal(anonymous.statusCode, 401)
})

test('账号：邀请码设置密码、单次使用与改密吊销会话', async () => {
  const created = await adminCreateUser({
    username: 'invite-user-01',
    displayName: '邀请用户',
    role: 'operator',
  })
  assert.equal(created.statusCode, 201, JSON.stringify(created.body))
  const { inviteCode } = created.body as { inviteCode: string }
  assert.match(inviteCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const beforeRedeem = await loginSession('invite-user-01', 'whatever-password-12')
  assert.equal(beforeRedeem.statusCode, 401)

  const redeemed = await app.inject({
    method: 'POST',
    url: '/v1/auth/invite/redeem',
    payload: { inviteCode: inviteCode.toLowerCase(), password: 'invited-password-123' },
  })
  assert.equal(redeemed.statusCode, 200, redeemed.body)
  assert.deepEqual(redeemed.json(), { redeemed: true })

  const session = await loginSession('invite-user-01', 'invited-password-123')
  assert.equal(session.statusCode, 200, JSON.stringify(session.body))

  const changed = await app.inject({
    method: 'POST',
    url: '/v1/auth/session/password',
    headers: { authorization: `Bearer ${session.body.token}` },
    payload: { currentPassword: 'invited-password-123', newPassword: 'changed-password-123' },
  })
  assert.equal(changed.statusCode, 200, changed.body)
  assert.deepEqual(changed.json(), { updated: true })

  const oldSession = await app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: { authorization: `Bearer ${session.body.token}` },
  })
  assert.equal(oldSession.statusCode, 401)

  assert.equal((await loginSession('invite-user-01', 'invited-password-123')).statusCode, 401)
  assert.equal((await loginSession('invite-user-01', 'changed-password-123')).statusCode, 200)

  const reuse = await app.inject({
    method: 'POST',
    url: '/v1/auth/invite/redeem',
    payload: { inviteCode, password: 'another-password-123' },
  })
  assert.equal(reuse.statusCode, 401)

  const badCode = await app.inject({
    method: 'POST',
    url: '/v1/auth/invite/redeem',
    payload: { inviteCode: 'not-a-code', password: 'another-password-123' },
  })
  assert.equal(badCode.statusCode, 401)
})

test('账号：重置凭据、禁用、列表筛选与自身保护', async () => {
  const created = await adminCreateUser({
    username: 'reset-user-01',
    displayName: '待重置',
    role: 'operator',
    password: 'initial-password-123',
  })
  assert.equal(created.statusCode, 201, JSON.stringify(created.body))
  const userId = (created.body as { user: { userId: string } }).user.userId

  const rotated = await app.inject({
    method: 'POST',
    url: `/v1/admin/users/${userId}/reset`,
    headers: adminHeaders(),
    payload: { password: 'rotated-password-123' },
  })
  assert.equal(rotated.statusCode, 200, rotated.body)
  assert.deepEqual(rotated.json(), { updated: true })
  assert.equal((await loginSession('reset-user-01', 'rotated-password-123')).statusCode, 200)
  assert.equal((await loginSession('reset-user-01', 'initial-password-123')).statusCode, 401)

  const invited = await app.inject({
    method: 'POST',
    url: `/v1/admin/users/${userId}/reset`,
    headers: adminHeaders(),
  })
  assert.equal(invited.statusCode, 200, invited.body)
  const { inviteCode } = invited.json() as { inviteCode: string }
  assert.match(inviteCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const redeemed = await app.inject({
    method: 'POST',
    url: '/v1/auth/invite/redeem',
    payload: { inviteCode, password: 'reissued-password-123' },
  })
  assert.equal(redeemed.statusCode, 200, redeemed.body)

  const filtered = await app.inject({
    method: 'GET',
    url: '/v1/admin/users?role=operator&query=reset-user&limit=10',
    headers: adminHeaders(),
  })
  assert.equal(filtered.statusCode, 200, filtered.body)
  const page = filtered.json() as { users: { username: string | null; role: string }[]; limit: number; offset: number }
  assert.equal(page.limit, 10)
  assert.equal(page.offset, 0)
  assert.deepEqual(page.users.map(user => user.username), ['reset-user-01'])

  for (const query of ['role=root', 'limit=0', 'limit=101', 'offset=-1']) {
    const invalid = await app.inject({
      method: 'GET',
      url: `/v1/admin/users?${query}`,
      headers: adminHeaders(),
    })
    assert.equal(invalid.statusCode, 400, query)
  }

  const disabled = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/users/${userId}`,
    headers: adminHeaders(),
    payload: { status: 'disabled' },
  })
  assert.equal(disabled.statusCode, 200, disabled.body)
  assert.equal((await loginSession('reset-user-01', 'reissued-password-123')).statusCode, 401)

  const current = await app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    headers: adminHeaders(),
  })
  const adminId = (current.json() as SessionBody).user.userId
  const selfRole = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/users/${adminId}`,
    headers: adminHeaders(),
    payload: { role: 'student' },
  })
  assert.equal(selfRole.statusCode, 403)
  const selfReset = await app.inject({
    method: 'POST',
    url: `/v1/admin/users/${adminId}/reset`,
    headers: adminHeaders(),
    payload: { password: 'whatever-password-12' },
  })
  assert.equal(selfReset.statusCode, 403)
})

test('内容管理：角色边界、课程结构、文章版本与片段校验', async () => {
  const operator = await adminCreateUser({
    username: 'content-operator-01',
    displayName: '内容运营',
    role: 'operator',
    password: 'operator-password-123',
  })
  assert.equal(operator.statusCode, 201, JSON.stringify(operator.body))
  const login = await loginSession('content-operator-01', 'operator-password-123')
  assert.equal(login.statusCode, 200, JSON.stringify(login.body))
  const operatorHeaders = { authorization: `Bearer ${login.body.token}` }

  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/content/courses' })
  assert.equal(anonymous.statusCode, 401)
  const deviceToken = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/courses',
    headers: authHeaders(mainGrant),
  })
  assert.equal(deviceToken.statusCode, 401)

  const courseId = 'T-M3-2-01'
  const chapterId = 'C1'
  const pointId = 'T-M3-2-KP1'
  const segmentId = 'seg-tm32-c1-kp1-1'

  const createdCourse = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: operatorHeaders,
    payload: { courseId, title: '内容管理测试课程' },
  })
  assert.equal(createdCourse.statusCode, 201, createdCourse.body)
  assert.deepEqual(createdCourse.json(), {
    course: { courseId, title: '内容管理测试课程', status: 'draft' },
  })

  const duplicateCourse = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: operatorHeaders,
    payload: { courseId, title: '重复课程' },
  })
  assert.equal(duplicateCourse.statusCode, 409)

  const invalidCourse = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: operatorHeaders,
    payload: { courseId: 'bad id', title: '非法 ID' },
  })
  assert.equal(invalidCourse.statusCode, 400)

  const emptyCreated = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: operatorHeaders,
    payload: { courseId: 'T-M3-2-EMPTY', title: '空课程' },
  })
  assert.equal(emptyCreated.statusCode, 201, emptyCreated.body)
  const emptyTree = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/courses/T-M3-2-EMPTY',
    headers: operatorHeaders,
  })
  assert.deepEqual(emptyTree.json(), {
    course: { courseId: 'T-M3-2-EMPTY', title: '空课程', status: 'draft' },
    chapters: [],
  })

  const createdChapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: operatorHeaders,
    payload: { chapterId, title: '第一章', position: 1 },
  })
  assert.equal(createdChapter.statusCode, 201, createdChapter.body)
  assert.equal((await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: operatorHeaders,
    payload: { chapterId, title: '重复章节' },
  })).statusCode, 409)

  const missingCourseChapter = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses/NOPE-404/chapters',
    headers: operatorHeaders,
    payload: { chapterId: 'C9', title: '不存在' },
  })
  assert.equal(missingCourseChapter.statusCode, 404)

  const createdPoint = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters/${chapterId}/knowledge-points`,
    headers: operatorHeaders,
    payload: { knowledgePointId: pointId, title: '知识点一', position: 1 },
  })
  assert.equal(createdPoint.statusCode, 201, createdPoint.body)
  assert.deepEqual(createdPoint.json(), {
    knowledgePoint: {
      knowledgePointId: pointId,
      title: '知识点一',
      position: 1,
      segmentCount: 0,
    },
  })

  const patchedPoint = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/knowledge-points/${pointId}`,
    headers: operatorHeaders,
    payload: { title: '知识点一（改）' },
  })
  assert.equal(patchedPoint.statusCode, 200, patchedPoint.body)
  assert.equal((patchedPoint.json() as { knowledgePoint: { title: string } }).knowledgePoint.title, '知识点一（改）')

  const patchedChapter = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/courses/${courseId}/chapters/${chapterId}`,
    headers: operatorHeaders,
    payload: { position: 2 },
  })
  assert.equal(patchedChapter.statusCode, 200, patchedChapter.body)
  assert.equal((patchedChapter.json() as { chapter: { position: number } }).chapter.position, 2)

  const emptyPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/courses/${courseId}`,
    headers: operatorHeaders,
    payload: {},
  })
  assert.equal(emptyPatch.statusCode, 400)

  const patchedCourse = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/courses/${courseId}`,
    headers: operatorHeaders,
    payload: { status: 'published' },
  })
  assert.equal(patchedCourse.statusCode, 200, patchedCourse.body)
  assert.equal((patchedCourse.json() as { course: { status: string } }).course.status, 'published')

  const articleUrl = `/v1/admin/content/courses/${courseId}/chapters/${chapterId}/article`
  const noArticle = await app.inject({
    method: 'GET',
    url: articleUrl,
    headers: operatorHeaders,
  })
  assert.equal(noArticle.statusCode, 200)
  assert.deepEqual(noArticle.json(), { article: null })

  const firstArticle = await app.inject({
    method: 'PUT',
    url: articleUrl,
    headers: operatorHeaders,
    payload: { markdown: '# 标题\n\n正文', status: 'published' },
  })
  assert.equal(firstArticle.statusCode, 200, firstArticle.body)
  const firstBody = (firstArticle.json() as { article: { version: number; status: string; publishedAt: number | null } }).article
  assert.equal(firstBody.version, 1)
  assert.equal(firstBody.status, 'published')
  assert.ok(typeof firstBody.publishedAt === 'number')

  const secondArticle = await app.inject({
    method: 'PUT',
    url: articleUrl,
    headers: operatorHeaders,
    payload: { markdown: '# 标题\n\n正文（改）', status: 'draft' },
  })
  const secondBody = (secondArticle.json() as { article: { version: number; status: string; publishedAt: number | null } }).article
  assert.equal(secondBody.version, 2)
  assert.equal(secondBody.status, 'draft')
  assert.equal(secondBody.publishedAt, firstBody.publishedAt)

  for (const markdown of [
    '<script>alert(1)</script>',
    '<div onclick="x()">x</div>',
    '[x](javascript:alert(1))',
    '<iframe src="x"></iframe>',
  ]) {
    const unsafe = await app.inject({
      method: 'PUT',
      url: articleUrl,
      headers: operatorHeaders,
      payload: { markdown, status: 'draft' },
    })
    assert.equal(unsafe.statusCode, 400, markdown)
  }

  const tooLongArticle = await app.inject({
    method: 'PUT',
    url: articleUrl,
    headers: operatorHeaders,
    payload: { markdown: 'a'.repeat(20001), status: 'draft' },
  })
  assert.equal(tooLongArticle.statusCode, 400)

  const externalImage = await app.inject({
    method: 'PUT',
    url: articleUrl,
    headers: operatorHeaders,
    payload: { markdown: '![外链](https://example.com/a.png)', status: 'draft' },
  })
  assert.equal(externalImage.statusCode, 400)

  const badRange = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/segments',
    headers: operatorHeaders,
    payload: {
      segmentId,
      courseId,
      chapterId,
      knowledgePointId: pointId,
      title: '片段',
      startSec: 100,
      endSec: 100,
      text: '文本',
    },
  })
  assert.equal(badRange.statusCode, 400)

  const unknownPoint = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/segments',
    headers: operatorHeaders,
    payload: {
      segmentId,
      courseId,
      chapterId,
      knowledgePointId: 'T-M3-2-MISSING',
      title: '片段',
      startSec: 0,
      endSec: 100,
      text: '文本',
    },
  })
  assert.equal(unknownPoint.statusCode, 404)

  const mismatchedPoint = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/segments',
    headers: operatorHeaders,
    payload: {
      segmentId,
      courseId: 'T-M3-2-EMPTY',
      chapterId,
      knowledgePointId: pointId,
      title: '片段',
      startSec: 0,
      endSec: 100,
      text: '文本',
    },
  })
  assert.equal(mismatchedPoint.statusCode, 400)

  const createdSegment = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/segments',
    headers: operatorHeaders,
    payload: {
      segmentId,
      courseId,
      chapterId,
      knowledgePointId: pointId,
      title: '片段一',
      startSec: 0,
      endSec: 100,
      text: '趋势的定义',
      status: 'published',
    },
  })
  assert.equal(createdSegment.statusCode, 201, createdSegment.body)
  const segment = (createdSegment.json() as { segment: { status: string; hasEmbedding: boolean } }).segment
  assert.equal(segment.status, 'published')
  assert.equal(segment.hasEmbedding, false)

  const duplicateSegment = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/segments',
    headers: operatorHeaders,
    payload: {
      segmentId,
      courseId,
      chapterId,
      knowledgePointId: pointId,
      title: '重复片段',
      startSec: 0,
      endSec: 100,
      text: '重复',
    },
  })
  assert.equal(duplicateSegment.statusCode, 409)

  const listed = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/segments?courseId=${courseId}&knowledgePointId=${pointId}&status=published&query=${encodeURIComponent('趋势')}&offset=0&limit=10`,
    headers: operatorHeaders,
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const page = listed.json() as { segments: { segmentId: string }[]; total: number; offset: number; limit: number }
  assert.equal(page.total, 1)
  assert.equal(page.offset, 0)
  assert.equal(page.limit, 10)
  assert.deepEqual(page.segments.map(item => item.segmentId), [segmentId])

  const emptyListing = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/segments?query=not-present-keyword',
    headers: operatorHeaders,
  })
  assert.equal((emptyListing.json() as { total: number }).total, 0)

  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'status=invalid', 'courseId=bad%20id']) {
    const invalid = await app.inject({
      method: 'GET',
      url: `/v1/admin/content/segments?${query}`,
      headers: operatorHeaders,
    })
    assert.equal(invalid.statusCode, 400, query)
  }

  const patchedSegment = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/segments/${segmentId}`,
    headers: operatorHeaders,
    payload: { text: '趋势的定义（改）', startSec: 10 },
  })
  assert.equal(patchedSegment.statusCode, 200, patchedSegment.body)
  const patchedBody = (patchedSegment.json() as {
    segment: { startSec: number; endSec: number; text: string; hasEmbedding: boolean }
  }).segment
  assert.equal(patchedBody.startSec, 10)
  assert.equal(patchedBody.endSec, 100)
  assert.equal(patchedBody.text, '趋势的定义（改）')
  assert.equal(patchedBody.hasEmbedding, false)

  const narrowed = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/segments/${segmentId}`,
    headers: operatorHeaders,
    payload: { startSec: 120 },
  })
  assert.equal(narrowed.statusCode, 400)

  const emptySegmentPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/segments/${segmentId}`,
    headers: operatorHeaders,
    payload: {},
  })
  assert.equal(emptySegmentPatch.statusCode, 400)

  const missingSegment = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/content/segments/seg-tm32-missing',
    headers: operatorHeaders,
    payload: { title: '不存在' },
  })
  assert.equal(missingSegment.statusCode, 404)

  const tree = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/courses/${courseId}`,
    headers: operatorHeaders,
  })
  assert.equal(tree.statusCode, 200, tree.body)
  const treeBody = tree.json() as {
    course: { status: string }
    chapters: {
      article: { version: number; status: string } | null
      figureCount: number
      knowledgePoints: { segmentCount: number }[]
    }[]
  }
  assert.equal(treeBody.course.status, 'published')
  assert.equal(treeBody.chapters[0]?.knowledgePoints[0]?.segmentCount, 1)
  assert.equal(treeBody.chapters[0]?.article?.version, 2)
  assert.equal(treeBody.chapters[0]?.article?.status, 'draft')
  assert.equal(treeBody.chapters[0]?.figureCount, 0)

  const courses = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/courses',
    headers: operatorHeaders,
  })
  const summary = (courses.json() as {
    courses: {
      courseId: string
      title: string
      status: string
      chapterCount: number
      knowledgePointCount: number
      segmentCount: number
      chapterArticleCount: number
      figureCount: number
    }[]
  }).courses.find(item => item.courseId === courseId)
  assert.deepEqual(summary, {
    courseId,
    title: '内容管理测试课程',
    status: 'published',
    chapterCount: 1,
    knowledgePointCount: 1,
    segmentCount: 1,
    chapterArticleCount: 1,
    figureCount: 0,
  })

  const reindex = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/reindex',
    headers: operatorHeaders,
    payload: { courseId },
  })
  assert.equal(reindex.statusCode, 409)

  const archived = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/content/courses/${courseId}`,
    headers: operatorHeaders,
    payload: { status: 'archived' },
  })
  assert.equal(archived.statusCode, 200, archived.body)
  const studentTree = await app.inject({
    method: 'GET',
    url: `/v1/catalog/courses/${courseId}`,
    headers: authHeaders(mainGrant),
  })
  assert.equal(studentTree.statusCode, 404)
})

test('鉴权：缺失、无效令牌与设备不匹配', async () => {
  const missing = await app.inject({ method: 'POST', url: '/v1/kb/search', payload: { query: '均线' } })
  assert.equal(missing.statusCode, 401)

  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: { authorization: 'Bearer not-a-token', 'x-device-id': mainGrant.deviceId },
    payload: { query: '均线' },
  })
  assert.equal(invalid.statusCode, 401)

  const mismatch = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: { authorization: `Bearer ${mainGrant.accessToken}`, 'x-device-id': 'device-other-0001' },
    payload: { query: '均线' },
  })
  assert.equal(mismatch.statusCode, 403)
})

test('检索：命中、topK、过滤与入参边界', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(mainGrant),
    payload: { query: '  均线  ', topK: 3 },
  })
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json() as {
    segments: { segmentId: string; score: number; startSec: number; endSec: number; title: string; text: string }[]
    relatedKnowledgePoints: unknown[]
  }
  assert.ok(body.segments.length > 0)
  assert.ok(body.segments.length <= 3)
  for (const segment of body.segments) {
    assert.match(segment.segmentId, /^seg-[A-Za-z0-9._-]+$/)
    assert.ok(segment.score >= 0 && segment.score <= 1)
    assert.ok(segment.startSec < segment.endSec)
    assert.ok(segment.title.length > 0 && segment.text.length > 0)
  }
  assert.deepEqual(body.relatedKnowledgePoints, [])

  const filtered = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(mainGrant),
    payload: { query: '均线', courseId: 'NOPE' },
  })
  assert.equal(filtered.statusCode, 200)
  assert.deepEqual(filtered.json(), { segments: [], relatedKnowledgePoints: [] })

  const invalidBodies: (Record<string, unknown> | unknown[])[] = [
    { query: '   ' },
    { query: '好'.repeat(501) },
    { query: '均线', topK: 0 },
    { query: '均线', topK: 21 },
    { query: '均线', topK: 1.5 },
    { query: '均线', courseId: 'bad course' },
    [],
  ]
  for (const payload of invalidBodies) {
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/kb/search',
      headers: authHeaders(mainGrant),
      payload,
    })
    assert.equal(invalid.statusCode, 400, JSON.stringify(payload))
  }
})

test('检索：空召回时回退到相关知识点', async () => {
  await pool.query("UPDATE segments SET status = 'archived'")
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kb/search',
      headers: authHeaders(mainGrant),
      payload: { query: '均线' },
    })
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json() as {
      segments: unknown[]
      relatedKnowledgePoints: { knowledgePointId: string; title: string }[]
    }
    assert.deepEqual(body.segments, [])
    assert.ok(body.relatedKnowledgePoints.some(point => point.knowledgePointId === 'KP-2.1'))
    assert.ok(body.relatedKnowledgePoints.length <= 5)
  } finally {
    await pool.query("UPDATE segments SET status = 'published'")
  }
})

test('检索：低置信命中按未覆盖处理', async () => {
  const weak = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(mainGrant),
    payload: { query: '量子纠缠与超导' },
  })
  assert.equal(weak.statusCode, 200, weak.body)
  assert.deepEqual(weak.json(), { segments: [], relatedKnowledgePoints: [] })

  const exact = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(mainGrant),
    payload: { query: '均线的方向与排列' },
  })
  assert.equal(exact.statusCode, 200, exact.body)
  const body = exact.json() as { segments: { segmentId: string }[] }
  assert.deepEqual(body.segments.map(segment => segment.segmentId), ['seg-tc101-m2-kp2-1'])
})

test('片段详情：权威起止秒、非法与下架', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/kb/segments/${SEGMENT_ID}`,
    headers: authHeaders(mainGrant),
  })
  assert.equal(response.statusCode, 200)
  const segment = response.json() as {
    segmentId: string
    startSec: number
    endSec: number
    score: number
    courseId: string
    knowledgePointId: string
  }
  assert.equal(segment.segmentId, SEGMENT_ID)
  assert.equal(segment.startSec, 192)
  assert.equal(segment.endSec, 400)
  assert.equal(segment.score, 1)
  assert.equal(segment.courseId, 'TC-101')
  assert.equal(segment.knowledgePointId, 'KP-1.1')

  const bad = await app.inject({
    method: 'GET',
    url: '/v1/kb/segments/bad',
    headers: authHeaders(mainGrant),
  })
  assert.equal(bad.statusCode, 400)

  const missing = await app.inject({
    method: 'GET',
    url: '/v1/kb/segments/seg-does-not-exist',
    headers: authHeaders(mainGrant),
  })
  assert.equal(missing.statusCode, 404)

  await pool.query("UPDATE segments SET status = 'archived' WHERE segment_id = $1", [SEGMENT_ID])
  try {
    const archived = await app.inject({
      method: 'GET',
      url: `/v1/kb/segments/${SEGMENT_ID}`,
      headers: authHeaders(mainGrant),
    })
    assert.equal(archived.statusCode, 404)
  } finally {
    await pool.query("UPDATE segments SET status = 'published' WHERE segment_id = $1", [SEGMENT_ID])
  }
})

test('播放会话：签名地址、m3u8 改写、Range 与令牌边界', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/playback/sessions',
    headers: authHeaders(mainGrant),
    payload: { segmentId: SEGMENT_ID },
  })
  assert.equal(created.statusCode, 200, created.body)
  const session = created.json() as {
    sessionId: string
    playlistUrl: string
    expiresAt: number
    watermark: { label: string }
  }
  assert.match(session.sessionId, /^ps_[A-Za-z0-9_-]+$/)
  assert.equal(session.watermark.label, '测试学员')
  assert.ok(session.expiresAt > Date.now())

  const playlistUrl = new URL(session.playlistUrl)
  assert.equal(playlistUrl.origin + playlistUrl.pathname, `${MEDIA_BASE_URL}/hls/index.m3u8`)
  const token = playlistUrl.searchParams.get('token')
  assert.ok(token !== null && token.length > 0)
  const path = `${playlistUrl.pathname}${playlistUrl.search}`

  const playlist = await app.inject({ method: 'GET', url: path })
  assert.equal(playlist.statusCode, 200, playlist.body)
  assert.match(playlist.headers['content-type'] as string, /mpegurl/)
  assert.match(playlist.body, /URI="enc\.key\?token=/)
  assert.match(playlist.body, /seg0001\.ts\?token=/)

  const key = await app.inject({ method: 'GET', url: `/media/hls/enc.key?token=${encodeURIComponent(token)}` })
  assert.equal(key.statusCode, 200)

  const ranged = await app.inject({
    method: 'GET',
    url: `/media/hls/seg0001.ts?token=${encodeURIComponent(token)}`,
    headers: { range: 'bytes=0-9' },
  })
  assert.equal(ranged.statusCode, 206)
  assert.equal(ranged.headers['content-range'], 'bytes 0-9/1024')
  assert.equal(ranged.rawPayload.length, 10)

  const unsatisfiable = await app.inject({
    method: 'GET',
    url: `/media/hls/seg0001.ts?token=${encodeURIComponent(token)}`,
    headers: { range: 'bytes=5000-6000' },
  })
  assert.equal(unsatisfiable.statusCode, 416)
  assert.equal(unsatisfiable.headers['content-range'], 'bytes */1024')

  const noToken = await app.inject({ method: 'GET', url: '/media/hls/index.m3u8' })
  assert.equal(noToken.statusCode, 403)

  const badToken = await app.inject({ method: 'GET', url: '/media/hls/index.m3u8?token=nope' })
  assert.equal(badToken.statusCode, 403)

  const foreign = signPlaybackToken(MEDIA_SECRET, {
    v: 1,
    p: 'other-course/',
    e: Date.now() + 60_000,
    s: session.sessionId,
  })
  const scoped = await app.inject({ method: 'GET', url: `/media/hls/index.m3u8?token=${encodeURIComponent(foreign)}` })
  assert.equal(scoped.statusCode, 403)

  const rootless = signPlaybackToken(MEDIA_SECRET, {
    v: 1,
    p: '',
    e: Date.now() + 60_000,
    s: session.sessionId,
  })
  const traversal = await app.inject({
    method: 'GET',
    url: `/media/..%2Fhls%2Findex.m3u8?token=${encodeURIComponent(rootless)}`,
  })
  assert.equal(traversal.statusCode, 404)

  await pool.query("UPDATE playback_sessions SET expires_at = now() - interval '1 second' WHERE session_id = $1", [session.sessionId])
  const closed = await app.inject({ method: 'GET', url: path })
  assert.equal(closed.statusCode, 403)
})

test('播放会话：片段缺失与并发上限', async () => {
  const missing = await app.inject({
    method: 'POST',
    url: '/v1/playback/sessions',
    headers: authHeaders(mainGrant),
    payload: { segmentId: 'seg-does-not-exist' },
  })
  assert.equal(missing.statusCode, 404)

  const limited = await grantFor('playback-limit-0001')
  for (let index = 0; index < 5; index += 1) {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/playback/sessions',
      headers: authHeaders(limited),
      payload: { segmentId: SEGMENT_ID },
    })
    assert.equal(created.statusCode, 200, created.body)
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/v1/playback/sessions',
    headers: authHeaders(limited),
    payload: { segmentId: SEGMENT_ID },
  })
  assert.equal(blocked.statusCode, 429)
})

test('播放会话：缺失媒体资源返回 503', async () => {
  await pool.query("DELETE FROM media_assets WHERE asset_id = 'asset-tc101-hls'")
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/playback/sessions',
      headers: authHeaders(mainGrant),
      payload: { segmentId: SEGMENT_ID },
    })
    assert.equal(response.statusCode, 503)
  } finally {
    await seedDatabase(pool)
  }
})

test('刷新：设备绑定、轮换与重放吊销', async () => {
  const initial = await grantFor('refresh-device-0001')

  const wrongDevice = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: initial.refreshToken, deviceId: 'refresh-device-0002' },
  })
  assert.equal(wrongDevice.statusCode, 403)

  const rotated = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: initial.refreshToken, deviceId: initial.deviceId },
  })
  assert.equal(rotated.statusCode, 200, rotated.body)
  const next = rotated.json() as Grant
  assert.notEqual(next.refreshToken, initial.refreshToken)

  const usable = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(next),
    payload: { query: '均线' },
  })
  assert.equal(usable.statusCode, 200)

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: initial.refreshToken, deviceId: initial.deviceId },
  })
  assert.equal(replay.statusCode, 401)

  const revoked = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(next),
    payload: { query: '均线' },
  })
  assert.equal(revoked.statusCode, 401)
})

test('注销：吊销本设备令牌且不影响其它设备', async () => {
  const target = await grantFor('revoke-device-0001')
  const other = await grantFor('revoke-device-0002')

  const mismatch = await app.inject({
    method: 'POST',
    url: '/v1/auth/revoke',
    headers: { authorization: `Bearer ${other.accessToken}`, 'x-device-id': target.deviceId },
  })
  assert.equal(mismatch.statusCode, 403)

  const revoked = await app.inject({
    method: 'POST',
    url: '/v1/auth/revoke',
    headers: authHeaders(target),
  })
  assert.equal(revoked.statusCode, 200)
  assert.deepEqual(revoked.json(), { revoked: true })

  const afterRevoke = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(target),
    payload: { query: '均线' },
  })
  assert.equal(afterRevoke.statusCode, 401)

  const refreshAfterRevoke = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: target.refreshToken, deviceId: target.deviceId },
  })
  assert.equal(refreshAfterRevoke.statusCode, 401)

  const otherStillWorks = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(other),
    payload: { query: '均线' },
  })
  assert.equal(otherStillWorks.statusCode, 200)

  const again = await grantFor('revoke-device-0001')
  const restored = await app.inject({
    method: 'POST',
    url: '/v1/kb/search',
    headers: authHeaders(again),
    payload: { query: '均线' },
  })
  assert.equal(restored.statusCode, 200)
})

test('事件：同意读写、门禁、白名单与幂等', async () => {
  const grant = await grantFor('events-device-0001')
  const userId = await userIdFor(grant.deviceId)
  const event = {
    eventId: 'evt-contract-0001',
    name: 'search_requested',
    props: { durationMs: 120, topK: 5, hits: 3, empty: false },
  }

  const initial = await app.inject({
    method: 'GET',
    url: '/v1/events/consent',
    headers: authHeaders(grant),
  })
  assert.equal(initial.statusCode, 200)
  assert.deepEqual(initial.json(), { consent: false })

  const denied = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: authHeaders(grant),
    payload: event,
  })
  assert.equal(denied.statusCode, 403)

  const invalidConsent = await app.inject({
    method: 'PUT',
    url: '/v1/events/consent',
    headers: authHeaders(grant),
    payload: { consent: 'yes' },
  })
  assert.equal(invalidConsent.statusCode, 400)

  const granted = await app.inject({
    method: 'PUT',
    url: '/v1/events/consent',
    headers: authHeaders(grant),
    payload: { consent: true },
  })
  assert.equal(granted.statusCode, 200)
  assert.deepEqual(granted.json(), { consent: true })

  const { rows: consentRows } = await pool.query<{ events_consent: boolean }>(
    'SELECT events_consent FROM users WHERE user_id = $1',
    [userId],
  )
  assert.equal(consentRows[0]?.events_consent, true)

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: authHeaders(grant),
    payload: event,
  })
  assert.equal(accepted.statusCode, 202)
  assert.deepEqual(accepted.json(), { accepted: true })

  const duplicate = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: authHeaders(grant),
    payload: event,
  })
  assert.equal(duplicate.statusCode, 202)

  const { rows } = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM events WHERE event_id = $1',
    [event.eventId],
  )
  assert.equal(rows[0]?.count, 1)

  const feedback = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: authHeaders(grant),
    payload: { eventId: 'evt-contract-feedback-0001', name: 'feedback_submitted', props: { rating: 'up' } },
  })
  assert.equal(feedback.statusCode, 202)

  const cases: Record<string, unknown>[] = [
    { eventId: 'evt-contract-0002', name: 'answer_generated', props: {} },
    { ...event, eventId: 'evt-contract-0003', props: { ...event.props, query: '均线' } },
    { eventId: 'evt-contract-0004', name: 'citation_clicked', props: { segmentId: 'bad' } },
    { ...event, eventId: 'evt-contract-0005', occurredAt: Date.now() - 31 * 24 * 60 * 60 * 1000 },
    { eventId: 'evt-contract-0006', name: 'feedback_submitted', props: { rating: 'neutral' } },
    { eventId: 'evt-contract-0007', name: 'feedback_submitted', props: { rating: 'up', note: '泄漏' } },
  ]
  for (const payload of cases) {
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: authHeaders(grant),
      payload,
    })
    assert.equal(invalid.statusCode, 400, JSON.stringify(payload))
  }

  const revoked = await app.inject({
    method: 'PUT',
    url: '/v1/events/consent',
    headers: authHeaders(grant),
    payload: { consent: false },
  })
  assert.equal(revoked.statusCode, 200)
  assert.deepEqual(revoked.json(), { consent: false })

  const deniedAfterRevoke = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: authHeaders(grant),
    payload: { ...event, eventId: 'evt-contract-0006' },
  })
  assert.equal(deniedAfterRevoke.statusCode, 403)
})

test('体系：课程列表与课程树', async () => {
  const list = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses',
    headers: authHeaders(mainGrant),
  })
  assert.equal(list.statusCode, 200, list.body)
  const { courses } = list.json() as {
    courses: { courseId: string; title: string; chapterCount: number; knowledgePointCount: number; completedCount: number }[]
  }
  assert.equal(courses.length, 1)
  assert.deepEqual(courses[0], {
    courseId: 'TC-101',
    title: '趋势交易基础',
    chapterCount: 3,
    knowledgePointCount: 6,
    completedCount: 0,
  })

  const detail = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101',
    headers: authHeaders(mainGrant),
  })
  assert.equal(detail.statusCode, 200, detail.body)
  const course = detail.json() as {
    contractVersion: number
    courseId: string
    chapters: {
      chapterId: string
      hasArticle: boolean
      figureCount: number
      knowledgePoints: Record<string, unknown>[]
    }[]
  }
  assert.equal(course.contractVersion, 2)
  assert.equal(course.courseId, 'TC-101')
  assert.deepEqual(course.chapters.map(chapter => chapter.chapterId), ['M1', 'M2', 'M3'])
  for (const chapter of course.chapters) {
    assert.equal(chapter.hasArticle, true)
    assert.equal(chapter.figureCount, 0)
  }
  const points = course.chapters.flatMap(chapter => chapter.knowledgePoints)
  assert.equal(points.length, 6)
  for (const point of points) {
    assert.equal('startSec' in point, false)
    assert.equal('endSec' in point, false)
    assert.match(point.knowledgePointId as string, /^[A-Za-z0-9._-]+$/)
    assert.match(point.segmentId as string, /^seg-[A-Za-z0-9._-]+$/)
    assert.equal(point.watchedSec, 0)
    assert.equal(point.completed, false)
  }

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/bad%20id',
    headers: authHeaders(mainGrant),
  })
  assert.equal(invalid.statusCode, 400)

  const missing = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/NOPE',
    headers: authHeaders(mainGrant),
  })
  assert.equal(missing.statusCode, 404)
})

test('体系：知识点详情只返回定位与相邻知识点', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/v1/catalog/knowledge-points/KP-1.1',
    headers: authHeaders(mainGrant),
  })
  assert.equal(response.statusCode, 200, response.body)
  const detail = response.json() as {
    knowledgePointId: string
    courseId: string
    chapterId: string
    title: string
    segmentId?: string
    adjacentKnowledgePoints: { knowledgePointId: string; title: string }[]
  }
  assert.equal(detail.knowledgePointId, 'KP-1.1')
  assert.equal(detail.courseId, 'TC-101')
  assert.equal(detail.chapterId, 'M1')
  assert.equal(detail.segmentId, SEGMENT_ID)
  assert.equal('article' in detail, false)
  assert.ok(detail.adjacentKnowledgePoints.length <= 5)
  assert.ok(detail.adjacentKnowledgePoints.some(point => point.knowledgePointId === 'KP-1.2'))
  for (const point of detail.adjacentKnowledgePoints) {
    assert.deepEqual(Object.keys(point).sort(), ['knowledgePointId', 'title'])
  }

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/catalog/knowledge-points/bad%20id',
    headers: authHeaders(mainGrant),
  })
  assert.equal(invalid.statusCode, 400)

  const missing = await app.inject({
    method: 'GET',
    url: '/v1/catalog/knowledge-points/KP-9.9',
    headers: authHeaders(mainGrant),
  })
  assert.equal(missing.statusCode, 404)
})

test('体系：章节教材、图示签名与相邻章节', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101/chapters/M1',
    headers: authHeaders(mainGrant),
  })
  assert.equal(response.statusCode, 200, response.body)
  const chapter = response.json() as {
    chapterId: string
    courseId: string
    title: string
    article: { markdown: string; version: number; publishedAt: number } | null
    figures: Record<string, unknown>
    adjacentChapters: { chapterId: string; title: string }[]
    quiz: unknown
  }
  assert.deepEqual(Object.keys(chapter).sort(), [
    'adjacentChapters', 'article', 'chapterId', 'courseId', 'figures', 'quiz', 'title',
  ])
  assert.equal(chapter.quiz, null)
  assert.equal(chapter.chapterId, 'M1')
  assert.equal(chapter.courseId, 'TC-101')
  assert.equal(chapter.title, '第一章 趋势认知')
  assert.ok(chapter.article !== null)
  assert.match(chapter.article.markdown, /趋势/)
  assert.equal(chapter.article.version, 1)
  assert.ok(chapter.article.publishedAt > 0)
  assert.deepEqual(chapter.figures, {})
  assert.ok(chapter.adjacentChapters.length <= 5)
  assert.ok(chapter.adjacentChapters.some(entry => entry.chapterId === 'M2'))
  for (const entry of chapter.adjacentChapters) {
    assert.deepEqual(Object.keys(entry).sort(), ['chapterId', 'title'])
  }

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101/chapters/bad%20id',
    headers: authHeaders(mainGrant),
  })
  assert.equal(invalid.statusCode, 400)

  const missing = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101/chapters/M9',
    headers: authHeaders(mainGrant),
  })
  assert.equal(missing.statusCode, 404)

  const missingCourse = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/NOPE/chapters/M1',
    headers: authHeaders(mainGrant),
  })
  assert.equal(missingCourse.statusCode, 404)

  await pool.query(
    "UPDATE chapter_articles SET status = 'draft' WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
  )
  try {
    const draft = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(draft.statusCode, 200)
    assert.equal((draft.json() as { article: unknown }).article, null)
  } finally {
    await pool.query(
      "UPDATE chapter_articles SET status = 'published' WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
    )
  }
})

test('体系：章节图示只下发已选且已发布的签名地址', async () => {
  const figureId = 'fig_test0001'
  const candidateId = 'cand_test0001'
  await mkdir(join(figureDir, figureId), { recursive: true })
  await writeFile(join(figureDir, figureId, `${candidateId}.jpg`), Buffer.alloc(2048, 3))
  await pool.query(
    `INSERT INTO figures (figure_id, course_id, chapter_id, kind, caption, status)
     VALUES ($1, 'TC-101', 'M1', 'keyframe', '均线交叉示意', 'planned')`,
    [figureId],
  )
  await pool.query(
    `INSERT INTO figure_candidates
       (candidate_id, figure_id, rel_path, width, height, bytes, status)
     VALUES ($1, $2, $3, 1600, 900, 2048, 'ready')`,
    [candidateId, figureId, `${figureId}/${candidateId}.jpg`],
  )
  await pool.query(
    `UPDATE figures SET selected_candidate_id = $1, status = 'published', published_at = now()
     WHERE figure_id = $2`,
    [candidateId, figureId],
  )
  const original = await pool.query<{ markdown: string }>(
    "SELECT markdown FROM chapter_articles WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
  )
  const markdown = original.rows[0]?.markdown
  assert.ok(markdown !== undefined)
  await pool.query(
    "UPDATE chapter_articles SET markdown = $1 WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
    [`${markdown}\n\n![均线交叉示意](figure:${figureId})\n`],
  )
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(response.statusCode, 200, response.body)
    const chapter = response.json() as {
      figures: Record<string, { url: string; width: number; height: number; alt: string; caption?: string }>
    }
    const figure = chapter.figures[figureId]
    assert.ok(figure !== undefined)
    assert.equal(figure.width, 1600)
    assert.equal(figure.height, 900)
    assert.equal(figure.alt, '均线交叉示意')
    assert.equal(figure.caption, '均线交叉示意')
    const url = new URL(figure.url)
    assert.equal(url.origin, 'http://127.0.0.1:3939')
    assert.equal(url.pathname, `/media/figures/${figureId}/${candidateId}.jpg`)
    assert.ok(Number(url.searchParams.get('expires')) > Math.floor(Date.now() / 1000))
    assert.ok((url.searchParams.get('sig') ?? '') !== '')

    const image = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` })
    assert.equal(image.statusCode, 200)
    assert.equal(image.headers['content-type'], 'image/jpeg')
    assert.equal(image.headers['cache-control'], 'private, max-age=600')
    assert.equal(image.rawPayload.length, 2048)

    const tampered = new URL(figure.url)
    tampered.searchParams.set('sig', 'bad-signature')
    const denied = await app.inject({ method: 'GET', url: `${tampered.pathname}${tampered.search}` })
    assert.equal(denied.statusCode, 403)

    const switched = new URL(figure.url)
    switched.pathname = `/media/figures/fig_other/${candidateId}.jpg`
    const switchedResponse = await app.inject({
      method: 'GET',
      url: `${switched.pathname}${switched.search}`,
    })
    assert.equal(switchedResponse.statusCode, 403)

    await pool.query(
      "UPDATE chapter_articles SET markdown = $1 WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
      [`${markdown}\n\n![缺失](figure:fig_missing)\n`],
    )
    const broken = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(broken.statusCode, 500)
  } finally {
    await pool.query(
      "UPDATE chapter_articles SET markdown = $1 WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
      [markdown],
    )
    await pool.query('DELETE FROM figures WHERE figure_id = $1', [figureId])
    await rm(join(figureDir, figureId), { recursive: true, force: true })
  }
})

test('体系：随堂测验读写、发布门禁与损坏防护', async () => {
  const quizUrl = '/v1/admin/content/courses/TC-101/chapters/M1/quiz'
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const question = (serial: number): Record<string, unknown> => ({
    questionId: `q_m1_${serial}`,
    prompt: `均线问题 ${serial}`,
    options: ['金叉', '死叉', '背离'],
    answerIndex: 0,
    explanation: `解析 ${serial}`,
  })

  try {
    const empty = await app.inject({ method: 'GET', url: quizUrl, headers: adminHeaders })
    assert.equal(empty.statusCode, 200, empty.body)
    assert.deepEqual(empty.json(), { quiz: null })

    const tooFew = await app.inject({
      method: 'PUT',
      url: quizUrl,
      headers: adminHeaders,
      payload: { questions: [question(1), question(2)], status: 'published' },
    })
    assert.equal(tooFew.statusCode, 400)

    const draft = await app.inject({
      method: 'PUT',
      url: quizUrl,
      headers: adminHeaders,
      payload: { questions: [question(1), question(2)], status: 'draft' },
    })
    assert.equal(draft.statusCode, 200, draft.body)
    const draftQuiz = (draft.json() as { quiz: { version: number; status: string; publishedAt: number | null } }).quiz
    assert.equal(draftQuiz.version, 1)
    assert.equal(draftQuiz.status, 'draft')
    assert.equal(draftQuiz.publishedAt, null)

    const hidden = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(hidden.statusCode, 200)
    assert.equal((hidden.json() as { quiz: unknown }).quiz, null)

    const published = await app.inject({
      method: 'PUT',
      url: quizUrl,
      headers: adminHeaders,
      payload: { questions: [question(1), question(2), question(3)], status: 'published' },
    })
    assert.equal(published.statusCode, 200, published.body)
    const publishedQuiz = (published.json() as {
      quiz: { version: number; status: string; publishedAt: number | null; questions: unknown[] }
    }).quiz
    assert.equal(publishedQuiz.version, 2)
    assert.equal(publishedQuiz.status, 'published')
    assert.ok(typeof publishedQuiz.publishedAt === 'number')
    assert.equal(publishedQuiz.questions.length, 3)

    const visible = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(visible.statusCode, 200, visible.body)
    const visibleQuiz = (visible.json() as {
      quiz: { version: number; publishedAt: number; questions: Record<string, unknown>[] }
    }).quiz
    assert.equal(visibleQuiz.version, 2)
    assert.equal(visibleQuiz.publishedAt, publishedQuiz.publishedAt)
    assert.deepEqual(visibleQuiz.questions, [question(1), question(2), question(3)])

    for (const payload of [
      { questions: [question(1), question(1), question(2)], status: 'draft' },
      { questions: [{ ...question(1), answerIndex: 9 }], status: 'draft' },
      { questions: [{ ...question(1), options: ['', 'B'] }], status: 'draft' },
      { questions: [{ ...question(1), prompt: '' }], status: 'draft' },
      { questions: [1, 2, 3, 4, 5, 6].map(question), status: 'draft' },
    ]) {
      const invalid = await app.inject({
        method: 'PUT',
        url: quizUrl,
        headers: adminHeaders,
        payload,
      })
      assert.equal(invalid.statusCode, 400, JSON.stringify(payload))
    }

    await pool.query("UPDATE chapter_quizzes SET status = 'archived' WHERE course_id = 'TC-101' AND chapter_id = 'M1'")
    const archived = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal((archived.json() as { quiz: unknown }).quiz, null)

    await pool.query(
      `UPDATE chapter_quizzes SET status = 'published', published_at = now(),
         questions = '[{"bad":1},{"bad":2},{"bad":3}]'::jsonb
       WHERE course_id = 'TC-101' AND chapter_id = 'M1'`,
    )
    const broken = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101/chapters/M1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(broken.statusCode, 500)
  } finally {
    await pool.query(
      "DELETE FROM chapter_quizzes WHERE course_id = 'TC-101' AND chapter_id = 'M1'",
    )
  }
})

test('体系：未发布课程不可见', async () => {
  await pool.query("UPDATE courses SET status = 'draft' WHERE course_id = 'TC-101'")
  try {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses',
      headers: authHeaders(mainGrant),
    })
    assert.equal(list.statusCode, 200)
    assert.deepEqual(list.json(), { courses: [] })

    const course = await app.inject({
      method: 'GET',
      url: '/v1/catalog/courses/TC-101',
      headers: authHeaders(mainGrant),
    })
    assert.equal(course.statusCode, 404)

    const point = await app.inject({
      method: 'GET',
      url: '/v1/catalog/knowledge-points/KP-1.1',
      headers: authHeaders(mainGrant),
    })
    assert.equal(point.statusCode, 404)
  } finally {
    await pool.query("UPDATE courses SET status = 'published' WHERE course_id = 'TC-101'")
  }
})

test('进度：合并、不可回退、幂等与用户隔离', async () => {
  const consent = await app.inject({
    method: 'GET',
    url: '/v1/events/consent',
    headers: authHeaders(mainGrant),
  })
  assert.equal(consent.statusCode, 200)

  const first = await app.inject({
    method: 'PUT',
    url: '/v1/progress/knowledge-points/KP-1.1',
    headers: authHeaders(mainGrant),
    payload: { watchedSec: 120, completed: false },
  })
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual(
    (({ knowledgePointId, watchedSec, completed }) => ({ knowledgePointId, watchedSec, completed }))(first.json()),
    { knowledgePointId: 'KP-1.1', watchedSec: 120, completed: false },
  )

  const completed = await app.inject({
    method: 'PUT',
    url: '/v1/progress/knowledge-points/KP-1.1',
    headers: authHeaders(mainGrant),
    payload: { watchedSec: 60, completed: true },
  })
  assert.equal(completed.statusCode, 200)
  const completedBody = completed.json() as { watchedSec: number; completed: boolean }
  assert.equal(completedBody.watchedSec, 120)
  assert.equal(completedBody.completed, true)

  const regressed = await app.inject({
    method: 'PUT',
    url: '/v1/progress/knowledge-points/KP-1.1',
    headers: authHeaders(mainGrant),
    payload: { watchedSec: 30, completed: false },
  })
  assert.equal(regressed.statusCode, 200)
  const regressedBody = regressed.json() as { watchedSec: number; completed: boolean }
  assert.equal(regressedBody.watchedSec, 120)
  assert.equal(regressedBody.completed, true)

  const tree = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101',
    headers: authHeaders(mainGrant),
  })
  const point = (tree.json() as {
    chapters: { knowledgePoints: { knowledgePointId: string; watchedSec: number; completed: boolean }[] }[]
  }).chapters.flatMap(chapter => chapter.knowledgePoints)
    .find(entry => entry.knowledgePointId === 'KP-1.1')
  assert.deepEqual(point, {
    knowledgePointId: 'KP-1.1',
    title: '趋势的定义与三种方向',
    position: 1,
    segmentId: SEGMENT_ID,
    watchedSec: 120,
    completed: true,
  })

  const list = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses',
    headers: authHeaders(mainGrant),
  })
  assert.equal((list.json() as { courses: { completedCount: number }[] }).courses[0]?.completedCount, 1)

  const other = await grantFor('progress-other-0001')
  const otherWrite = await app.inject({
    method: 'PUT',
    url: '/v1/progress/knowledge-points/KP-1.1',
    headers: authHeaders(other),
    payload: { watchedSec: 20, completed: false },
  })
  assert.equal(otherWrite.statusCode, 200)
  const otherBody = otherWrite.json() as { watchedSec: number; completed: boolean }
  assert.equal(otherBody.watchedSec, 20)
  assert.equal(otherBody.completed, false)

  const unchanged = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/TC-101',
    headers: authHeaders(mainGrant),
  })
  const unchangedPoint = (unchanged.json() as {
    chapters: { knowledgePoints: { knowledgePointId: string; watchedSec: number; completed: boolean }[] }[]
  }).chapters.flatMap(chapter => chapter.knowledgePoints)
    .find(entry => entry.knowledgePointId === 'KP-1.1')
  assert.equal(unchangedPoint?.watchedSec, 120)
  assert.equal(unchangedPoint?.completed, true)

  const invalidBodies: unknown[] = [
    { watchedSec: 10 },
    { watchedSec: -1, completed: false },
    { watchedSec: 86401, completed: false },
    { watchedSec: 1.5, completed: false },
    { watchedSec: 10, completed: 'yes' },
    [],
  ]
  for (const payload of invalidBodies) {
    const invalid = await app.inject({
      method: 'PUT',
      url: '/v1/progress/knowledge-points/KP-1.1',
      headers: authHeaders(mainGrant),
      payload: payload as Record<string, unknown>,
    })
    assert.equal(invalid.statusCode, 400, JSON.stringify(payload))
  }

  const missing = await app.inject({
    method: 'PUT',
    url: '/v1/progress/knowledge-points/KP-9.9',
    headers: authHeaders(mainGrant),
    payload: { watchedSec: 10, completed: false },
  })
  assert.equal(missing.statusCode, 404)
})

test('进度限流：单设备超出配额返回 429', async () => {
  const limited = await buildApp({
    config: loadConfig(env({ RATE_LIMIT_PROGRESS_PER_MINUTE: '1' })),
    pool,
  })
  try {
    const first = await limited.inject({
      method: 'PUT',
      url: '/v1/progress/knowledge-points/KP-1.1',
      headers: authHeaders(mainGrant),
      payload: { watchedSec: 10, completed: false },
    })
    assert.equal(first.statusCode, 200)
    const second = await limited.inject({
      method: 'PUT',
      url: '/v1/progress/knowledge-points/KP-1.1',
      headers: authHeaders(mainGrant),
      payload: { watchedSec: 20, completed: false },
    })
    assert.equal(second.statusCode, 429)
  } finally {
    await limited.close()
  }
})

test('检索限流：单设备超出配额返回 429', async () => {
  const limited = await buildApp({
    config: loadConfig(env({ RATE_LIMIT_SEARCH_PER_MINUTE: '1' })),
    pool,
  })
  try {
    const first = await limited.inject({
      method: 'POST',
      url: '/v1/kb/search',
      headers: authHeaders(mainGrant),
      payload: { query: '均线' },
    })
    assert.equal(first.statusCode, 200)
    const second = await limited.inject({
      method: 'POST',
      url: '/v1/kb/search',
      headers: authHeaders(mainGrant),
      payload: { query: '均线' },
    })
    assert.equal(second.statusCode, 429)
  } finally {
    await limited.close()
  }
})

test('设备轮询与刷新限流：超出配额返回 429', async () => {
  const limited = await buildApp({
    config: loadConfig(env({
      RATE_LIMIT_DEVICE_TOKEN_PER_MINUTE: '1',
      RATE_LIMIT_REFRESH_PER_MINUTE: '1',
    })),
    pool,
  })
  try {
    const poll = () => limited.inject({
      method: 'POST',
      url: '/v1/auth/device/token',
      payload: { deviceCode: 'invalid-device-code' },
    })
    const firstPoll = await poll()
    assert.notEqual(firstPoll.statusCode, 429)
    const secondPoll = await poll()
    assert.equal(secondPoll.statusCode, 429)
    assert.equal(secondPoll.headers['retry-after'], '60')

    const refresh = () => limited.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'invalid-refresh-token', deviceId: 'refresh-limit-0001' },
    })
    const firstRefresh = await refresh()
    assert.notEqual(firstRefresh.statusCode, 429)
    const secondRefresh = await refresh()
    assert.equal(secondRefresh.statusCode, 429)
  } finally {
    await limited.close()
  }
})

test('体系与后台内容读取限流：超出配额返回 429', async () => {
  const limited = await buildApp({
    config: loadConfig(env({
      RATE_LIMIT_CATALOG_PER_MINUTE: '1',
      RATE_LIMIT_CONTENT_PER_MINUTE: '1',
    })),
    pool,
  })
  try {
    const catalog = () => limited.inject({
      method: 'GET',
      url: '/v1/catalog/courses',
      headers: authHeaders(mainGrant),
    })
    assert.equal((await catalog()).statusCode, 200)
    assert.equal((await catalog()).statusCode, 429)

    const content = () => limited.inject({
      method: 'GET',
      url: '/v1/admin/content/courses',
      headers: adminHeaders(),
    })
    assert.equal((await content()).statusCode, 200)
    assert.equal((await content()).statusCode, 429)
  } finally {
    await limited.close()
  }
})

test('语音转写：鉴权、音频校验、空结果与上游错误映射', async () => {
  const payload = (durationMs = 1000) => ({
    audio: wavBase64({ durationMs }),
    format: 'wav',
    durationMs,
  })

  const denied = await app.inject({
    method: 'POST',
    url: '/v1/asr/transcribe',
    payload: payload(),
  })
  assert.equal(denied.statusCode, 401)

  const mismatch = await app.inject({
    method: 'POST',
    url: '/v1/asr/transcribe',
    headers: { authorization: `Bearer ${mainGrant.accessToken}`, 'x-device-id': 'device-other-0001' },
    payload: payload(),
  })
  assert.equal(mismatch.statusCode, 403)

  const invalidBodies: unknown[] = [
    {},
    { audio: wavBase64(), format: 'webm', durationMs: 1000 },
    { audio: '', format: 'wav', durationMs: 1000 },
    { audio: 'not base64!!', format: 'wav', durationMs: 1000 },
    { audio: wavBase64({ sampleRate: 44_100 }), format: 'wav', durationMs: 1000 },
    { audio: wavBase64({ durationMs: 10_000 }), format: 'wav', durationMs: 13_000 },
    { audio: wavBase64(), format: 'wav', durationMs: 0 },
    { audio: wavBase64(), format: 'wav', durationMs: 1.5 },
  ]
  for (const body of invalidBodies) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/asr/transcribe',
      headers: authHeaders(mainGrant),
      payload: body as Record<string, unknown>,
    })
    assert.equal(response.statusCode, 400, JSON.stringify(body))
  }

  const oversized = await app.inject({
    method: 'POST',
    url: '/v1/asr/transcribe',
    headers: authHeaders(mainGrant),
    payload: { audio: 'A'.repeat(3 * 1024 * 1024), format: 'wav', durationMs: 1000 },
  })
  assert.equal(oversized.statusCode, 413)

  const empty = await app.inject({
    method: 'POST',
    url: '/v1/asr/transcribe',
    headers: authHeaders(mainGrant),
    payload: payload(1500),
  })
  assert.equal(empty.statusCode, 422)

  const upstreamFailures: [number, number][] = [[2000, 429], [2500, 503], [3000, 502]]
  for (const [durationMs, statusCode] of upstreamFailures) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/asr/transcribe',
      headers: authHeaders(mainGrant),
      payload: payload(durationMs),
    })
    assert.equal(response.statusCode, statusCode, String(durationMs))
  }

  const ok = await app.inject({
    method: 'POST',
    url: '/v1/asr/transcribe',
    headers: authHeaders(mainGrant),
    payload: payload(12_000),
  })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.deepEqual(ok.json(), { text: '趋势反转的初步信号有哪些？', durationMs: 12_000 })
})

test('语音转写限流：单设备超出配额返回 429', async () => {
  const limited = await buildApp({
    config: loadConfig(env({ RATE_LIMIT_ASR_PER_MINUTE: '1' })),
    pool,
    asr: fakeAsr,
  })
  try {
    const first = await limited.inject({
      method: 'POST',
      url: '/v1/asr/transcribe',
      headers: authHeaders(mainGrant),
      payload: { audio: wavBase64(), format: 'wav', durationMs: 1000 },
    })
    assert.equal(first.statusCode, 200)
    const second = await limited.inject({
      method: 'POST',
      url: '/v1/asr/transcribe',
      headers: authHeaders(mainGrant),
      payload: { audio: wavBase64(), format: 'wav', durationMs: 1000 },
    })
    assert.equal(second.statusCode, 429)
  } finally {
    await limited.close()
  }
})

test('模型配置：仅管理员可读，密钥加密落库且只回显掩码', async () => {
  const operator = await adminCreateUser({
    username: 'model-operator-01',
    displayName: '模型运营',
    role: 'operator',
    password: 'operator-password-123',
  })
  assert.equal(operator.statusCode, 201, JSON.stringify(operator.body))
  const operatorLogin = await loginSession('model-operator-01', 'operator-password-123')
  assert.equal(operatorLogin.statusCode, 200, JSON.stringify(operatorLogin.body))
  const operatorHeaders = { authorization: `Bearer ${operatorLogin.body.token}` }

  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/model-configs/llm' })
  assert.equal(anonymous.statusCode, 401)
  const deviceToken = await app.inject({
    method: 'GET',
    url: '/v1/admin/model-configs/llm',
    headers: authHeaders(mainGrant),
  })
  assert.equal(deviceToken.statusCode, 401)
  const denied = await app.inject({
    method: 'GET',
    url: '/v1/admin/model-configs/llm',
    headers: operatorHeaders,
  })
  assert.equal(denied.statusCode, 403)

  const empty = await app.inject({ method: 'GET', url: '/v1/admin/model-configs/llm', headers: adminHeaders() })
  assert.equal(empty.statusCode, 200)
  assert.deepEqual(empty.json(), [])

  const apiKey = 'sk-contract-key-123456'
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'primary',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1/chat/completions',
      model: 'gpt-test',
      purpose: 'content',
      apiKey,
      isDefault: true,
    },
  })
  assert.equal(created.statusCode, 201, created.body)
  const first = created.json() as {
    configId: string
    baseUrl: string
    apiKeyConfigured: boolean
    apiKeyMasked: string | null
    isDefault: boolean
    protocol: string
  }
  assert.match(first.configId, /^llmc_[0-9a-f]{16}$/)
  assert.equal(first.baseUrl, 'https://api.example.com')
  assert.equal(first.protocol, 'openai')
  assert.equal(first.apiKeyConfigured, true)
  assert.equal(first.apiKeyMasked, 'sk-c********3456')
  assert.equal(created.body.includes(apiKey), false)

  const { rows } = await pool.query<{ api_key_encrypted: string }>(
    'SELECT api_key_encrypted FROM llm_configs WHERE config_id = $1',
    [first.configId],
  )
  const stored = rows[0]?.api_key_encrypted ?? ''
  assert.match(stored, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
  assert.equal(stored.includes(apiKey), false)

  const second = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'backup',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-backup',
      purpose: 'content',
      apiKey: 'sk-second-key-654321',
      isDefault: true,
    },
  })
  assert.equal(second.statusCode, 201, second.body)
  const secondId = (second.json() as { configId: string }).configId

  const list = await app.inject({ method: 'GET', url: '/v1/admin/model-configs/llm', headers: adminHeaders() })
  const configs = (list.json() as { configId: string; isDefault: boolean; apiKeyMasked: string }[])
  assert.equal(configs.length, 2)
  const defaults = configs.filter(config => config.isDefault)
  assert.deepEqual(defaults.map(config => config.configId), [secondId])
  assert.equal(list.body.includes('sk-second-key-654321'), false)

  const anthropic = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'anthropic-content',
      provider: 'anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      model: 'claude-test',
      purpose: 'content',
      apiKey: 'sk-ant-contract-123456',
    },
  })
  assert.equal(anthropic.statusCode, 201, anthropic.body)
  const anthropicBody = anthropic.json() as { configId: string; protocol: string; baseUrl: string }
  assert.equal(anthropicBody.protocol, 'anthropic')
  assert.equal(anthropicBody.baseUrl, 'https://api.anthropic.com')

  const switchedProtocol = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/model-configs/llm/${anthropicBody.configId}`,
    headers: adminHeaders(),
    payload: { protocol: 'openai' },
  })
  assert.equal(switchedProtocol.statusCode, 200, switchedProtocol.body)
  assert.equal((switchedProtocol.json() as { protocol: string }).protocol, 'openai')

  const badProtocol = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'bad-protocol',
      provider: 'openai',
      protocol: 'gemini',
      baseUrl: 'https://api.example.com',
      model: 'm',
      purpose: 'content',
    },
  })
  assert.equal(badProtocol.statusCode, 400)

  const anthropicEmbedding = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'bad-embedding',
      provider: 'anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'm',
      purpose: 'embedding',
    },
  })
  assert.equal(anthropicEmbedding.statusCode, 400)

  const patched = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/model-configs/llm/${first.configId}`,
    headers: adminHeaders(),
    payload: { apiKey: '', name: 'primary-renamed' },
  })
  assert.equal(patched.statusCode, 200, patched.body)
  const patchedBody = patched.json() as { name: string; apiKeyConfigured: boolean; apiKeyMasked: string }
  assert.equal(patchedBody.name, 'primary-renamed')
  assert.equal(patchedBody.apiKeyConfigured, true)
  assert.equal(patchedBody.apiKeyMasked, 'sk-c********3456')

  const embedding = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'embed',
      provider: 'openai',
      baseUrl: 'https://api.example.com',
      model: 'embed-test',
      purpose: 'embedding',
      isDefault: true,
    },
  })
  assert.equal(embedding.statusCode, 201, embedding.body)
  const embeddingBody = embedding.json() as { apiKeyConfigured: boolean; apiKeyMasked: string | null; isDefault: boolean }
  assert.equal(embeddingBody.apiKeyConfigured, false)
  assert.equal(embeddingBody.apiKeyMasked, null)
  assert.equal(embeddingBody.isDefault, true)

  const switched = await app.inject({
    method: 'POST',
    url: `/v1/admin/model-configs/llm/${first.configId}/set-default`,
    headers: adminHeaders(),
  })
  assert.equal(switched.statusCode, 200, switched.body)
  assert.equal((switched.json() as { isDefault: boolean }).isDefault, true)

  const badId = await app.inject({ method: 'GET', url: '/v1/admin/model-configs/llm/nope', headers: adminHeaders() })
  assert.equal(badId.statusCode, 400)
  const missing = await app.inject({
    method: 'GET',
    url: '/v1/admin/model-configs/llm/llmc_0123456789abcdef',
    headers: adminHeaders(),
  })
  assert.equal(missing.statusCode, 404)
  const missingTest = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm/llmc_0123456789abcdef/test',
    headers: adminHeaders(),
  })
  assert.equal(missingTest.statusCode, 404)

  const image = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'ark-image',
      provider: 'ark',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-5-0-260128',
      purpose: 'image',
      apiKey: 'ark-contract-key-123456',
      isDefault: true,
      imagePriceMicros: 150000,
    },
  })
  assert.equal(image.statusCode, 201, image.body)
  const imageBody = image.json() as { configId: string; purpose: string; imagePriceMicros: number; isDefault: boolean }
  assert.equal(imageBody.purpose, 'image')
  assert.equal(imageBody.imagePriceMicros, 150000)
  assert.equal(imageBody.isDefault, true)
  assert.equal(image.body.includes('ark-contract-key-123456'), false)

  const defaultImagePrice = await app.inject({
    method: 'POST',
    url: '/v1/admin/model-configs/llm',
    headers: adminHeaders(),
    payload: {
      name: 'ark-image-default-price',
      provider: 'ark',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-5-0-260128',
      purpose: 'image',
    },
  })
  assert.equal(defaultImagePrice.statusCode, 201, defaultImagePrice.body)
  assert.equal((defaultImagePrice.json() as { imagePriceMicros: number }).imagePriceMicros, 120000)

  for (const payload of [
    {
      name: 'x',
      provider: 'anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.example.com',
      model: 'm',
      purpose: 'image',
    },
    { name: 'x', provider: 'openai', baseUrl: 'not-a-url', model: 'm', purpose: 'content' },
    { name: '', provider: 'openai', baseUrl: 'https://api.example.com', model: 'm', purpose: 'content' },
    { name: 'x', provider: 'bad provider', baseUrl: 'https://api.example.com', model: 'm', purpose: 'content' },
  ]) {
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/admin/model-configs/llm',
      headers: adminHeaders(),
      payload,
    })
    assert.equal(invalid.statusCode, 400, JSON.stringify(payload))
  }

  for (const configId of [
    (defaultImagePrice.json() as { configId: string }).configId,
    imageBody.configId,
    secondId,
  ]) {
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/model-configs/llm/${configId}`,
      headers: adminHeaders(),
    })
    assert.equal(removed.statusCode, 204)
  }

  const afterDelete = await app.inject({
    method: 'GET',
    url: `/v1/admin/model-configs/llm/${secondId}`,
    headers: adminHeaders(),
  })
  assert.equal(afterDelete.statusCode, 404)
})

test('模型配置：ASR 单行配置、默认值与密钥掩码', async () => {
  const initial = await app.inject({ method: 'GET', url: '/v1/admin/model-configs/asr', headers: adminHeaders() })
  assert.equal(initial.statusCode, 200, initial.body)
  const defaults = initial.json() as {
    provider: string
    protocol: string
    baseUrl: string
    model: string
    apiKeyConfigured: boolean
    apiKeyMasked: string | null
    enabled: boolean
  }
  assert.equal(defaults.provider, 'minimax')
  assert.equal(defaults.protocol, 'minimax')
  assert.equal(defaults.baseUrl, 'https://api.minimaxi.com')
  assert.equal(defaults.apiKeyConfigured, false)
  assert.equal(defaults.apiKeyMasked, null)
  assert.equal(defaults.enabled, false)

  const updated = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/model-configs/asr',
    headers: adminHeaders(),
    payload: {
      protocol: 'openai',
      baseUrl: 'https://asr.example.com/v1/audio/transcriptions',
      model: 'whisper-test',
      apiKey: 'asr-contract-key-123456',
      enabled: true,
    },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  const body = updated.json() as {
    protocol: string
    baseUrl: string
    model: string
    apiKeyConfigured: boolean
    apiKeyMasked: string
    enabled: boolean
  }
  assert.equal(body.protocol, 'openai')
  assert.equal(body.baseUrl, 'https://asr.example.com')
  assert.equal(body.model, 'whisper-test')
  assert.equal(body.apiKeyConfigured, true)
  assert.equal(body.apiKeyMasked, 'asr-********3456')
  assert.equal(body.enabled, true)
  assert.equal(updated.body.includes('asr-contract-key-123456'), false)

  const kept = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/model-configs/asr',
    headers: adminHeaders(),
    payload: { apiKey: '', model: 'whisper-kept' },
  })
  assert.equal(kept.statusCode, 200, kept.body)
  const keptBody = kept.json() as { model: string; apiKeyConfigured: boolean; apiKeyMasked: string }
  assert.equal(keptBody.model, 'whisper-kept')
  assert.equal(keptBody.apiKeyConfigured, true)
  assert.equal(keptBody.apiKeyMasked, 'asr-********3456')

  const invalid = await app.inject({
    method: 'PATCH',
    url: '/v1/admin/model-configs/asr',
    headers: adminHeaders(),
    payload: { protocol: 'whisper' },
  })
  assert.equal(invalid.statusCode, 400)
})

test('M9 语料级生产：frames 越权与未知素材', async () => {
  await ensureStudent('m9-frames-student', 'M9 帧302')
  const portalLogin = await app.inject({
    method: 'POST',
    url: '/v1/portal/auth/login',
    payload: { username: usernameFor('m9-frames-student'), password: STUDENT_PASSWORD },
  })
  assert.equal(portalLogin.statusCode, 200, portalLogin.body)
  const portalToken = (portalLogin.json() as { token: string }).token
  const student = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/media-assets/asset_0000000000000000/frames?from=0&to=600000',
    headers: { authorization: `Bearer ${portalToken}` },
  })
  assert.equal(student.statusCode, 403)

  const missing = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/media-assets/asset_0000000000000000/frames?from=0&to=600000',
    headers: adminHeaders(),
  })
  assert.equal(missing.statusCode, 404)

  const badRange = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/media-assets/asset_0000000000000000/frames?from=7200000&to=600000',
    headers: adminHeaders(),
  })
  assert.equal(badRange.statusCode, 400)
})

test('M9 语料级生产：概念归一与依赖边', async () => {
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', title: 'M9 语料生产验收课' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, JSON.stringify(course.body))
  const chapter = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses/T-M9-PROD/chapters',
    headers: adminHeaders(),
    payload: { chapterId: 'CH9', title: '总论章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, JSON.stringify(chapter.body))

  const duplicateName = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', name: '阻尼运动', aliases: ['阻尼'] },
  })
  assert.equal(duplicateName.statusCode, 200, duplicateName.body)
  const conflict = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', name: '阻尼运动', aliases: ['阻尼'] },
  })
  assert.equal(conflict.statusCode, 409)

  const second = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/concepts',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', name: '起飞平台' },
  })
  assert.equal(second.statusCode, 200, second.body)
  const fromId = duplicateName.json().conceptId as string
  const toId = second.json().conceptId as string

  const selfLoop = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/concept-edges',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', fromConceptId: fromId, toConceptId: fromId, kind: 'prerequisite' },
  })
  assert.equal(selfLoop.statusCode, 400)

  const unknownRef = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/concept-edges',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', fromConceptId: fromId, toConceptId: 'cpt_0000000000000000', kind: 'related' },
  })
  assert.equal(unknownRef.statusCode, 404)

  const edge = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/concept-edges',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', fromConceptId: fromId, toConceptId: toId, kind: 'prerequisite' },
  })
  assert.equal(edge.statusCode, 200, edge.body)
  const edgeRepeat = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/concept-edges',
    headers: adminHeaders(),
    payload: { courseId: 'T-M9-PROD', fromConceptId: fromId, toConceptId: toId, kind: 'prerequisite' },
  })
  assert.equal(edgeRepeat.json().edgeId, edge.json().edgeId)

  const listed = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/concepts?courseId=T-M9-PROD',
    headers: adminHeaders(),
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const concepts = (listed.json() as { concepts: { conceptId: string; name: string }[] }).concepts
  assert.ok(concepts.some(entry => entry.conceptId === fromId))
  assert.ok(concepts.some(entry => entry.conceptId === toId))
  const unknownCourse = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/concepts?courseId=T-M9-NONE',
    headers: adminHeaders(),
  })
  assert.equal(unknownCourse.statusCode, 200)
  assert.deepEqual((unknownCourse.json() as { concepts: unknown[] }).concepts, [])
})

test('M9 语料级生产：source units 幂等与检索', async () => {
  const assetId = await insertAsset('T-M9-PROD', '总论第 1 集')

  const first = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{
        assetId,
        startMs: 0,
        endMs: 420_000,
        transcriptText: '起飞平台是趋势延续的中继形态',
        visual: { description: 'K 线图上标注了平台区间', chartType: 'kline', keyframes: [{ sec: 12 }] },
        summary: '起飞平台定义与要点',
        conceptRefs: [],
        producedBy: { taskKey: 'content.chunk_summary', model: 'test-model', provider: 'test' },
      }],
    },
  })
  assert.equal(first.statusCode, 200, first.body)
  const savedFirst = first.json().saved[0] as { unitId: string; deduped: boolean }
  assert.equal(savedFirst.deduped, false)

  const repeat = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{
        assetId,
        startMs: 0,
        endMs: 420000,
        transcriptText: '起飞平台是趋势延续的中继形态',
        summary: '起飞平台定义与要点',
      }],
    },
  })
  assert.equal(repeat.statusCode, 200)
  const savedRepeat = repeat.json().saved[0] as { unitId: string; deduped: boolean }
  assert.equal(savedRepeat.deduped, true)
  assert.equal(savedRepeat.unitId, savedFirst.unitId)

  const search = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/source-units?assetId=${assetId}&q=${encodeURIComponent('起飞平台')}`,
    headers: adminHeaders(),
  })
  assert.equal(search.statusCode, 200)
  const searchBody = search.json() as { units: { unitId: string }[]; nextCursor: string | null }
  assert.ok(searchBody.units.some(unit => unit.unitId === savedFirst.unitId))

  const empty = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/source-units?assetId=${assetId}&q=${encodeURIComponent('不存在的词')}`,
    headers: adminHeaders(),
  })
  assert.deepEqual(empty.json().units, [])

  const badLimit = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/source-units?assetId=${assetId}&limit=51`,
    headers: adminHeaders(),
  })
  assert.equal(badLimit.statusCode, 400)

  const reindexLimitLow = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/reindex',
    headers: adminHeaders(),
    payload: { limit: 0 },
  })
  assert.equal(reindexLimitLow.statusCode, 400)
  const reindexLimitHigh = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/reindex',
    headers: adminHeaders(),
    payload: { limit: 501 },
  })
  assert.equal(reindexLimitHigh.statusCode, 400)

  // 停用唯一默认 embedding 配置 → 409；恢复后回填可跑（上游测试端点不可达，失败单位保持 NULL）
  const { rows: embedRows } = await pool.query<{ config_id: string }>(
    "SELECT config_id FROM llm_configs WHERE purpose = 'embedding' AND is_default AND is_active LIMIT 1",
  )
  assert.ok(embedRows[0] !== undefined, '前置：默认启用的 embedding 配置应存在')
  await pool.query('UPDATE llm_configs SET is_active = false WHERE config_id = $1', [embedRows[0].config_id])
  const reindexUnconfigured = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/reindex',
    headers: adminHeaders(),
  })
  assert.equal(reindexUnconfigured.statusCode, 409)
  await pool.query('UPDATE llm_configs SET is_active = true WHERE config_id = $1', [embedRows[0].config_id])
  const reindex = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/reindex',
    headers: adminHeaders(),
    payload: { limit: 50 },
  })
  assert.equal(reindex.statusCode, 200, reindex.body)
  const reindexBody = reindex.json() as { embedded: number; failed: number; remaining: number }
  assert.equal(reindexBody.embedded, 0)
  assert.equal(reindexBody.failed, reindexBody.remaining)
})

test('M9 语料级生产：节教材 citations 与版本', async () => {
  const assetId = await insertAsset('T-M9-PROD', '总论第 2 集')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300000, transcriptText: '趋势线触及三次以上有效', summary: '趋势线有效性' }],
    },
  })
  const unitId = unit.json().saved[0].unitId as string

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: {
      courseId: 'T-M9-PROD',
      chapterId: 'CH9',
      title: '第一节 趋势线',
      position: 1,
      sourceAssetIds: [assetId],
    },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string

  const badCitation = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '正文引用了不存在的 source unit', citations: ['su_0000000000000000'] },
  })
  assert.equal(badCitation.statusCode, 400)

  const saved = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '趋势线有效性的正文，引用理解产物。', citations: [unitId] },
  })
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().version, 1)
  const resaved = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '趋势线有效性的正文第二版。', citations: [unitId] },
  })
  assert.equal(resaved.json().version, 2)

  // DSL v1：未知 directive 400
  const dslUnknown = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: ':::h5page\n任意\n:::', citations: [unitId] },
  })
  assert.equal(dslUnknown.statusCode, 400)

  // DSL v1：未声明属性 400
  const dslExtraAttr = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: `:::board unitId=${unitId} extra=1\n原话\n:::`, citations: [unitId] },
  })
  assert.equal(dslExtraAttr.statusCode, 400)

  // DSL v1：board 引用未知 unit → 400 unit_ref_unknown
  const dslBadUnit = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: ':::board unitId=su_0000000000000000\n原话\n:::', citations: [unitId] },
  })
  assert.equal(dslBadUnit.statusCode, 400)
  assert.equal((dslBadUnit.json() as { error: { code: string } }).error.code, 'unit_ref_unknown')

  // DSL v1：figure 引用本节不存在的 figure → 400 figure_ref_unknown
  const dslBadFigure = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: ':::figure figureId=fig_missing0 caption="配图"\n:::', citations: [unitId] },
  })
  assert.equal(dslBadFigure.statusCode, 400)
  assert.equal((dslBadFigure.json() as { error: { code: string } }).error.code, 'figure_ref_unknown')

  // DSL v1：clip 窗未完整落 unit（unit 为 0–300s）→ 400 clip_not_grounded
  const dslBadClip = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: `:::clip assetId=${assetId} from=400 to=430 caption="片段" unitId=${unitId}\n:::`,
      citations: [unitId],
    },
  })
  assert.equal(dslBadClip.statusCode, 400)
  assert.equal((dslBadClip.json() as { error: { code: string } }).error.code, 'clip_not_grounded')

  // DSL v1：合法容器块组合（board + clip 落窗 + 个股锚）保存成功 version+1
  // 个股锚须在本节案例股清单内（R2）
  const stockSetup = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/case-stocks`,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: '筹码峰', unitId }],
      }],
    },
  })
  assert.equal(stockSetup.statusCode, 200, stockSetup.body)

  const dslArticle = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: [
        `开场白，个股锚 [[stock:sz000713|丰乐种业]]。`,
        '',
        `:::board unitId=${unitId}`,
        '老师原话：趋势线触及三次以上才有效。',
        ':::',
        '',
        `:::clip assetId=${assetId} from=10 to=20 caption="趋势线现场" unitId=${unitId}`,
        ':::',
        '',
        ':::bignum',
        '{"items":[{"label":"最少触点","value":"3 次","note":"趋势线有效性下限"}]}',
        ':::',
      ].join('\n'),
      citations: [unitId],
    },
  })
  assert.equal(dslArticle.statusCode, 200, dslArticle.body)
  assert.equal(dslArticle.json().version, 3)

  const widgetsEmpty = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
  })
  assert.deepEqual(widgetsEmpty.json().widgets, [])

  // 白名单外 type 400
  const badType = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'free-code-canvas',
      specVersion: 1,
      spec: {},
      assertions: {},
      citations: [unitId],
    },
  })
  assert.equal(badType.statusCode, 400)

  // 缺必带断言 400
  const missingAssertion = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'kline-annotator',
      specVersion: 1,
      spec: {
        data: { generator: 'uptrend-platform', seed: 42, bars: 60 },
        task: '画出上升趋势线',
        solution: { trendline: { startIdx: 1, endIdx: 58 } },
      },
      assertions: { trendlineTouches: { min: 6 } },
      citations: [unitId],
    },
  })
  assert.equal(missingAssertion.statusCode, 400)

  // 全部断言证明通过 200
  const proof = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'kline-annotator',
      specVersion: 1,
      spec: {
        data: { generator: 'uptrend-platform', seed: 42, bars: 60 },
        task: '画出上升趋势线',
        solution: { trendline: { startIdx: 1, endIdx: 58 } },
      },
      assertions: { trendlineTouches: { min: 6 }, slopeRange: [10, 45], noBreakBelow: true },
      citations: [unitId],
    },
  })
  assert.equal(proof.statusCode, 200, proof.body)
  const proofBody = proof.json() as { widgetId: string; validation: Record<string, string> }
  assert.deepEqual(proofBody.validation, { trendlineTouches: 'pass', slopeRange: 'pass', noBreakBelow: 'pass' })

  // 断言证明失败 409 assertion_unproven 附 failed
  const unproven = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'kline-annotator',
      specVersion: 1,
      spec: {
        data: { generator: 'range', seed: 99, bars: 60 },
        task: '箱体上画陡峭上升趋势线',
        solution: { trendline: { startIdx: 1, endIdx: 58 } },
      },
      assertions: { trendlineTouches: { min: 2 }, slopeRange: [10, 45], noBreakBelow: true },
      citations: [unitId],
    },
  })
  assert.equal(unproven.statusCode, 409)
  assert.equal(unproven.json().error?.code, 'assertion_unproven')
  assert.ok(Array.isArray(unproven.json().error?.failed))

  // mcq 术语必须在 concepts 内：未知术语 409，已归一术语 200
  const unknownTerm = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'mcq-quiz',
      specVersion: 1,
      spec: {
        question: '以下哪个概念描述趋势中继？',
        options: [{ id: 'a', label: '起飞平台' }, { id: 'b', label: '不存在的术语' }],
        answerId: 'a',
        conceptRefs: ['不存在的术语'],
      },
      assertions: { answerUnique: true, termsInConcepts: true },
      citations: [unitId],
    },
  })
  assert.equal(unknownTerm.statusCode, 409)

  const knownTerm = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'mcq-quiz',
      specVersion: 1,
      spec: {
        question: '以下哪个概念描述趋势中继？',
        options: [{ id: 'a', label: '起飞平台' }, { id: 'b', label: '阻尼运动' }],
        answerId: 'a',
        conceptRefs: ['起飞平台', '阻尼运动'],
      },
      assertions: { answerUnique: true, termsInConcepts: true },
      citations: [unitId],
    },
  })
  assert.equal(knownTerm.statusCode, 200, knownTerm.body)

  // calc-trainer 示例值程序复算
  const calc = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'calc-trainer',
      specVersion: 1,
      spec: {
        formula: 'risk-reward',
        inputs: { entry: 100, stop: 95, target: 115 },
        examples: [
          { inputs: { entry: 100, stop: 95, target: 115 }, answer: 3 },
          { inputs: { entry: 200, stop: 190, target: 230 }, answer: 3 },
        ],
      },
      assertions: { examplesRecomputable: true, paramsInBounds: true },
      citations: [unitId],
    },
  })
  assert.equal(calc.statusCode, 200, calc.body)

  const wrongAnswer = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'calc-trainer',
      specVersion: 1,
      spec: {
        formula: 'risk-reward',
        inputs: { entry: 100, stop: 95, target: 115 },
        examples: [{ inputs: { entry: 100, stop: 95, target: 115 }, answer: 5 }],
      },
      assertions: { examplesRecomputable: true, paramsInBounds: true },
      citations: [unitId],
    },
  })
  assert.equal(wrongAnswer.statusCode, 409)

  const widgetList = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
  })
  const list = widgetList.json().widgets as { widgetId: string; type: string; specBytes: number }[]
  assert.ok(list.length >= 3)
  assert.ok(list.every(item => item.specBytes > 0))

  // 纠错删除：删后列表缩短；重复删 404；属其他节 404
  const victim = list[0] as { widgetId: string }
  const deleted = await app.inject({
    method: 'DELETE',
    url: `/v1/admin/content/sections/${sectionId}/widgets/${victim.widgetId}`,
    headers: adminHeaders(),
  })
  assert.equal(deleted.statusCode, 204)
  const afterDelete = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
  })
  const listAfter = afterDelete.json().widgets as { widgetId: string }[]
  assert.equal(listAfter.some(item => item.widgetId === victim.widgetId), false)
  assert.equal(listAfter.length, list.length - 1)
  const deleteRepeat = await app.inject({
    method: 'DELETE',
    url: `/v1/admin/content/sections/${sectionId}/widgets/${victim.widgetId}`,
    headers: adminHeaders(),
  })
  assert.equal(deleteRepeat.statusCode, 404)
  const wrongSection = await app.inject({
    method: 'DELETE',
    url: `/v1/admin/content/sections/sec_0000000000000000/widgets/${(list[1] as { widgetId: string }).widgetId}`,
    headers: adminHeaders(),
  })
  assert.equal(wrongSection.statusCode, 404)
})

/** SOF 段声明 1280×720 的最小 JPEG，供帧轨道夹具通过服务端尺寸复检。 */
function fakeJpegBytes(width: number, height: number): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt16BE(height, 0)
  size.writeUInt16BE(width, 2)
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14, 1),
    0xff, 0xc0, 0x00, 0x11, 0x08, ...size, ...Buffer.alloc(5, 0),
    0xff, 0xd9,
  ])
}

test('M10 呈现层：节级 figures 写入（diagram 确定性 + keyframe 抽帧 + 配额）', async () => {
  const assetId = await insertAsset('T-M9-PROD', 'M10 图示素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300000, transcriptText: '筹码峰对比讲解', summary: '筹码峰' }],
    },
  })
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: {
      courseId: 'T-M9-PROD',
      chapterId: 'CH9',
      title: 'M10 图示节',
      position: 9,
      sourceAssetIds: [assetId],
    },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string

  const figureUrl = `/v1/admin/content/sections/${sectionId}/figures`

  // diagram：同参数两次写入，SVG 逐字节一致（模板确定性）
  const timelineParams = {
    events: [
      { date: '2019-05-17', title: '峰位确认', desc: '放量触及峰位' },
      { date: '2019-06-03', title: '缩量回踩' },
      { date: '2019-07-11', title: '趋势延续' },
    ],
  }
  const first = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'diagram', template: 'timeline', params: timelineParams, caption: '阶段推进' },
  })
  assert.equal(first.statusCode, 201, first.body)
  const firstBody = first.json() as { figureId: string; selectedCandidateId: string; spec: { template: string } }
  assert.equal(firstBody.spec.template, 'timeline')
  assert.ok(firstBody.selectedCandidateId.startsWith('cand_'))

  const second = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'diagram', template: 'timeline', params: timelineParams, caption: '阶段推进（重放）' },
  })
  assert.equal(second.statusCode, 201, second.body)
  const secondBody = second.json() as { figureId: string; selectedCandidateId: string }
  const svgA = await readFile(join(figureDir, firstBody.figureId, `${firstBody.selectedCandidateId}.svg`), 'utf8')
  const svgB = await readFile(join(figureDir, secondBody.figureId, `${secondBody.selectedCandidateId}.svg`), 'utf8')
  assert.equal(svgA, svgB)
  assert.ok(svgA.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))

  // 白名单外模板 400
  const badTemplate = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'diagram', template: 'mermaid', params: {}, caption: '非法模板' },
  })
  assert.equal(badTemplate.statusCode, 400)

  // 模板参数不合法 400
  const badParams = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'diagram', template: 'timeline', params: { events: [{ date: '2019-5-1', title: 'x' }] }, caption: '非法参数' },
  })
  assert.equal(badParams.statusCode, 400)

  // 配额：diagram 每节 ≤2 → 第 3 个 409 figure_quota_exceeded
  const quota = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: {
      kind: 'diagram',
      template: 'stat-inline',
      params: { label: '峰位', value: '8.68', spark: { kind: 'line', points: [7, 8, 8.68] } },
      caption: '第三个',
    },
  })
  assert.equal(quota.statusCode, 409)
  assert.equal(quota.json().error?.code, 'figure_quota_exceeded')

  // keyframe：sec 不落 unit 窗口（unit 0–300s）→ 400 sec_not_grounded
  const badSec = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'keyframe', assetId, sec: 400, caption: '出窗帧', unitId },
  })
  assert.equal(badSec.statusCode, 400)
  assert.equal(badSec.json().error?.code, 'sec_not_grounded')

  // keyframe：帧轨道手写夹具命中 → 201 并自动选定
  const keyframeDir = join(storageDir, 'work', assetId, 'keyframes')
  await mkdir(keyframeDir, { recursive: true })
  await writeFile(join(keyframeDir, '70.jpg'), fakeJpegBytes(1920, 1080))
  await writeFile(join(keyframeDir, 'manifest.json'), JSON.stringify({ frames: [{ sec: 70, width: 1920, height: 1080 }] }))
  const keyframe = await app.inject({
    method: 'POST',
    url: figureUrl,
    headers: adminHeaders(),
    payload: { kind: 'keyframe', assetId, sec: 70, caption: '筹码峰画面', unitId },
  })
  assert.equal(keyframe.statusCode, 201, keyframe.body)
  const keyframeBody = keyframe.json() as { figureId: string; sourceSec: number; kind: string }
  assert.equal(keyframeBody.kind, 'keyframe')
  assert.equal(keyframeBody.sourceSec, 70)
  const frameCopy = await readFile(join(figureDir, keyframeBody.figureId, `${(keyframe.json() as { selectedCandidateId: string }).selectedCandidateId}.jpg`))
  assert.equal(frameCopy.equals(fakeJpegBytes(1920, 1080)), true)

  // 清单：2 diagram + 1 keyframe
  const figures = await app.inject({ method: 'GET', url: figureUrl, headers: adminHeaders() })
  const entries = figures.json().figures as { figureId: string; kind: string; status: string }[]
  assert.equal(entries.length, 3)
  assert.ok(entries.every(entry => entry.status === 'ready' && entry.figureId.startsWith('fig_')))

  // 正文 :::figure 引用新建图示 → putArticle 通过 figure_ref 校验
  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: `:::figure figureId=${firstBody.figureId} caption="配图"\n:::`,
      citations: [unitId],
    },
  })
  assert.equal(article.statusCode, 200, article.body)
})

test('M10 呈现层：asset+时间窗播放会话（admin 预览通道）', async () => {
  const assetId = await insertAsset('T-M9-PROD', 'M10 片段素材')
  const sessionUrl = `/v1/admin/content/media-assets/${assetId}/playback-sessions`

  // asset 未就绪（uploaded）→ 503；不存在 → 404
  const notReady = await app.inject({ method: 'POST', url: sessionUrl, headers: adminHeaders(), payload: {} })
  assert.equal(notReady.statusCode, 503, notReady.body)
  const missing = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/media-assets/asset_0000000000000000/playback-sessions',
    headers: adminHeaders(),
    payload: {},
  })
  assert.equal(missing.statusCode, 404)

  await pool.query("UPDATE media_assets SET status = 'ready' WHERE asset_id = $1", [assetId])
  await mkdir(join(mediaDir, 'hls', assetId), { recursive: true })
  await writeFile(join(mediaDir, 'hls', assetId, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n')

  // 窗口校验：from/to 必须成对、0 ≤ from < to、窗长 ≤3600s
  const halfWindow = await app.inject({ method: 'POST', url: sessionUrl, headers: adminHeaders(), payload: { fromSec: 10 } })
  assert.equal(halfWindow.statusCode, 400)
  const inverted = await app.inject({ method: 'POST', url: sessionUrl, headers: adminHeaders(), payload: { fromSec: 100, toSec: 50 } })
  assert.equal(inverted.statusCode, 400)
  const tooWide = await app.inject({ method: 'POST', url: sessionUrl, headers: adminHeaders(), payload: { fromSec: 0, toSec: 3601 } })
  assert.equal(tooWide.statusCode, 400)

  // 全片会话：fromSec/toSec 为 null，签名地址可取到 m3u8
  const full = await app.inject({ method: 'POST', url: sessionUrl, headers: adminHeaders(), payload: {} })
  assert.equal(full.statusCode, 201, full.body)
  const fullBody = full.json() as { sessionId: string; playlistUrl: string; fromSec: number | null; toSec: number | null; expiresAt: number }
  assert.ok(fullBody.sessionId.startsWith('ps_'))
  assert.equal(fullBody.fromSec, null)
  assert.equal(fullBody.toSec, null)
  assert.ok(fullBody.expiresAt > Date.now())
  const playlistUrl = new URL(fullBody.playlistUrl)
  assert.equal(playlistUrl.origin + playlistUrl.pathname, `${MEDIA_BASE_URL}/hls/${assetId}/index.m3u8`)
  const playlist = await app.inject({ method: 'GET', url: `${playlistUrl.pathname}${playlistUrl.search}` })
  assert.equal(playlist.statusCode, 200, playlist.body)
  assert.match(playlist.headers['content-type'] as string, /mpegurl/)

  // 错前缀 token（其它 asset 命名空间）→ 403
  const token = playlistUrl.searchParams.get('token')
  assert.ok(token !== null)
  const foreign = signPlaybackToken(MEDIA_SECRET, {
    v: 1,
    p: `hls/asset_ffffffffffffffff/`,
    e: Date.now() + 60_000,
    s: fullBody.sessionId,
  })
  const scoped = await app.inject({
    method: 'GET',
    url: `/media/hls/${assetId}/index.m3u8?token=${encodeURIComponent(foreign)}`,
  })
  assert.equal(scoped.statusCode, 403)

  // 时间窗会话：窗口随会话落库
  const windowed = await app.inject({
    method: 'POST',
    url: sessionUrl,
    headers: adminHeaders(),
    payload: { fromSec: 10, toSec: 40 },
  })
  assert.equal(windowed.statusCode, 201, windowed.body)
  const windowedBody = windowed.json() as typeof fullBody
  assert.equal(windowedBody.fromSec, 10)
  assert.equal(windowedBody.toSec, 40)
  const { rows } = await pool.query<{ asset_id: string; window_from_sec: number; window_to_sec: number; device_id: string | null }>(
    'SELECT asset_id, window_from_sec, window_to_sec, device_id FROM playback_sessions WHERE session_id = $1',
    [windowedBody.sessionId],
  )
  assert.equal(rows[0]?.asset_id, assetId)
  assert.equal(rows[0]?.window_from_sec, 10)
  assert.equal(rows[0]?.window_to_sec, 40)
  assert.equal(rows[0]?.device_id, null)
})

test('M10 呈现层：发布门禁复检节正文 figure/clip 引用', async () => {
  const courseId = 'T-M10-GATE'
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId, title: 'M10 门禁课' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: adminHeaders(),
    payload: { chapterId: 'CHG', title: '门禁章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, chapter.body)

  const assetId = await insertAsset(courseId, '门禁素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: { units: [{ assetId, startMs: 0, endMs: 300000, transcriptText: '门禁验证语料', summary: '门禁' }] },
  })
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: { courseId, chapterId: 'CHG', title: '门禁节', position: 1, sourceAssetIds: [assetId] },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string

  const figure = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/figures`,
    headers: adminHeaders(),
    payload: {
      kind: 'diagram',
      template: 'timeline',
      params: {
        events: [
          { date: '2019-05-17', title: '峰位确认' },
          { date: '2019-06-03', title: '缩量回踩' },
          { date: '2019-07-11', title: '趋势延续' },
        ],
      },
      caption: '门禁图',
    },
  })
  assert.equal(figure.statusCode, 201, figure.body)
  const figureId = (figure.json() as { figureId: string }).figureId

  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: `引用配图与片段。\n\n:::figure figureId=${figureId} caption="配图"\n:::\n\n:::clip assetId=${assetId} from=10 to=40 caption="片段" unitId=${unitId}\n:::`,
      citations: [unitId],
    },
  })
  assert.equal(article.statusCode, 200, article.body)

  const publishUrl = `/v1/admin/content/courses/${courseId}/publish`
  const approvalsUrl = `/v1/admin/content/courses/${courseId}/approvals`

  // figure 被取消选定（引用失效）→ 409 figure_unresolved
  await pool.query('UPDATE figures SET selected_candidate_id = NULL WHERE figure_id = $1', [figureId])
  const unresolved = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(unresolved.statusCode, 409, unresolved.body)
  const unresolvedBody = unresolved.json() as { error: { code: string; figureIds: string[] } }
  assert.equal(unresolvedBody.error.code, 'figure_unresolved')
  assert.deepEqual(unresolvedBody.error.figureIds, [figureId])

  // figure 恢复，clip 窗不再落 source unit → 409 clip_invalid
  await pool.query('UPDATE figures SET selected_candidate_id = c.candidate_id FROM figure_candidates c WHERE figures.figure_id = $1 AND c.figure_id = $1', [figureId])
  const approved = await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: adminHeaders(),
    payload: { gate: 'final' },
  })
  assert.equal(approved.statusCode, 200, approved.body)
  await pool.query('UPDATE source_units SET start_ms = 50000 WHERE unit_id = $1', [unitId])
  const clipInvalid = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(clipInvalid.statusCode, 409, clipInvalid.body)
  const clipBody = clipInvalid.json() as { error: { code: string; clips: Array<{ sectionId: string; assetId: string }> } }
  assert.equal(clipBody.error.code, 'clip_invalid')
  assert.equal(clipBody.error.clips.length, 1)
  assert.equal(clipBody.error.clips[0]?.assetId, assetId)

  // 全部恢复 → publish 通过
  await pool.query('UPDATE source_units SET start_ms = 0 WHERE unit_id = $1', [unitId])
  const published = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(published.statusCode, 200, published.body)
  assert.equal((published.json() as { published: boolean }).published, true)
})

test('M9 语料级生产：节渲染预览聚合（教材 + 课件全量 + 图示）', async () => {
  const assetId = await insertAsset('T-M9-PROD', '总论第 3 集')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300000, transcriptText: '趋势线触及三次以上有效', summary: '趋势线有效性' }],
    },
  })
  const unitId = unit.json().saved[0].unitId as string

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: {
      courseId: 'T-M9-PROD',
      chapterId: 'CH9',
      title: '第二节 趋势线画法',
      position: 2,
      sourceAssetIds: [assetId],
    },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string

  const saved = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '趋势线画法的正文，引用理解产物。', citations: [unitId] },
  })
  assert.equal(saved.statusCode, 200, saved.body)

  // 空节预览：article 有值、widgets/figures 为空数组
  const empty = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/preview`,
    headers: adminHeaders(),
  })
  assert.equal(empty.statusCode, 200, empty.body)
  const emptyBody = empty.json() as {
    section: { sectionId: string; title: string; status: string; conceptRefs: string[] }
    article: { markdown: string; citations: string[]; version: number; status: string; dslVersion: number } | null
    widgets: unknown[]
    figures: unknown[]
  }
  assert.equal(emptyBody.section.sectionId, sectionId)
  assert.equal(emptyBody.section.title, '第二节 趋势线画法')
  assert.ok(Array.isArray(emptyBody.section.conceptRefs))
  assert.ok(emptyBody.article !== null)
  assert.equal(emptyBody.article.markdown, '趋势线画法的正文，引用理解产物。')
  assert.deepEqual(emptyBody.article.citations, [unitId])
  assert.equal(emptyBody.article.dslVersion, 1)
  assert.deepEqual(emptyBody.widgets, [])
  assert.deepEqual(emptyBody.figures, [])

  // 写入一个可证明课件后，预览应回带 spec / assertions 全量 + 时间
  const proof = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/sections/${sectionId}/widgets`,
    headers: adminHeaders(),
    payload: {
      type: 'kline-annotator',
      specVersion: 1,
      spec: {
        data: { generator: 'uptrend-platform', seed: 42, bars: 60 },
        task: '画出上升趋势线',
        solution: { trendline: { startIdx: 1, endIdx: 58 } },
      },
      assertions: { trendlineTouches: { min: 6 }, slopeRange: [10, 45], noBreakBelow: true },
      citations: [unitId],
    },
  })
  assert.equal(proof.statusCode, 200, proof.body)

  const withWidget = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/preview`,
    headers: adminHeaders(),
  })
  const withBody = withWidget.json() as {
    widgets: { widgetId: string; type: string; specVersion: number; spec: unknown; assertions: unknown; validation: Record<string, string>; status: string; version: number; createdAt: string }[]
  }
  assert.equal(withBody.widgets.length, 1)
  const w = withBody.widgets[0]
  assert.ok(w !== undefined)
  assert.equal(w.type, 'kline-annotator')
  assert.equal(w.specVersion, 1)
  assert.ok(typeof (w.spec as { solution?: unknown }).solution === 'object')
  assert.ok(typeof w.createdAt === 'string' && w.createdAt.length > 0)

  // 不存在的节 → 404
  const missing = await app.inject({
    method: 'GET',
    url: '/v1/admin/content/sections/sec_0000000000000000/preview',
    headers: adminHeaders(),
  })
  assert.equal(missing.statusCode, 404)

  // 未登录 → 401
  const anon = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/preview`,
  })
  assert.equal(anon.statusCode, 401)
})

test('M9 语料级生产：溯源上报入账本', async () => {
  const reported = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/provenance',
    headers: adminHeaders(),
    payload: {
      taskKey: 'content.section_draft',
      model: 'test-model',
      provider: 'test',
      inputTokens: 1200,
      outputTokens: 3000,
      cachedTokens: 0,
      latencyMs: 45000,
      status: 'success',
      skillVersions: { 'chapter-authoring': '1.2.0' },
      targetId: 'sec_0000000000000000',
    },
  })
  assert.equal(reported.statusCode, 202, reported.body)
  const accepted = reported.json() as { runId: string; usageId: string }
  assert.ok(accepted.runId.length > 0)
  assert.ok(accepted.usageId.length > 0)

  const ledger = await pool.query<{ source: string }>(
    'SELECT source FROM ai_runs WHERE run_id = $1',
    [accepted.runId],
  )
  assert.equal(ledger.rows[0]?.source, 'producer')

  const badTaskKey = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/provenance',
    headers: adminHeaders(),
    payload: { taskKey: 'content.outline', model: 'm', status: 'success' },
  })
  assert.equal(badTaskKey.statusCode, 400)

  const missingModel = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/provenance',
    headers: adminHeaders(),
    payload: { taskKey: 'content.section_draft', status: 'success' },
  })
  assert.equal(missingModel.statusCode, 400)
})

test('M9 语料级生产：教材评审溯源带评分摘要入账本', async () => {
  const reported = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/provenance',
    headers: adminHeaders(),
    payload: {
      taskKey: 'content.rubric_review',
      model: 'test-model',
      provider: 'test',
      inputTokens: 8000,
      outputTokens: 1200,
      latencyMs: 90000,
      status: 'success',
      skillVersions: { 'quality-rubric': '0.2.0' },
      targetId: 'sec_0000000000000000',
      summary: {
        scores: { coverage: 8, grounded: 9, diagram: null },
        verdict: 'reject',
        failed: ['alignment'],
        comments: '第 3 段课件依据缺失',
      },
    },
  })
  assert.equal(reported.statusCode, 202, reported.body)
  const accepted = reported.json() as { runId: string }

  const ledger = await pool.query<{ task_key: string; source: string; summary: { verdict?: string } | null }>(
    'SELECT task_key, source, summary FROM ai_runs WHERE run_id = $1',
    [accepted.runId],
  )
  assert.equal(ledger.rows[0]?.task_key, 'content.rubric_review')
  assert.equal(ledger.rows[0]?.source, 'producer')
  assert.equal(ledger.rows[0]?.summary?.verdict, 'reject')

  const badSummary = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/provenance',
    headers: adminHeaders(),
    payload: { taskKey: 'content.rubric_review', model: 'm', status: 'success', summary: '不是对象' },
  })
  assert.equal(badSummary.statusCode, 400)
})

test('M10 R2：节级案例股清单 upsert + DSL 个股锚成员校验', async () => {
  const courseId = 'T-M10-R2'
  const chapterId = 'CH10'
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId, title: 'M10 R2 案例股测试课程' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: adminHeaders(),
    payload: { chapterId, title: '案例股章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, chapter.body)

  const assetId = await insertAsset(courseId, 'M10 案例股素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{
        assetId,
        startMs: 0,
        endMs: 300_000,
        transcriptText: '丰乐种业筹码峰讲解',
        summary: '丰乐种业案例',
      }],
    },
  })
  assert.equal(unit.statusCode, 200, unit.body)
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: {
      courseId,
      chapterId,
      title: 'M10 案例股节',
      position: 10,
      sourceAssetIds: [assetId],
    },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string
  const caseStocksUrl = `/v1/admin/content/sections/${sectionId}/case-stocks`

  // 首次写入
  const first = await app.inject({
    method: 'PUT',
    url: caseStocksUrl,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: '课程筹码峰 8.68', unitId }],
        note: '密集形态代表案例',
      }],
    },
  })
  assert.equal(first.statusCode, 200, first.body)
  const firstBody = first.json() as { saved: { stockRefId: string; code: string; deduped: boolean }[] }
  const saved0 = firstBody.saved[0]
  assert.ok(saved0)
  assert.equal(saved0.code, '000713')
  assert.equal(saved0.deduped, false)
  assert.ok(saved0.stockRefId.startsWith('cst_'))

  // 同节同代号覆盖 → deduped=true
  const second = await app.inject({
    method: 'PUT',
    url: caseStocksUrl,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业（更新）',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: '课程筹码峰 8.68', unitId }],
      }],
    },
  })
  assert.equal(second.statusCode, 200, second.body)
  const secondBody = second.json() as { saved: { deduped: boolean }[] }
  assert.ok(secondBody.saved[0])
  assert.equal(secondBody.saved[0].deduped, true)

  // 清单查询
  const list = await app.inject({ method: 'GET', url: caseStocksUrl, headers: adminHeaders() })
  assert.equal(list.statusCode, 200, list.body)
  const listBody = list.json() as { stocks: { code: string; name: string }[] }
  assert.ok(listBody.stocks[0])
  assert.equal(listBody.stocks.length, 1)
  assert.equal(listBody.stocks[0].name, '丰乐种业（更新）')

  // 事件日期出窗 → 400 event_date_out_of_window
  const badDate = await app.inject({
    method: 'PUT',
    url: caseStocksUrl,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2021-01-01', label: '出窗事件', unitId }],
      }],
    },
  })
  assert.equal(badDate.statusCode, 400)
  assert.equal(badDate.json().error?.code, 'event_date_out_of_window')

  // 未知 unitId → 400 unit_ref_unknown
  const badUnit = await app.inject({
    method: 'PUT',
    url: caseStocksUrl,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: 'x', unitId: 'su_0000000000000000' }],
      }],
    },
  })
  assert.equal(badUnit.statusCode, 400)
  assert.equal(badUnit.json().error?.code, 'unit_ref_unknown')

  // 批次超限 → 400
  const tooMany = await app.inject({
    method: 'PUT',
    url: caseStocksUrl,
    headers: adminHeaders(),
    payload: {
      stocks: Array.from({ length: 11 }, (_, i) => ({
        name: `股票${i}`,
        exchange: 'SZSE',
        code: String(600000 + i).padStart(6, '0'),
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [],
      })),
    },
  })
  assert.equal(tooMany.statusCode, 400)

  // DSL 个股锚：清单内 code 通过
  const articleOk = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: '丰乐种业 [[stock:sz000713|丰乐种业]] 是代表案例。',
      citations: [unitId],
    },
  })
  assert.equal(articleOk.statusCode, 200, articleOk.body)

  // DSL 个股锚：不在清单 → 400 stock_not_in_list
  const articleBad = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: {
      markdown: '浦发银行 [[stock:sh600000|浦发银行]] 不在本节清单。',
      citations: [unitId],
    },
  })
  assert.equal(articleBad.statusCode, 400)
  assert.equal(articleBad.json().error?.code, 'stock_not_in_list')
})


test('M3b 分权：producer 可写内容生产、不可发布与管理账号', async () => {
  const PRODUCER = 'm3b-producer'
  const PRODUCER_PASSWORD = 'producer-pass-123'
  const created = await adminCreateUser({
    username: PRODUCER,
    displayName: 'M3b 生产端',
    role: 'producer',
    password: PRODUCER_PASSWORD,
  })
  assert.ok(created.statusCode === 201 || created.statusCode === 409, JSON.stringify(created.body))

  const login = await loginSession(PRODUCER, PRODUCER_PASSWORD)
  assert.equal(login.statusCode, 200, JSON.stringify(login.body))
  assert.equal(login.body.user.role, 'producer')
  const producerHeaders = { authorization: `Bearer ${login.body.token}` }

  const courseId = 'T-M3B-GOV'
  const chapterId = 'CH3B'
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId, title: 'M3b 分权测试课程' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: adminHeaders(),
    payload: { chapterId, title: '分权章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, chapter.body)

  // producer 可写内容生产命名空间：source units → 节 → 教材
  const assetId = await insertAsset(courseId, 'M3b 分权素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: producerHeaders,
    payload: {
      units: [{ assetId, startMs: 0, endMs: 120_000, transcriptText: '分权验证转写', summary: '分权单元' }],
    },
  })
  assert.equal(unit.statusCode, 200, unit.body)
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: producerHeaders,
    payload: {
      courseId,
      chapterId,
      title: '第一节 分权',
      position: 1,
      sourceAssetIds: [assetId],
    },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = (section.json().section as { sectionId: string }).sectionId

  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: producerHeaders,
    payload: { markdown: 'producer 写入的教材正文。', citations: [unitId] },
  })
  assert.equal(article.statusCode, 200, article.body)

  // producer 不可发布（pipeline 命名空间仍 operator/admin）
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/publish`,
    headers: producerHeaders,
  })
  assert.equal(publish.statusCode, 403)

  // producer 不可管理账号 / 不可读模型配置
  const createUser = await app.inject({
    method: 'POST',
    url: '/v1/admin/users',
    headers: producerHeaders,
    payload: { username: 'm3b-intruder', displayName: '越权', role: 'operator' },
  })
  assert.equal(createUser.statusCode, 403)

  const modelConfigs = await app.inject({
    method: 'GET',
    url: '/v1/admin/model-configs/llm',
    headers: producerHeaders,
  })
  assert.equal(modelConfigs.statusCode, 403)

  // operator 仍可写内容生产（基线不回归）
  const operatorLogin = await loginSession('operator-role-01', 'operator-password-123')
  assert.equal(operatorLogin.statusCode, 200, JSON.stringify(operatorLogin.body))
  const operatorArticle = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: { authorization: `Bearer ${operatorLogin.body.token}` },
    payload: { markdown: 'operator 写入的教材正文第二版。', citations: [unitId] },
  })
  assert.equal(operatorArticle.statusCode, 200, operatorArticle.body)
})

test('M3b：source unit 证据读取（全有或全无）与段落级锚引用并集', async () => {
  const courseId = 'T-M9-PROD'
  const assetId = await insertAsset(courseId, '证据读取素材')
  await pool.query("UPDATE media_assets SET status = 'ready' WHERE asset_id = $1", [assetId])
  const created = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{
        assetId,
        startMs: 60_000,
        endMs: 180_000,
        transcriptText: '起飞平台是趋势延续的中继形态，量能要放到 20 日均量两倍以上。',
        visual: { description: '日 K 缩量平台后放量长阳', chartType: 'kline' },
        summary: '起飞平台定义与量能判据',
      }],
    },
  })
  assert.equal(created.statusCode, 200, created.body)
  const unitId = created.json().saved[0].unitId as string

  const read = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/read',
    headers: adminHeaders(),
    payload: { unitIds: [unitId] },
  })
  assert.equal(read.statusCode, 200, read.body)
  const evidence = read.json() as {
    units: {
      unitId: string
      assetId: string
      startMs: number
      endMs: number
      transcriptText: string
      visual: Record<string, unknown>
      keyframes: { sec: number; url: string }[]
      playback: { playlistUrl: string; fromSec: number; toSec: number; expiresAt: number }
    }[]
  }
  assert.equal(evidence.units.length, 1)
  const unit = evidence.units[0]
  assert.equal(unit?.unitId, unitId)
  assert.equal(unit?.assetId, assetId)
  assert.equal(unit?.startMs, 60_000)
  assert.equal(unit?.endMs, 180_000)
  assert.ok(unit?.transcriptText.includes('起飞平台'))
  assert.equal(unit?.visual.description, '日 K 缩量平台后放量长阳')
  assert.ok(Array.isArray(unit?.keyframes))
  assert.ok(unit?.playback.playlistUrl.includes('token='))
  assert.equal(unit?.playback.fromSec, 60)
  assert.equal(unit?.playback.toSec, 180)

  // 全有或全无：混入不存在的 unitId → 409 unit_not_readable
  const mixed = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/read',
    headers: adminHeaders(),
    payload: { unitIds: [unitId, 'su_ffffffffffffffff'] },
  })
  assert.equal(mixed.statusCode, 409, mixed.body)
  assert.equal((mixed.json() as { error: { code: string } }).error.code, 'unit_not_readable')

  // 非法 unitId 形状 → 400
  const malformed = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units/read',
    headers: adminHeaders(),
    payload: { unitIds: ['not-a-unit'] },
  })
  assert.equal(malformed.statusCode, 400)

  // 段落级锚：合法锚并入引用集；课程外锚 → 400 unit_anchor_unknown
  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: { courseId, chapterId: 'CH9', title: '证据锚节', position: 9, sourceAssetIds: [assetId] },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = section.json().section.sectionId as string

  const withAnchor = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: `证据出处是 [[unit:${unitId}|起飞平台定义]]。`, citations: [unitId] },
  })
  assert.equal(withAnchor.statusCode, 200, withAnchor.body)
  const preview = await app.inject({
    method: 'GET',
    url: `/v1/admin/content/sections/${sectionId}/preview`,
    headers: adminHeaders(),
  })
  assert.equal(preview.statusCode, 200, preview.body)
  const citations = (preview.json() as { article: { citations: string[] } }).article.citations
  assert.deepEqual(citations, [unitId])

  const unknownAnchor = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '证据出处是 [[unit:su_ffffffffffffffff|他课证据]]。', citations: [unitId] },
  })
  assert.equal(unknownAnchor.statusCode, 400, unknownAnchor.body)
  assert.equal((unknownAnchor.json() as { error: { code: string } }).error.code, 'unit_anchor_unknown')
})

test('M3b：审批版本绑定（未审批拒绝发布 / 内容变更失效 / 签批后发布并翻转案例股）', async () => {
  const courseId = 'T-M3B-APPROVAL'
  const chapterId = 'CHAPR'
  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId, title: 'M3b 审批测试课程' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: adminHeaders(),
    payload: { chapterId, title: '审批章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, chapter.body)

  const assetId = await insertAsset(courseId, '审批素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300_000, transcriptText: '审批用例转写', summary: '审批单元' }],
    },
  })
  assert.equal(unit.statusCode, 200, unit.body)
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: { courseId, chapterId, title: '审批节', position: 1, sourceAssetIds: [assetId] },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = (section.json().section as { sectionId: string }).sectionId

  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '审批前的教材正文。', citations: [unitId] },
  })
  assert.equal(article.statusCode, 200, article.body)

  const stocks = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/case-stocks`,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: '课程筹码峰 8.68', unitId }],
      }],
    },
  })
  assert.equal(stocks.statusCode, 200, stocks.body)

  const publishUrl = `/v1/admin/content/courses/${courseId}/publish`
  const approvalsUrl = `/v1/admin/content/courses/${courseId}/approvals`

  // 1. 未签批 → 409 approval_required
  const unapproved = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(unapproved.statusCode, 409, unapproved.body)
  assert.equal((unapproved.json() as { error: { code: string } }).error.code, 'approval_required')

  // 2. producer 无签批权限 → 403
  const PRODUCER = 'm3b-approver'
  const PRODUCER_PASSWORD = 'approver-pass-123'
  const created = await adminCreateUser({
    username: PRODUCER,
    displayName: 'M3b 签批越权',
    role: 'producer',
    password: PRODUCER_PASSWORD,
  })
  assert.ok(created.statusCode === 201 || created.statusCode === 409, JSON.stringify(created.body))
  const producerLogin = await loginSession(PRODUCER, PRODUCER_PASSWORD)
  assert.equal(producerLogin.statusCode, 200, JSON.stringify(producerLogin.body))
  const producerHeaders = { authorization: `Bearer ${producerLogin.body.token}` }
  const producerApprove = await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: producerHeaders,
    payload: { gate: 'final' },
  })
  assert.equal(producerApprove.statusCode, 403, producerApprove.body)

  // 3. 非法门禁 → 400
  const badGate = await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: adminHeaders(),
    payload: { gate: 'whatever' },
  })
  assert.equal(badGate.statusCode, 400, badGate.body)

  // 4. 签批：digest 为 64 位十六进制，digestSections 覆盖本节
  const approved = await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: adminHeaders(),
    payload: { gate: 'final' },
  })
  assert.equal(approved.statusCode, 200, approved.body)
  const approval = (approved.json() as { approval: { approvalId: string; digest: string; digestSections: Record<string, string>; approvedBy: string } }).approval
  assert.match(approval.approvalId, /^apr_[0-9a-f]{16}$/)
  assert.match(approval.digest, /^[0-9a-f]{64}$/)
  assert.equal(typeof approval.digestSections[sectionId], 'string')
  assert.ok(approval.approvedBy.length > 0)

  // 5. 幂等重批：内容未变 → digest 相同
  const reapproved = await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: adminHeaders(),
    payload: { gate: 'final' },
  })
  assert.equal(reapproved.statusCode, 200, reapproved.body)
  assert.equal((reapproved.json() as { approval: { digest: string } }).approval.digest, approval.digest)

  // 6. 审批记录可查
  const listed = await app.inject({ method: 'GET', url: approvalsUrl, headers: adminHeaders() })
  assert.equal(listed.statusCode, 200, listed.body)
  const approvals = (listed.json() as { approvals: { gate: string; digest: string }[] }).approvals
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0]?.gate, 'final')
  assert.equal(approvals[0]?.digest, approval.digest)

  // 7. 签批后改动教材 → 409 approval_stale
  const changed = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '签批之后被改写的教材正文。', citations: [unitId] },
  })
  assert.equal(changed.statusCode, 200, changed.body)
  const stale = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(stale.statusCode, 409, stale.body)
  const staleError = (stale.json() as { error: { code: string; expected: string; actual: string } }).error
  assert.equal(staleError.code, 'approval_stale')
  assert.equal(staleError.expected.length, 16)
  assert.equal(staleError.actual.length, 16)
  assert.notEqual(staleError.expected, staleError.actual)

  // 8. 重新签批后发布成功，案例股随发布翻转
  await app.inject({
    method: 'POST',
    url: approvalsUrl,
    headers: adminHeaders(),
    payload: { gate: 'final' },
  })
  const published = await app.inject({ method: 'POST', url: publishUrl, headers: adminHeaders() })
  assert.equal(published.statusCode, 200, published.body)
  const counts = (published.json() as { counts: { caseStocks: number } }).counts
  assert.equal(counts.caseStocks, 1)
  const stockRows = await pool.query<{ status: string }>(
    'SELECT status FROM section_case_stocks WHERE section_id = $1',
    [sectionId],
  )
  assert.equal(stockRows.rows[0]?.status, 'published')
})

test('M3b：行情层（同步幂等 / 学员端只读清单内标的 / 未同步等待态）', async () => {
  const courseId = 'T-M3B-QUOTES'
  const chapterId = 'CHQT'
  const syncUrl = `/v1/admin/content/courses/${courseId}/quotes-sync`
  const catalogUrl = `/v1/catalog/courses/${courseId}/quotes`

  const course = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId, title: 'M3b 行情测试课程' },
  })
  assert.ok(course.statusCode === 201 || course.statusCode === 409, course.body)
  const chapter = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/chapters`,
    headers: adminHeaders(),
    payload: { chapterId, title: '行情章', position: 1 },
  })
  assert.ok(chapter.statusCode === 201 || chapter.statusCode === 409, chapter.body)

  const assetId = await insertAsset(courseId, '行情素材')
  const unit = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/source-units',
    headers: adminHeaders(),
    payload: {
      units: [{ assetId, startMs: 0, endMs: 300_000, transcriptText: '行情用例转写', summary: '行情单元' }],
    },
  })
  assert.equal(unit.statusCode, 200, unit.body)
  const unitId = (unit.json().saved[0] as { unitId: string }).unitId

  const section = await app.inject({
    method: 'PUT',
    url: '/v1/admin/content/sections',
    headers: adminHeaders(),
    payload: { courseId, chapterId, title: '行情节', position: 1, sourceAssetIds: [assetId] },
  })
  assert.equal(section.statusCode, 200, section.body)
  const sectionId = (section.json().section as { sectionId: string }).sectionId

  const article = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/article`,
    headers: adminHeaders(),
    payload: { markdown: '案例股行情用于课程复盘。', citations: [unitId] },
  })
  assert.equal(article.statusCode, 200, article.body)

  const stocks = await app.inject({
    method: 'PUT',
    url: `/v1/admin/content/sections/${sectionId}/case-stocks`,
    headers: adminHeaders(),
    payload: {
      stocks: [{
        name: '丰乐种业',
        exchange: 'SZSE',
        code: '000713',
        windowStart: '2019-01-02',
        windowEnd: '2020-02-28',
        events: [{ date: '2019-05-17', label: '课程筹码峰 8.68', unitId }],
      }],
    },
  })
  assert.equal(stocks.statusCode, 200, stocks.body)

  await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/approvals`,
    headers: adminHeaders(),
    payload: { gate: 'final' },
  })
  const published = await app.inject({
    method: 'POST',
    url: `/v1/admin/content/courses/${courseId}/publish`,
    headers: adminHeaders(),
  })
  assert.equal(published.statusCode, 200, published.body)

  const learner = authHeaders(mainGrant)

  // 1. 尚未同步 → pending=true 且空数组（不是 404）
  const pending = await app.inject({ method: 'GET', url: catalogUrl, headers: learner })
  assert.equal(pending.statusCode, 200, pending.body)
  assert.deepEqual(pending.json(), { pending: true, quotes: [] })

  // 2. 同步：同步执行，落 succeeded 记录
  const synced = await app.inject({ method: 'POST', url: syncUrl, headers: adminHeaders() })
  assert.equal(synced.statusCode, 200, synced.body)
  const syncBody = synced.json() as { job: { kind: string; status: string }; upserted: number }
  assert.equal(syncBody.job.kind, 'quotes_sync')
  assert.equal(syncBody.job.status, 'succeeded')
  assert.equal(syncBody.upserted, 2)

  // 3. 幂等重跑：行数不变
  const resynced = await app.inject({ method: 'POST', url: syncUrl, headers: adminHeaders() })
  assert.equal(resynced.statusCode, 200, resynced.body)
  assert.equal((resynced.json() as { upserted: number }).upserted, 2)
  const counted = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM course_stock_quotes WHERE code = $1',
    ['000713'],
  )
  assert.equal(counted.rows[0]?.count, 2)

  // 4. 学员端读行情：按交易日升序，成交额为 null（源不可得）
  const listed = await app.inject({ method: 'GET', url: catalogUrl, headers: learner })
  assert.equal(listed.statusCode, 200, listed.body)
  const quotes = (listed.json() as { pending: boolean; quotes: Record<string, unknown>[] })
  assert.equal(quotes.pending, false)
  assert.equal(quotes.quotes.length, 2)
  assert.equal(quotes.quotes[0]?.tradeDate, '2026-11-03')
  assert.equal(quotes.quotes[1]?.tradeDate, '2026-11-04')
  assert.equal(quotes.quotes[0]?.code, '000713')
  assert.equal(quotes.quotes[1]?.close, 8.7)
  assert.equal(quotes.quotes[0]?.amount, null)
  assert.equal(quotes.quotes[0]?.source, 'tencent-qfq')
  // 响应形状须符合 @trend/contracts 学员端契约
  assert.equal(quotesListOutput.safeParse(listed.json()).success, true)

  // 5. 清单外代号被过滤（不回 403，也不泄露他课数据）
  const filtered = await app.inject({
    method: 'GET',
    url: `${catalogUrl}?codes=000713,000001`,
    headers: learner,
  })
  assert.equal(filtered.statusCode, 200, filtered.body)
  const filteredQuotes = (filtered.json() as { quotes: { code: string }[] }).quotes
  assert.ok(filteredQuotes.length > 0)
  assert.ok(filteredQuotes.every(quote => quote.code === '000713'))

  // 6. 非法代号 → 400
  const badCodes = await app.inject({ method: 'GET', url: `${catalogUrl}?codes=abc`, headers: learner })
  assert.equal(badCodes.statusCode, 400, badCodes.body)

  // 7. 时间窗内无数据 ≠ 待同步（pending 只表示压根没同步过）
  const emptyWindow = await app.inject({
    method: 'GET',
    url: `${catalogUrl}?from=2026-12-01`,
    headers: learner,
  })
  assert.equal(emptyWindow.statusCode, 200, emptyWindow.body)
  assert.deepEqual(emptyWindow.json(), { pending: false, quotes: [] })

  // 8. producer 无同步权限 → 403
  const PRODUCER = 'm3b-quoter'
  const PRODUCER_PASSWORD = 'quoter-pass-123'
  const created = await adminCreateUser({
    username: PRODUCER,
    displayName: 'M3b 行情越权',
    role: 'producer',
    password: PRODUCER_PASSWORD,
  })
  assert.ok(created.statusCode === 201 || created.statusCode === 409, JSON.stringify(created.body))
  const producerLogin = await loginSession(PRODUCER, PRODUCER_PASSWORD)
  assert.equal(producerLogin.statusCode, 200, JSON.stringify(producerLogin.body))
  const producerSync = await app.inject({
    method: 'POST',
    url: syncUrl,
    headers: { authorization: `Bearer ${producerLogin.body.token}` },
  })
  assert.equal(producerSync.statusCode, 403, producerSync.body)

  // 9. 未发布课程 → 404
  const draftCourse = await app.inject({
    method: 'POST',
    url: '/v1/admin/content/courses',
    headers: adminHeaders(),
    payload: { courseId: 'T-M3B-QUOTES-DRAFT', title: '未发布行情课' },
  })
  assert.ok(draftCourse.statusCode === 201 || draftCourse.statusCode === 409, draftCourse.body)
  const draftQuotes = await app.inject({
    method: 'GET',
    url: '/v1/catalog/courses/T-M3B-QUOTES-DRAFT/quotes',
    headers: learner,
  })
  assert.equal(draftQuotes.statusCode, 404, draftQuotes.body)
})
