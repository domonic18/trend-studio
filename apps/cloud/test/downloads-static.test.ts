import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db.js'
import { runMigrations } from '../src/migrate.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://trend_coach:trend_coach@127.0.0.1:5432/trend_coach_test'
const METRICS_TOKEN = 'test-metrics-token-1234'
const DOWNLOADS_DIR = join(process.cwd(), 'dist', 'downloads')
const ARTIFACT = 'dsh-plugin-trend-producer-test-0.0.0.tgz'
const ARTIFACT_BYTES = Buffer.from('fake-tarball-bytes')

const pool = createPool(DATABASE_URL)
let app: FastifyInstance | undefined

before(async () => {
  await runMigrations(pool, { reset: true })
  app = await buildApp({
    config: loadConfig({
      APP_ENV: 'local',
      DATABASE_URL,
      LOG_LEVEL: 'silent',
      METRICS_TOKEN,
    }),
    pool,
  })
  await app.ready()
})

after(async () => {
  await app?.close()
  await pool.end()
  await rm(join(DOWNLOADS_DIR, ARTIFACT), { force: true })
})

test('服务启动后落盘的下载制品能立即下载', async () => {
  assert.ok(app !== undefined)
  // 模拟「服务已在运行，发布脚本此时落盘」——这是教员点下载按钮的真实时序。
  await mkdir(DOWNLOADS_DIR, { recursive: true })
  await writeFile(join(DOWNLOADS_DIR, ARTIFACT), ARTIFACT_BYTES)

  const response = await app.inject({ method: 'GET', url: `/downloads/${ARTIFACT}` })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body, ARTIFACT_BYTES.toString('utf8'))
  assert.match(String(response.headers['content-disposition']), /attachment/)
  assert.match(String(response.headers['content-disposition']), new RegExp(ARTIFACT))
})

test('下载制品带 attachment 头，不作为 HTML 页面渲染', async () => {
  assert.ok(app !== undefined)
  await mkdir(DOWNLOADS_DIR, { recursive: true })
  await writeFile(join(DOWNLOADS_DIR, ARTIFACT), ARTIFACT_BYTES)

  const response = await app.inject({
    method: 'GET',
    url: `/downloads/${ARTIFACT}`,
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  assert.equal(response.statusCode, 200)
  assert.match(String(response.headers['content-disposition']), /attachment/)
})

test('未发布的下载制品返回 404 而非 HTML 壳', async () => {
  assert.ok(app !== undefined)
  const response = await app.inject({
    method: 'GET',
    url: '/downloads/not-published-9.9.9.tgz',
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  assert.equal(response.statusCode, 404)
  assert.doesNotMatch(response.body, /<div id="root">/)
})

test('门户下载页不被下载制品路由吃掉', async () => {
  assert.ok(app !== undefined)
  const portalBuilt = existsSync(join(process.cwd(), 'dist', 'portal', 'downloads', 'index.html'))
  if (!portalBuilt) return
  const response = await app.inject({
    method: 'GET',
    url: '/downloads',
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  assert.equal(response.statusCode, 200)
  assert.match(String(response.headers['content-type']), /text\/html/)
})
