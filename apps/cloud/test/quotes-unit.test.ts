import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQuoteCodes, parseQuoteDate } from '../src/catalog/quotes.js'
import {
  parseTencentDailyKline,
  QuotesError,
  tencentSymbol,
} from '../src/pipeline/quotes/tencent.js'
import {
  TENCENT_DAY_PAYLOAD,
  TENCENT_ERROR_PAYLOAD,
  TENCENT_QFQ_PAYLOAD,
} from './quotes-fixtures.js'

test('腾讯日K 解析：字段序为 [日期, 开, 收, 高, 低, 成交量]', () => {
  const bars = parseTencentDailyKline(TENCENT_QFQ_PAYLOAD, 'sz000001')
  assert.equal(bars.length, 6)
  assert.deepEqual(bars[0], {
    tradeDate: '2026-10-29',
    open: 11.3,
    close: 11.54,
    high: 11.55,
    low: 11.29,
    volume: 1993504,
  })
  assert.deepEqual(bars[5], {
    tradeDate: '2026-11-05',
    open: 11.71,
    close: 11.64,
    high: 11.77,
    low: 11.56,
    volume: 1228997,
  })
  // 高低价不得与开收互换
  for (const bar of bars) {
    assert.ok(bar.high >= Math.max(bar.open, bar.close))
    assert.ok(bar.low <= Math.min(bar.open, bar.close))
  }
})

test('腾讯日K 解析：不复权 day 回落与非法行跳过', () => {
  const bars = parseTencentDailyKline(TENCENT_DAY_PAYLOAD, 'sz000001')
  assert.equal(bars.length, 2)
  assert.equal(bars[0]?.tradeDate, '2026-11-04')

  const mixed = parseTencentDailyKline(
    '{"code":0,"data":{"sz000001":{"qfqday":[["2026-11-05","11.71","11.64","11.77","11.56","1228997"],["bad-date","1","1","1","1","1"],["2026-11-06","1","2","3"]]}}}',
    'sz000001',
  )
  assert.equal(mixed.length, 1)
  assert.equal(mixed[0]?.tradeDate, '2026-11-05')
})

test('腾讯日K 解析：非法报文一律 invalid_response', () => {
  assert.throws(() => parseTencentDailyKline('not json', 'sz000001'), QuotesError)
  assert.throws(() => parseTencentDailyKline(TENCENT_ERROR_PAYLOAD, 'sz000001'), QuotesError)
  assert.throws(() => parseTencentDailyKline('{"code":0,"data":{}}', 'sz000001'), QuotesError)
})

test('交易所 + 代号 → 腾讯 symbol，形态非法返回 null', () => {
  assert.equal(tencentSymbol('SZSE', '000001'), 'sz000001')
  assert.equal(tencentSymbol('SSE', '600519'), 'sh600519')
  assert.equal(tencentSymbol('BSE', '430047'), 'bj430047')
  assert.equal(tencentSymbol('HKEX', '000001'), null)
  assert.equal(tencentSymbol('SZSE', 'A00001'), null)
})

test('学员行情查询参数：代号数量/形态与日期格式校验', () => {
  assert.deepEqual(parseQuoteCodes('000001,600519'), ['000001', '600519'])
  assert.deepEqual(parseQuoteCodes('000001, 000001 '), ['000001'])
  assert.throws(() => parseQuoteCodes(''), /codes must not be empty/)
  assert.throws(() => parseQuoteCodes('abc'), /6 digits/)
  assert.throws(() => parseQuoteCodes(Array.from({ length: 11 }, (_, i) => `00000${i}`).join(',')), /at most 10/)
  assert.equal(parseQuoteDate('2026-11-05', 'from'), '2026-11-05')
  assert.throws(() => parseQuoteDate('20261105', 'from'), /YYYY-MM-DD/)
})
