/** /trend 命令分发：login 走授权服务并回读记录，status 汇总云端/登录态/模型密钥。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trendCommandDefinition } from '../lib/host/commands.js'
import { toConsoleGrantRecord } from '../lib/host/console-grant.js'

const BASE = 'http://cloud.test'
const GRANT = {
  token: 'sess-token',
  expiresAt: Date.now() + 43_200_000,
  user: { userId: 'u1', username: 'teacher01', displayName: null, role: 'producer' },
}

const silentLogger = { info() {}, warn() {} }

function fakeCtx({ record, refConfigured = true, authorization } = {}) {
  return {
    get(name) {
      if (name === 'credentials') {
        return {
          async readRecord() {
            return record
          },
          async resolve() {
            return undefined
          },
          async describe() {
            return { configured: refConfigured, writable: true }
          },
        }
      }
      if (name === 'authorization') return authorization
      return undefined
    },
  }
}

function stubHealthFetch(ok = true) {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok, status: ok ? 200 : 503 })
  return () => {
    globalThis.fetch = original
  }
}

function makeCommand(ctx, config = { baseUrl: BASE, understanding: { apiKeyEnv: 'TREND_PRODUCER_MODEL_KEY' } }) {
  return trendCommandDefinition(ctx, config, silentLogger)
}

const invocation = rawInput => ({ rawInput, signal: new AbortController().signal })

test('/trend login：授权成功后回读记录，回执带用户名与角色', async () => {
  const restore = stubHealthFetch()
  try {
    const record = toConsoleGrantRecord(GRANT)
    let beginKey = null
    const ctx = fakeCtx({
      record,
      authorization: {
        async begin(request) {
          beginKey = request.key
          return { status: 'authorized' }
        },
      },
    })
    const result = await makeCommand(ctx).handler(invocation('login'))
    assert.equal(beginKey, 'trend-producer/console')
    assert.equal(result.kind, 'success')
    assert.match(result.text, /teacher01/)
    assert.match(result.text, /producer/)
  } finally {
    restore()
  }
})

test('/trend login：取消不是错误；进行中给可行动提示', async () => {
  const restore = stubHealthFetch()
  try {
    const cancelled = fakeCtx({
      authorization: { async begin() { return { status: 'cancelled' } } },
    })
    const cancelledResult = await makeCommand(cancelled).handler(invocation('login'))
    assert.equal(cancelledResult.kind, 'success')
    assert.match(cancelledResult.text, /已取消/)

    const { AuthorizationError } = await import('@deepseek-ai/dsh-authorization')
    const inflight = fakeCtx({
      authorization: {
        async begin() {
          throw new AuthorizationError('attempt running', 'ALREADY_IN_FLIGHT')
        },
      },
    })
    const inflightResult = await makeCommand(inflight).handler(invocation('login'))
    assert.equal(inflightResult.kind, 'error')
    assert.match(inflightResult.text, /进行中/)
  } finally {
    restore()
  }
})

test('/trend status：三行汇总云端、登录态、模型密钥', async () => {
  const restore = stubHealthFetch()
  try {
    const ctx = fakeCtx({ record: toConsoleGrantRecord(GRANT), refConfigured: true })
    const result = await makeCommand(ctx).handler(invocation('status'))
    assert.equal(result.kind, 'success')
    assert.match(result.text, new RegExp(`云端（${BASE}）：正常`))
    assert.match(result.text, /teacher01（producer）/)
    assert.match(result.text, /模型密钥（TREND_PRODUCER_MODEL_KEY）.*已配置/)

    const loggedOut = await makeCommand(fakeCtx({})).handler(invocation(''))
    assert.match(loggedOut.text, /未登录——运行 \/trend login/)

    const noKey = await makeCommand(fakeCtx({ record: toConsoleGrantRecord(GRANT), refConfigured: false })).handler(invocation('status'))
    assert.match(noKey.text, /未配置/)
  } finally {
    restore()
  }
})

test('/trend：未知子命令报错并给出用法', async () => {
  const restore = stubHealthFetch()
  try {
    const result = await makeCommand(fakeCtx({})).handler(invocation('deploy'))
    assert.equal(result.kind, 'error')
    assert.match(result.text, /未知子命令/)
  } finally {
    restore()
  }
})
