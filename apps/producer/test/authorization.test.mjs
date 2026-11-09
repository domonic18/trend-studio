/** 授权流状态机：开码 → notify+开浏览器 → 轮询 → commit；过期、取消与坏回执各有出路。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runConsoleLogin } from '../lib/host/authorization.js'

const BASE = 'http://cloud.test'
const SESSION_PAYLOAD = {
  token: 'sess-token',
  expiresAt: Date.now() + 43_200_000,
  user: { userId: 'u1', username: 'teacher01', displayName: null, role: 'producer' },
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(JSON.stringify(payload).length) }),
    json: async () => payload,
  }
}

/** 把 fetch 桩成按序回放：responses 数组元素是 Response 形状或抛出的 Error。 */
function stubFetch(responses) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function makeSession() {
  const controller = new AbortController()
  const notices = []
  const commits = []
  return {
    signal: controller.signal,
    controller,
    notices,
    commits,
    method: 'browser',
    notify: notice => notices.push(notice),
    commit: async record => commits.push(record),
  }
}

const noOpen = () => {}
const silentLogger = { info() {}, warn() {} }

test('授权流：pending → authorized，commit 的 record 带完整 console 会话', async () => {
  const stub = stubFetch([
    jsonResponse({ deviceCode: 'dc-1', userCode: 'ABCD-EFGH', verificationUri: `${BASE}/device?code=ABCD-EFGH`, expiresIn: 300, interval: 1 }),
    jsonResponse({ status: 'pending' }),
    jsonResponse({ status: 'authorized', session: SESSION_PAYLOAD }),
  ])
  let opened = null
  try {
    const session = makeSession()
    await runConsoleLogin(session, BASE, silentLogger, url => { opened = url })
    assert.equal(opened, `${BASE}/device?code=ABCD-EFGH`, '浏览器要打开授权页')
    assert.equal(session.notices.length, 2)
    assert.equal(session.notices[0].code, 'ABCD-EFGH')
    assert.equal(session.notices[0].url, `${BASE}/device?code=ABCD-EFGH`)
    assert.equal(session.commits.length, 1)
    assert.equal(session.commits[0].kind, 'grant')
    assert.equal(session.commits[0].payload.token, 'sess-token')
    assert.equal(session.commits[0].payload.user.username, 'teacher01')
    // 开码用的是 producer clientId，轮询带 deviceCode
    const startCall = JSON.parse(stub.calls[0].init.body)
    assert.equal(startCall.clientId, 'dsh-plugin-trend-producer')
    assert.match(startCall.deviceId, /^dsh-[0-9a-f]{24}$/)
    assert.equal(stub.calls[0].url, `${BASE}/v1/auth/device/code`)
    assert.equal(JSON.parse(stub.calls[1].init.body).deviceCode, 'dc-1')
    assert.equal(stub.calls[1].url, `${BASE}/v1/auth/device/token`)
  } finally {
    stub.restore()
  }
})

test('授权流：设备码过期时报可重试文案', async () => {
  const stub = stubFetch([
    jsonResponse({ deviceCode: 'dc-1', userCode: 'ABCD-EFGH', verificationUri: `${BASE}/device`, expiresIn: 300, interval: 1 }),
    jsonResponse({ status: 'expired' }),
  ])
  try {
    const session = makeSession()
    await assert.rejects(runConsoleLogin(session, BASE, silentLogger, noOpen), /设备码已过期/)
    assert.equal(session.commits.length, 0, '失败路径绝不 commit')
  } finally {
    stub.restore()
  }
})

test('授权流：signal 取消时停止轮询并抛错，不 commit', async () => {
  const stub = stubFetch([
    jsonResponse({ deviceCode: 'dc-1', userCode: 'ABCD-EFGH', verificationUri: `${BASE}/device`, expiresIn: 300, interval: 1 }),
    jsonResponse({ status: 'pending' }),
  ])
  try {
    const session = makeSession()
    const pending = runConsoleLogin(session, BASE, silentLogger, noOpen)
    session.controller.abort()
    await assert.rejects(pending, /已取消/)
    assert.equal(session.commits.length, 0)
  } finally {
    stub.restore()
  }
})

test('授权流：开码失败（非 2xx）抛带状态码的错误', async () => {
  const stub = stubFetch([jsonResponse({ error: 'too many requests' }, 429)])
  try {
    await assert.rejects(runConsoleLogin(makeSession(), BASE, silentLogger, noOpen), /429/)
  } finally {
    stub.restore()
  }
})

test('授权流：回执缺字段或形状不对按不可识别报错', async () => {
  const stub = stubFetch([jsonResponse({ deviceCode: 'dc-1' })])
  try {
    await assert.rejects(runConsoleLogin(makeSession(), BASE, silentLogger, noOpen), /无法识别|缺少字段/)
  } finally {
    stub.restore()
  }
})
