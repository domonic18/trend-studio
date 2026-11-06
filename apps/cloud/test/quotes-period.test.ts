import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createPool } from '../src/db.js'
import { runMigrations } from '../src/migrate.js'
import { syncCourseQuotes } from '../src/pipeline/quotes/sync.js'
import type { QuoteBar } from '../src/pipeline/quotes/tencent.js'
import { readQuotes } from '../src/quotes/read.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://trend_coach:trend_coach@127.0.0.1:5432/trend_coach_test'
const pool = createPool(DATABASE_URL)

const COURSE_ID = 'T-QUOTES-PERIOD'
const SECTION_ID = 'sec_00000000000000aa'
const SECTION_ID_2 = 'sec_00000000000000bb'
const CHAPTER_ID = 'CH-1'

function bar(tradeDate: string, close: number): QuoteBar {
  return { tradeDate, open: close, high: close, low: close, close, volume: 100 }
}

before(async () => {
  await runMigrations(pool, { reset: true })
  await pool.query(
    `INSERT INTO courses (course_id, title, status) VALUES ($1, '行情周期测试', 'published')`,
    [COURSE_ID],
  )
  await pool.query(
    `INSERT INTO chapters (course_id, chapter_id, title, position) VALUES ($1, $2, '第一章', 1)`,
    [COURSE_ID, CHAPTER_ID],
  )
  await pool.query(
    `INSERT INTO sections (section_id, course_id, chapter_id, title, position, status, published_at)
     VALUES
       ($1, $3, $4, '第一节', 1, 'published', now()),
       ($2, $3, $4, '第二节', 2, 'published', now())`,
    [SECTION_ID, SECTION_ID_2, COURSE_ID, CHAPTER_ID],
  )
  // 同一只标的声明两种周期（周线案例股 + 日线案例股），另两只各一种。
  // 同一节内一个代号只登记一次，故双周期股分落两节。
  await pool.query(
    `INSERT INTO section_case_stocks (stock_ref_id, section_id, course_id, name, exchange, code, period,
                                      window_start, window_end, status, position)
     VALUES
       ('cst_00000000000000a1', $1, $3, '周线股', 'SZSE', '000001', '1w', '2021-01-01', '2026-11-05', 'published', 1),
       ('cst_00000000000000a2', $1, $3, '双周期股', 'SZSE', '000002', '1d', '2025-01-01', '2026-11-05', 'published', 2),
       ('cst_00000000000000a3', $2, $3, '双周期股', 'SZSE', '000002', '1w', '2025-01-01', '2026-11-05', 'published', 1),
       ('cst_00000000000000a4', $1, $3, '日线股', 'SSE', '600519', '1d', '2025-01-01', '2026-11-05', 'published', 3)`,
    [SECTION_ID, SECTION_ID_2, COURSE_ID],
  )
})

after(async () => {
  await pool.end()
})

test('同步按案例股声明的周期分别落库，同一标的两种周期互不覆盖', async () => {
  const requested: string[] = []
  const fetcher = async (symbol: string, period: '1d' | '1w'): Promise<QuoteBar[]> => {
    requested.push(`${symbol}:${period}`)
    return period === '1w'
      ? [bar('2021-04-30', 10), bar('2026-11-06', 20)]
      : [bar('2025-01-02', 5), bar('2026-11-05', 15)]
  }

  const result = await syncCourseQuotes(pool, COURSE_ID, fetcher)
  assert.equal(result.stocks, 4)
  assert.deepEqual(result.skipped, [])
  assert.ok(requested.includes('sz000001:1w'), requested.join(','))
  assert.ok(requested.includes('sz000002:1d'), requested.join(','))
  assert.ok(requested.includes('sz000002:1w'), requested.join(','))
  assert.ok(requested.includes('sh600519:1d'), requested.join(','))

  const rows = await pool.query<{ code: string; period: string; count: string }>(
    `SELECT code, period, count(*)::text AS count FROM course_stock_quotes
      GROUP BY code, period ORDER BY code, period`,
  )
  assert.deepEqual(rows.rows, [
    { code: '000001', period: '1w', count: '2' },
    { code: '000002', period: '1d', count: '2' },
    { code: '000002', period: '1w', count: '2' },
    { code: '600519', period: '1d', count: '2' },
  ])

  // 重跑幂等：同键覆盖，行数不变。
  const again = await syncCourseQuotes(pool, COURSE_ID, fetcher)
  assert.equal(again.upserted, result.upserted)
  const after = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM course_stock_quotes',
  )
  assert.equal(after.rows[0]?.count, '8')
})

test('行情读取按周期隔离：请求周线只回周线，且条目带周期', async () => {
  const weekly = await readQuotes(pool, COURSE_ID, { period: '1w' }, { publishedOnly: true })
  assert.equal(weekly.pending, false)
  assert.ok(weekly.quotes.length > 0)
  assert.ok(weekly.quotes.every(quote => quote.period === '1w'))
  assert.deepEqual(
    weekly.quotes.filter(quote => quote.code === '000001').map(quote => quote.tradeDate),
    ['2021-04-30', '2026-11-06'],
  )

  const daily = await readQuotes(pool, COURSE_ID, { period: '1d' }, { publishedOnly: true })
  assert.ok(daily.quotes.every(quote => quote.period === '1d'))
  assert.deepEqual(
    daily.quotes.filter(quote => quote.code === '000002').map(quote => quote.tradeDate),
    ['2025-01-02', '2026-11-05'],
  )

  // 缺省周期为日线。
  const fallback = await readQuotes(pool, COURSE_ID, {}, { publishedOnly: true })
  assert.ok(fallback.quotes.every(quote => quote.period === '1d'))
})

test('请求未同步的周期时返回待同步而非空成功', async () => {
  await pool.query(`DELETE FROM course_stock_quotes WHERE code = '000001' AND period = '1w'`)
  const weekly = await readQuotes(pool, COURSE_ID, { codes: ['000001'], period: '1w' }, { publishedOnly: true })
  assert.equal(weekly.pending, true)
  assert.deepEqual(weekly.quotes, [])
})
