/** console 凭据记录的解析防线：损坏的存量 record 一律按未登录处理，不阻塞重登。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRANT_EXPIRY_SKEW_MS, isConsoleGrantFresh, parseConsoleGrant, toConsoleGrantRecord } from '../lib/host/console-grant.js'

const VALID = {
  token: 'tok-1',
  expiresAt: Date.now() + 3_600_000,
  user: { userId: 'u1', username: 'teacher01', displayName: null, role: 'producer' },
}

test('grant 解析：合法 record 原样往返', () => {
  const record = toConsoleGrantRecord(VALID)
  const parsed = parseConsoleGrant(record)
  assert.equal(parsed.token, 'tok-1')
  assert.equal(parsed.user.username, 'teacher01')
  assert.equal(parsed.user.role, 'producer')
})

test('grant 解析：非 grant record、缺字段、payload 畸形都按未登录处理', () => {
  assert.equal(parseConsoleGrant(undefined), null)
  assert.equal(parseConsoleGrant({ kind: 'api-key', key: 'k' }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: null }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: 'string' }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { token: '', expiresAt: 1, user: VALID.user } }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { token: 't', expiresAt: NaN, user: VALID.user } }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { token: 't', expiresAt: -1, user: VALID.user } }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { token: 't', expiresAt: 1, user: null } }), null)
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { token: 't', expiresAt: 1, user: { userId: 'u', username: 1, role: 'r' } } }), null)
  // displayName 允许 null 与 string，别的形状拒绝
  const withDisplay = { ...VALID, user: { ...VALID.user, displayName: '张老师' } }
  assert.equal(parseConsoleGrant(toConsoleGrantRecord(withDisplay)).user.displayName, '张老师')
  assert.equal(parseConsoleGrant({ kind: 'grant', payload: { ...VALID, user: { ...VALID.user, displayName: 42 } } }), null)
})

test('grant 新鲜度：expiresAt 前一分钟起视为不新鲜', () => {
  const now = Date.now()
  assert.equal(isConsoleGrantFresh(VALID, now), true)
  assert.equal(isConsoleGrantFresh(null, now), false)
  assert.equal(isConsoleGrantFresh({ ...VALID, expiresAt: now + GRANT_EXPIRY_SKEW_MS }, now), false, '余量线上不新鲜')
  assert.equal(isConsoleGrantFresh({ ...VALID, expiresAt: now + GRANT_EXPIRY_SKEW_MS + 1 }, now), true)
  assert.equal(isConsoleGrantFresh({ ...VALID, expiresAt: now - 1 }, now), false, '过期即不新鲜')
})
