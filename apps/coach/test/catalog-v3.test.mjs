import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSectionPlayback,
  getCatalogCourse,
  getCatalogSection,
  getCourseQuotes,
} from '../lib/host/cloud-client.js'
import { InputError, InvalidResponseError, UpstreamError } from '../lib/errors.js'

const signal = new AbortController().signal

const SECTION_ID = 'sec_0123456789abcdef'
const ASSET_ID = 'asset_0123456789abcdef'
const COURSE_ID = 'TC-101'

/** 记录请求路径，便于断言 URL 拼接与 query 传参。 */
function stub(payload, status = 200) {
  const calls = []
  return {
    calls,
    request: async (path) => {
      calls.push(path)
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

function sectionSummary(overrides = {}) {
  return {
    sectionId: SECTION_ID,
    title: '第一节 趋势的度量',
    position: 0,
    hasArticle: true,
    figureCount: 1,
    widgetTypes: ['ma_slope'],
    caseStockCodes: ['600519'],
    ...overrides,
  }
}

function widgetPayload(overrides = {}) {
  return {
    widgetId: 'wgt_demo1',
    type: 'ma_slope',
    specVersion: 1,
    version: 2,
    spec: { unitId: 'su_demo1', from: 0, to: 60 },
    assertions: { slopeUp: true },
    ...overrides,
  }
}

function figurePayload(overrides = {}) {
  return {
    figureId: 'fig_demo1',
    kind: 'ma_diagram',
    caption: '均线示意图',
    assetId: ASSET_ID,
    sourceSec: 12,
    candidateId: 'cand_demo1',
    url: 'https://media.example.com/figures/fig_demo1/cand_demo1.jpg?expires=1&sig=x',
    ...overrides,
  }
}

function caseStockPayload(overrides = {}) {
  return {
    code: '600519',
    name: '贵州茅台',
    exchange: 'SSE',
    windowStart: '2026-01-05',
    windowEnd: '2026-02-10',
    events: [{ at: '2026-01-12', kind: 'breakout' }],
    ...overrides,
  }
}

function sectionPayload(overrides = {}) {
  return {
    sectionId: SECTION_ID,
    courseId: COURSE_ID,
    chapterId: 'M1',
    title: '第一节 趋势的度量',
    position: 0,
    article: {
      markdown: '# 趋势的度量\n\n[[unit:su_demo1|均线证据]]\n\n正文。',
      dslVersion: 1,
      version: 3,
      publishedAt: 1_760_000_000_000,
    },
    widgets: [widgetPayload()],
    figures: [figurePayload()],
    caseStocks: [caseStockPayload()],
    ...overrides,
  }
}

function quoteItemPayload(overrides = {}) {
  return {
    code: '600519',
    tradeDate: '2026-01-05',
    open: 1680.5,
    high: 1702.25,
    low: 1675,
    close: 1698.75,
    volume: 2_345_600,
    amount: 3_958_000_000,
    source: 'tencent-qfq',
    period: '1d',
    ...overrides,
  }
}

test('catalogSection 返回正文、课件、图示与案例股', async () => {
  const section = await getCatalogSection(stub(sectionPayload()), COURSE_ID, SECTION_ID, signal)
  assert.equal(section.sectionId, SECTION_ID)
  assert.equal(section.article.dslVersion, 1)
  assert.equal(section.widgets[0].type, 'ma_slope')
  assert.equal(section.figures[0].figureId, 'fig_demo1')
  assert.equal(section.caseStocks[0].code, '600519')
})

test('catalogSection 允许未发布正文但拒绝残缺节', async () => {
  const withoutArticle = await getCatalogSection(
    stub(sectionPayload({ article: null })),
    COURSE_ID,
    SECTION_ID,
    signal,
  )
  assert.equal(withoutArticle.article, null)

  const cases = {
    '节 ID 不一致': sectionPayload({ sectionId: 'sec_ffffffffffffffff' }),
    '课程 ID 不一致': sectionPayload({ courseId: 'TC-999' }),
    '正文缺 dslVersion': sectionPayload({ article: { markdown: '# x', version: 1, publishedAt: 1 } }),
    '课件 spec 非对象': sectionPayload({ widgets: [widgetPayload({ spec: 'nope' })] }),
    '课件断言非对象': sectionPayload({ widgets: [widgetPayload({ assertions: [] })] }),
    '图示地址非 http(s)': sectionPayload({ figures: [figurePayload({ url: 'javascript:alert(1)' })] }),
    '图示地址带凭据': sectionPayload({
      figures: [figurePayload({ url: 'https://u:p@media.example.com/a.jpg' })],
    }),
    '图示 caption 为空': sectionPayload({ figures: [figurePayload({ caption: '' })] }),
    '案例股代码非法': sectionPayload({ caseStocks: [caseStockPayload({ code: '60051' })] }),
    '案例股交易所非法': sectionPayload({ caseStocks: [caseStockPayload({ exchange: 'NYSE' })] }),
    '案例股窗口日期非法': sectionPayload({ caseStocks: [caseStockPayload({ windowStart: '2026/01/05' })] }),
  }
  for (const [name, payload] of Object.entries(cases)) {
    await assert.rejects(
      getCatalogSection(stub(payload), COURSE_ID, SECTION_ID, signal),
      (error) => error instanceof InvalidResponseError,
      name,
    )
  }
})

test('catalogSection 拒绝图示超限', async () => {
  const figures = []
  for (let index = 0; index < 4; index += 1) figures.push(figurePayload({ figureId: `fig_demo${index}` }))
  await assert.rejects(
    getCatalogSection(stub(sectionPayload({ figures })), COURSE_ID, SECTION_ID, signal),
    (error) => error instanceof InvalidResponseError,
  )
})

test('catalogSection 拒绝非法节 ID 且不发起请求', async () => {
  const auth = stub(sectionPayload())
  await assert.rejects(
    getCatalogSection(auth, COURSE_ID, 'bad/section', signal),
    (error) => error instanceof InputError,
  )
  assert.equal(auth.calls.length, 0)
})

test('catalogSection 把上游非 2xx 转成 UpstreamError', async () => {
  await assert.rejects(
    getCatalogSection(stub({ error: 'not found' }, 404), COURSE_ID, SECTION_ID, signal),
    (error) => error instanceof UpstreamError,
  )
})

test('sectionPlayback 返回播放会话并校验请求窗', async () => {
  const auth = stub({
    sessionId: 'play_demo1',
    playlistUrl: 'https://media.example.com/hls/play_demo1/index.m3u8?expires=1&sig=x',
    fromSec: 10,
    toSec: 40,
    expiresAt: 1_760_100_000_000,
  })
  const playback = await createSectionPlayback(auth, SECTION_ID, ASSET_ID, 10, 40, signal)
  assert.equal(playback.sessionId, 'play_demo1')
  assert.equal(auth.calls[0], `/v1/catalog/sections/${SECTION_ID}/playback`)

  for (const [assetId, fromSec, toSec] of [
    ['bad-asset', 10, 40],
    [ASSET_ID, -1, 40],
    [ASSET_ID, 10, 10],
    [ASSET_ID, 40, 10],
    [ASSET_ID, 0, 86_401],
    [ASSET_ID, 0.5, 40],
  ]) {
    await assert.rejects(
      createSectionPlayback(stub({}), SECTION_ID, assetId, fromSec, toSec, signal),
      (error) => error instanceof InvalidResponseError,
      `${assetId} ${fromSec} ${toSec}`,
    )
  }
})

test('sectionPlayback 把越窗 409 翻成学员可读文案', async () => {
  await assert.rejects(
    createSectionPlayback(
      stub({ error: { code: 'playback_window_invalid', message: 'out of window' } }, 409),
      SECTION_ID,
      ASSET_ID,
      10,
      40,
      signal,
    ),
    (error) => error instanceof InvalidResponseError
      && error.message === '播放窗口超出该片段的可用范围',
  )
})

test('sectionPlayback 对其他 409 不误判为越窗', async () => {
  await assert.rejects(
    createSectionPlayback(stub({ error: { code: 'other_conflict', message: 'x' } }, 409), SECTION_ID, ASSET_ID, 10, 40, signal),
    (error) => error instanceof UpstreamError,
  )
})

test('sectionPlayback 拒绝不合法的播放会话响应', async () => {
  const cases = {
    '缺 sessionId': { playlistUrl: 'https://media.example.com/a.m3u8', expiresAt: 1 },
    '地址非 http(s)': { sessionId: 's1', playlistUrl: 'data:text/plain,a', expiresAt: 1 },
    '窗为负': { sessionId: 's1', playlistUrl: 'https://media.example.com/a.m3u8', fromSec: -1, toSec: 1, expiresAt: 1 },
    '缺过期时间': { sessionId: 's1', playlistUrl: 'https://media.example.com/a.m3u8' },
  }
  for (const [name, payload] of Object.entries(cases)) {
    await assert.rejects(
      createSectionPlayback(stub(payload), SECTION_ID, ASSET_ID, 10, 40, signal),
      (error) => error instanceof InvalidResponseError,
      name,
    )
  }
})

test('courseQuotes 返回行情并按 code 过滤', async () => {
  const auth = stub({ pending: false, quotes: [quoteItemPayload()] })
  const quotes = await getCourseQuotes(auth, COURSE_ID, ['600519'], '1d', signal)
  assert.equal(quotes.pending, false)
  assert.equal(quotes.quotes[0].close, 1698.75)
  assert.equal(auth.calls[0], `/v1/catalog/courses/${COURSE_ID}/quotes?codes=600519&period=1d`)

  const all = await getCourseQuotes(stub({ pending: false, quotes: [] }), COURSE_ID, undefined, '1d', signal)
  assert.equal(all.quotes.length, 0)
})

test('courseQuotes 按周期取行情并保留条目的周期', async () => {
  const auth = stub({ pending: false, quotes: [quoteItemPayload({ period: '1w' })] })
  const quotes = await getCourseQuotes(auth, COURSE_ID, ['600519'], '1w', signal)
  assert.equal(auth.calls[0], `/v1/catalog/courses/${COURSE_ID}/quotes?codes=600519&period=1w`)
  assert.equal(quotes.quotes[0].period, '1w')
})

test('courseQuotes 支持 pending 态（等待行情同步）', async () => {
  const quotes = await getCourseQuotes(stub({ pending: true, quotes: [] }), COURSE_ID, undefined, '1d', signal)
  assert.equal(quotes.pending, true)
  assert.deepEqual(quotes.quotes, [])
})

test('courseQuotes 拒绝非法标的与非法条目', async () => {
  for (const codes of [[], ['60051'], ['60051X'], Array.from({ length: 11 }, () => '600519')]) {
    await assert.rejects(
      getCourseQuotes(stub({ pending: false, quotes: [] }), COURSE_ID, codes, '1d', signal),
      (error) => error instanceof InvalidResponseError,
      JSON.stringify(codes),
    )
  }

  const cases = {
    '日期非法': quoteItemPayload({ tradeDate: '2026/01/05' }),
    '价格为 NaN': quoteItemPayload({ close: Number.NaN }),
    '成交量为负': quoteItemPayload({ volume: -1 }),
    '成交量非整数': quoteItemPayload({ volume: 1.5 }),
    '来源缺失': quoteItemPayload({ source: '' }),
    '周期非法': quoteItemPayload({ period: '1m' }),
  }
  for (const [name, item] of Object.entries(cases)) {
    await assert.rejects(
      getCourseQuotes(stub({ pending: false, quotes: [item] }), COURSE_ID, undefined, '1d', signal),
      (error) => error instanceof InvalidResponseError,
      name,
    )
  }
})

test('catalogCourse 接受 v3 课程树并返回节摘要', async () => {
  const payload = {
    contractVersion: 3,
    courseId: COURSE_ID,
    title: '趋势交易基础',
    chapters: [{
      chapterId: 'M1',
      title: '第一章 趋势认知',
      position: 0,
      hasArticle: true,
      figureCount: 1,
      knowledgePoints: [],
    }],
    sections: [sectionSummary()],
  }
  const course = await getCatalogCourse(stub(payload), COURSE_ID, signal)
  assert.equal(course.contractVersion, 3)
  assert.equal(course.sections.length, 1)
  assert.deepEqual(course.sections[0].caseStockCodes, ['600519'])
})

test('catalogCourse 拒绝 v3 里残缺的节摘要', async () => {
  const cases = {
    '节 ID 非法': sectionSummary({ sectionId: 'bad' }),
    'widgetTypes 非数组': sectionSummary({ widgetTypes: 'ma_slope' }),
    '案例股代码非法': sectionSummary({ caseStockCodes: ['60051'] }),
    'figureCount 为负': sectionSummary({ figureCount: -1 }),
  }
  for (const [name, summary] of Object.entries(cases)) {
    const payload = {
      contractVersion: 3,
      courseId: COURSE_ID,
      title: '趋势交易基础',
      chapters: [],
      sections: [summary],
    }
    await assert.rejects(
      getCatalogCourse(stub(payload), COURSE_ID, signal),
      (error) => error instanceof InvalidResponseError,
      name,
    )
  }
})

test('catalogCourse 对 v2 老课程保持兼容（无节摘要仍可学）', async () => {
  const payload = {
    contractVersion: 2,
    courseId: COURSE_ID,
    title: '趋势交易基础',
    chapters: [{
      chapterId: 'M1',
      title: '第一章 趋势认知',
      position: 0,
      hasArticle: true,
      figureCount: 1,
      knowledgePoints: [],
    }],
  }
  const course = await getCatalogCourse(stub(payload), COURSE_ID, signal)
  assert.equal(course.contractVersion, 2)
  assert.equal(course.sections, undefined)
})
