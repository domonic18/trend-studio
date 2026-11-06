import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bareStockCode, selectReplayBars } from '../lib/replay/select-bars.js'

function bar(code, tradeDate) {
  return { code, tradeDate, open: 1, high: 1, low: 1, close: 1, volume: 0, amount: null }
}

test('带交易所前缀的代码归一为 6 位纯数字码', () => {
  assert.equal(bareStockCode('sz000661'), '000661')
  assert.equal(bareStockCode('sh600000'), '600000')
  assert.equal(bareStockCode('000661'), '000661')
})

test('回放只取课件标的的 bar，多个案例股不串位', () => {
  const bars = [
    bar('000661', '2025-09-10'),
    bar('300999', '2025-09-10'),
    bar('000661', '2025-09-11'),
  ]
  const picked = selectReplayBars(bars, 'sz000661', { from: '2025-09-01', to: '2025-09-30' })
  assert.deepEqual(picked.map(b => b.code), ['000661', '000661'])
  assert.deepEqual(picked.map(b => b.tradeDate), ['2025-09-10', '2025-09-11'])
})

test('回放按案例窗口过滤，并按日期升序', () => {
  const bars = [bar('000661', '2025-10-20'), bar('000661', '2025-09-10'), bar('000661', '2025-08-01')]
  const picked = selectReplayBars(bars, 'sz000661', { from: '2025-08-18', to: '2025-10-10' })
  assert.deepEqual(picked.map(b => b.tradeDate), ['2025-09-10'])
})

test('该标的无行情时返回空数组（渲染层给出待同步提示）', () => {
  const picked = selectReplayBars([bar('300999', '2025-09-10')], 'sz000661', { from: '2025-08-18', to: '2025-10-10' })
  assert.deepEqual(picked, [])
})

test('宿主未提供标的信息时不过滤，保持兼容', () => {
  const bars = [{ tradeDate: '2025-09-10', open: 1, high: 1, low: 1, close: 1, volume: 0, amount: null }]
  const picked = selectReplayBars(bars, 'sz000661', { from: '2025-08-18', to: '2025-10-10' })
  assert.equal(picked.length, 1)
})
