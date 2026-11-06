import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQuoteCodes, parseQuoteDate, parseQuotePeriod } from '../src/catalog/quotes.js'
import {
  createTencentQuoteFetcher,
  parseTencentDailyKline,
  parseTencentKline,
  QuotesError,
  tencentSymbol,
} from '../src/pipeline/quotes/tencent.js'
import {
  TENCENT_DAY_PAYLOAD,
  TENCENT_ERROR_PAYLOAD,
  TENCENT_QFQ_PAYLOAD,
  TENCENT_QFQ_WEEK_PAYLOAD,
  TENCENT_WEEK_PAYLOAD,
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

test('腾讯周K 解析：取 qfqweek，周 bar 日期为该周最后交易日', () => {
  const bars = parseTencentKline(TENCENT_QFQ_WEEK_PAYLOAD, 'sz000001', '1w')
  assert.equal(bars.length, 2)
  assert.deepEqual(bars[1], {
    tradeDate: '2026-11-06',
    open: 11.71,
    close: 11.64,
    high: 11.77,
    low: 11.56,
    volume: 2828997,
  })
})

test('腾讯周K 解析：不复权 week 回落与日线报文互不串用', () => {
  const fallback = parseTencentKline(TENCENT_WEEK_PAYLOAD, 'sz000001', '1w')
  assert.equal(fallback.length, 1)
  assert.equal(fallback[0]?.tradeDate, '2026-11-06')
  // 日线报文不含周线键，按周线解析应报错而不是回落到日线
  assert.throws(() => parseTencentKline(TENCENT_QFQ_PAYLOAD, 'sz000001', '1w'), QuotesError)
})

test('腾讯拉取器按周期取对应报文与参数', async () => {
  const urls: string[] = []
  const fetcher = createTencentQuoteFetcher({
    baseUrl: 'https://example.test',
    count: 640,
  })
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL): Promise<Response> => {
    urls.push(String(input))
    const payload = String(input).includes(',week,')
      ? TENCENT_QFQ_WEEK_PAYLOAD
      : TENCENT_QFQ_PAYLOAD
    return new Response(payload, { status: 200 })
  }) as typeof globalThis.fetch
  try {
    const daily = await fetcher('sz000001', '1d')
    assert.equal(daily.length, 6)
    const weekly = await fetcher('sz000001', '1w')
    assert.equal(weekly.length, 2)
  } finally {
    globalThis.fetch = original
  }
  assert.ok(urls[0]?.includes('sz000001,day,,,640,qfq'), urls[0])
  assert.ok(urls[1]?.includes('sz000001,week,,,640,qfq'), urls[1])
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

test('行情周期参数：只认 1d / 1w，缺省日线', () => {
  assert.equal(parseQuotePeriod(undefined), '1d')
  assert.equal(parseQuotePeriod('1d'), '1d')
  assert.equal(parseQuotePeriod('1w'), '1w')
  assert.throws(() => parseQuotePeriod('1m'), /period must be one of/)
  assert.throws(() => parseQuotePeriod(''), /period must be one of/)
})
