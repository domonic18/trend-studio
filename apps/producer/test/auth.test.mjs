/** CloudAuth 令牌解析顺序：console 凭据记录优先，legacy ref 兜底，缺失时 AuthError 文案指路 /trend login。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CloudAuth } from '../lib/host/auth.js'

const TOKEN_REF = 'TREND_PRODUCER_CONSOLE_TOKEN'
const GRANT_RECORD = {
  kind: 'grant',
  payload: {
    token: 'record-token',
    expiresAt: Date.now() + 3_600_000,
    user: { userId: 'u1', username: 'teacher01', displayName: null, role: 'producer' },
  },
}

function fakeCredentials({ record, refValue }) {
  return {
    async readRecord() {
      return record
    },
    async resolve() {
      return refValue === undefined ? undefined : { value: refValue, source: 'file' }
    },
    async describe() {
      return { configured: refValue !== undefined, writable: true }
    },
  }
}

function makeAuth(credentials) {
  return new CloudAuth({ get: name => (name === 'credentials' ? credentials : undefined) }, {
    baseUrl: 'http://cloud.test',
    timeoutMs: 5_000,
    consoleTokenRef: { get: () => TOKEN_REF },
  })
}

function stubFetch(payload) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('令牌解析：凭据记录优先——请求头带 record 的 token', async () => {
  const stub = stubFetch({ ok: true })
  try {
    const auth = makeAuth(fakeCredentials({ record: GRANT_RECORD, refValue: 'ref-token' }))
    await auth.requestJson('/v1/admin/content/courses', {})
    assert.equal(stub.calls[0].init.headers.get('authorization'), 'Bearer record-token')
  } finally {
    stub.restore()
  }
})

test('令牌解析：记录缺失时退回 legacy ref（老装机平滑迁移）', async () => {
  const stub = stubFetch({ ok: true })
  try {
    const auth = makeAuth(fakeCredentials({ record: undefined, refValue: 'ref-token' }))
    await auth.requestJson('/v1/admin/content/courses', {})
    assert.equal(stub.calls[0].init.headers.get('authorization'), 'Bearer ref-token')
  } finally {
    stub.restore()
  }
})

test('令牌解析：记录过期也退回 ref', async () => {
  const stub = stubFetch({ ok: true })
  try {
    const expired = { kind: 'grant', payload: { ...GRANT_RECORD.payload, expiresAt: Date.now() - 1 } }
    const auth = makeAuth(fakeCredentials({ record: expired, refValue: 'ref-token' }))
    await auth.requestJson('/v1/admin/content/courses', {})
    assert.equal(stub.calls[0].init.headers.get('authorization'), 'Bearer ref-token')
  } finally {
    stub.restore()
  }
})

test('令牌解析：两处都没有时 AuthError，文案指路 /trend login', async () => {
  const auth = makeAuth(fakeCredentials({ record: undefined, refValue: undefined }))
  await assert.rejects(auth.requestJson('/x'), error => {
    assert.equal(error.name, 'AuthError')
    assert.match(error.message, /\/trend login/)
    return true
  })
})
