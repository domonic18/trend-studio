import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterPeriodWindow, findPeriodIndex, isoWeekKey, toPeriodBars } from '../lib/kline/period.js'
import { DEFAULT_OVERLAYS, parseOverlayPeriods } from '../lib/kline/kline-chart.js'

function bar(tradeDate, close, code = '000661') {
  return { code, tradeDate, open: close, high: close, low: close, close, volume: 100, amount: null }
}

test('均线位解析：认 M 开头数字，去重排序，忽略非法项', () => {
  assert.deepEqual(parseOverlayPeriods(['M60', 'M5', 'M10']), [5, 10, 60])
  assert.deepEqual(parseOverlayPeriods(['M5', 'M5']), [5])
  assert.deepEqual(parseOverlayPeriods(['MA60', 'X', 'M0']), [])
  assert.deepEqual(DEFAULT_OVERLAYS, ['M5', 'M10', 'M60'])
})

test('周线聚合：同一自然周合成一根，开取首日、收取末日、高低取极值、量累加', () => {
  const daily = [
    bar('2026-07-13', 10),
    bar('2026-07-14', 12),
    bar('2026-07-15', 11),
    bar('2026-07-16', 13),
    bar('2026-07-17', 14),
    bar('2026-07-20', 15),
  ]
  const weekly = toPeriodBars(daily, '1w')
  assert.equal(weekly.length, 2)
  assert.equal(weekly[0].open, 10)
  assert.equal(weekly[0].close, 14)
  assert.equal(weekly[0].high, 14)
  assert.equal(weekly[0].low, 10)
  assert.equal(weekly[0].volume, 500)
  assert.equal(weekly[0].startDate, '2026-07-13')
  assert.equal(weekly[0].endDate, '2026-07-17')
  assert.equal(weekly[0].tradeDate, '2026-07-17')
  assert.equal(weekly[1].startDate, '2026-07-20')
})

test('日线周期：原样透传，起止日期同为交易日', () => {
  const daily = [bar('2026-07-13', 10), bar('2026-07-14', 11)]
  const same = toPeriodBars(daily, '1d')
  assert.equal(same.length, 2)
  assert.equal(same[0].startDate, '2026-07-13')
  assert.equal(same[0].endDate, '2026-07-13')
  assert.equal(same[0].close, 10)
})

test('周线窗口过滤按周期区间相交，边界周不被切碎', () => {
  const daily = [bar('2026-07-13', 10), bar('2026-07-17', 14), bar('2026-07-20', 15)]
  const weekly = toPeriodBars(daily, '1w')
  const picked = filterPeriodWindow(weekly, { from: '2026-07-15', to: '2026-07-18' })
  assert.equal(picked.length, 1)
  assert.equal(picked[0].endDate, '2026-07-17')
})

test('日期定位到周期 bar：周内任意交易日归到该周收盘 bar', () => {
  const weekly = toPeriodBars([bar('2026-07-13', 10), bar('2026-07-17', 14)], '1w')
  assert.equal(findPeriodIndex(weekly, '2026-07-15'), 0)
  assert.equal(findPeriodIndex(weekly, '2026-07-17'), 0)
  assert.equal(findPeriodIndex(weekly, '2026-07-20'), -1)
})

test('ISO 周键：周一与周日同属一周', () => {
  assert.equal(isoWeekKey('2026-07-13'), isoWeekKey('2026-07-19'))
  assert.notEqual(isoWeekKey('2026-07-19'), isoWeekKey('2026-07-20'))
})
