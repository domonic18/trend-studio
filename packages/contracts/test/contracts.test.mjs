import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  figureWriteInput, firstIssueDetail, sourceUnitsWriteInput, widgetWriteInput,
  caseStocksWriteInput, checkAttrs, parseBody, sectionArticleWriteInput,
  parseArticleDsl, validateArticleDsl, sourceUnitsReadInput, approvalsWriteInput,
  quotesSyncInput, quotesSyncOutput, quotesItem, quotesListOutput,
  catalogSectionSummary, catalogSectionOutput, catalogPlaybackOutput,
  dslVersionOf, DSL_VERSION, barReplayDecisionSpec, BAR_REPLAY_DECISION_ASSERTIONS,
  imageJuxtapositionSpec, IMAGE_JUXTAPOSITION_ASSERTIONS,
  branchingScenarioSpec, BRANCHING_SCENARIO_ASSERTIONS,
  mediaAssetCreateInput, uploadTicketInput, uploadTicketOutput, uploadConfirmInput,
  assetIngestInput, PRODUCTION_STEPS, PRODUCTION_STEP_LABELS, PRODUCTION_TASK_STATUSES,
  productionTaskUpsertInput, productionTaskListInput, productionBoardOutput,
} from '../lib/index.js'

const UNIT = 'su_0123456789abcdef'
const ASSET = 'asset_0123456789abcdef'
const SECTION = 'sec_0123456789abcdef'

const throwsWith = (pattern) => (message) => { throw new Error(message) }

test('firstIssueDetail：路径+消息拼接与空 issue 回退', () => {
  const result = sourceUnitsWriteInput.safeParse({ units: [{ assetId: 'bad' }] })
  assert.equal(result.success, false)
  assert.ok(firstIssueDetail(result.error).length > 0)
  const ok = sourceUnitsWriteInput.safeParse({ units: [] })
  assert.equal(ok.success, false)
  assert.match(firstIssueDetail(ok.error), /units/)
})

test('sourceUnitsWriteInput：合法往返与非法 assetId 拒绝', () => {
  const legal = sourceUnitsWriteInput.safeParse({
    units: [{ assetId: ASSET, startMs: 0, endMs: 1000, transcriptText: 'x', summary: 'y' }],
  })
  assert.equal(legal.success, true)
  assert.equal(sourceUnitsWriteInput.safeParse({
    units: [{ assetId: 'asset_xyz', startMs: 0, endMs: 1000, transcriptText: 'x', summary: 'y' }],
  }).success, false)
  assert.equal(sourceUnitsWriteInput.safeParse({
    units: [{ assetId: ASSET, startMs: 2000, endMs: 1000, transcriptText: 'x', summary: 'y' }],
  }).success, false)
})

test('widgetWriteInput：specVersion 错误版本拒绝', () => {
  const base = { sectionId: SECTION, spec: {}, assertions: {}, citations: [UNIT] }
  assert.equal(widgetWriteInput.safeParse({ ...base, type: 'mcq-quiz', specVersion: 1 }).success, true)
  assert.equal(widgetWriteInput.safeParse({ ...base, type: 'mcq-quiz', specVersion: 2 }).success, true)
  assert.equal(widgetWriteInput.safeParse({ ...base, type: 'mcq-quiz', specVersion: 3 }).success, false)
  assert.equal(widgetWriteInput.safeParse({ ...base, type: 'unknown-widget', specVersion: 1 }).success, false)
})

test('figureWriteInput：keyframe/diagram 两形与未知模板拒绝', () => {
  assert.equal(figureWriteInput.safeParse({
    sectionId: SECTION, kind: 'keyframe', assetId: ASSET, sec: 10, caption: 'c', unitId: UNIT,
  }).success, true)
  assert.equal(figureWriteInput.safeParse({
    sectionId: SECTION, kind: 'diagram', template: 'timeline', params: {}, caption: 'c',
  }).success, true)
  assert.equal(figureWriteInput.safeParse({
    sectionId: SECTION, kind: 'diagram', template: 'sankey', params: {}, caption: 'c',
  }).success, false)
  assert.equal(figureWriteInput.safeParse({
    sectionId: SECTION, kind: 'keyframe', assetId: ASSET, sec: -1, caption: 'c', unitId: UNIT,
  }).success, false)
})

test('caseStocksWriteInput：代码与交易所约束', () => {
  const stock = { name: '丰乐种业', exchange: 'SZSE', code: '000713', windowStart: '2024-01-02', windowEnd: '2024-03-01' }
  assert.equal(caseStocksWriteInput.safeParse({ sectionId: SECTION, stocks: [stock] }).success, true)
  assert.equal(caseStocksWriteInput.safeParse({ sectionId: SECTION, stocks: [{ ...stock, code: 'sz000713' }] }).success, false)
  assert.equal(caseStocksWriteInput.safeParse({ sectionId: SECTION, stocks: [{ ...stock, exchange: 'NYSE' }] }).success, false)
})

test('sectionArticleWriteInput：正文长度与引用下界', () => {
  assert.equal(sectionArticleWriteInput.safeParse({ sectionId: SECTION, markdown: 'x', citations: [UNIT] }).success, true)
  assert.equal(sectionArticleWriteInput.safeParse({ sectionId: SECTION, markdown: 'x', citations: [] }).success, false)
  assert.equal(sectionArticleWriteInput.safeParse({ sectionId: SECTION, markdown: '', citations: [UNIT] }).success, false)
})

test('checkAttrs：未知属性、缺失必填、越界整数', () => {
  const fail = throwsWith()
  assert.throws(() => checkAttrs('board', { unitId: UNIT, extra: '1' }, 1, fail), /not allowed/)
  assert.throws(() => checkAttrs('board', {}, 1, fail), /required/)
  assert.throws(() => checkAttrs('clip', { assetId: ASSET, from: '-5', to: '10', caption: 'c', unitId: UNIT }, 1, fail), /integer between/)
  checkAttrs('board', { unitId: UNIT }, 1, fail)
})

test('parseBody：text 界、json schema 拒绝、empty 非空拒绝', () => {
  const fail = throwsWith()
  assert.throws(() => parseBody('board', ['a'.repeat(501)], fail), /500/)
  assert.throws(() => parseBody('bignum', ['{not json'], fail), /single JSON object/)
  assert.throws(() => parseBody('bignum', ['{"items":[]}'], fail), /body invalid/)
  assert.throws(() => parseBody('clip', [' stray'], fail), /must be empty/)
  assert.equal(parseBody('board', ['正文'], fail), '正文')
  const parsed = parseBody('bignum', ['{"items":[{"label":"a","value":"1"}]}'], fail)
  assert.deepEqual(parsed, { items: [{ label: 'a', value: '1' }] })
})

test('parseArticleDsl：抽出段落级 unit 锚', () => {
  const parsed = parseArticleDsl('证据见 [[unit:su_0123456789abcdef|平台定义]]。', {
    bad: throwsWith(), coded: throwsWith(), conflict: throwsWith(),
  })
  assert.equal(parsed.unitAnchors.length, 1)
  assert.equal(parsed.unitAnchors[0].unitId, 'su_0123456789abcdef')
  assert.equal(parsed.unitAnchors[0].label, '平台定义')
})

test('validateArticleDsl：unit 锚不在课程 → unit_anchor_unknown', async () => {
  const parsed = parseArticleDsl('证据见 [[unit:su_ffffffffffffffff|他课证据]]。', {
    bad: throwsWith(), coded: throwsWith(), conflict: throwsWith(),
  })
  let code = null
  await validateArticleDsl(parsed, {
    sectionFigureIds: new Set(),
    units: new Map(),
    courseUnitIds: new Set([UNIT]),
    clipGrounded: () => Promise.resolve(true),
    stockInSection: () => Promise.resolve(true),
  }, { bad: throwsWith(), coded: (c) => { code = c }, conflict: throwsWith() })
  assert.equal(code, 'unit_anchor_unknown')
})

test('validateArticleDsl：unit 锚在课程内通过', async () => {
  const parsed = parseArticleDsl('证据见 [[unit:su_0123456789abcdef|平台定义]]。', {
    bad: throwsWith(), coded: throwsWith(), conflict: throwsWith(),
  })
  await validateArticleDsl(parsed, {
    sectionFigureIds: new Set(),
    units: new Map(),
    courseUnitIds: new Set([UNIT]),
    clipGrounded: () => Promise.resolve(true),
    stockInSection: () => Promise.resolve(true),
  }, { bad: throwsWith(), coded: (c) => { throw new Error(c) }, conflict: throwsWith() })
})

test('M3b schema：证据读取 / 审批 / 行情同步', () => {
  assert.equal(sourceUnitsReadInput.safeParse({ unitIds: [UNIT] }).success, true)
  assert.equal(sourceUnitsReadInput.safeParse({ unitIds: [] }).success, false)
  assert.equal(sourceUnitsReadInput.safeParse({ unitIds: ['bad'] }).success, false)

  assert.equal(approvalsWriteInput.safeParse({ courseId: 'c1', gate: 'final' }).success, true)
  assert.equal(approvalsWriteInput.safeParse({ courseId: 'c1', gate: 'mid' }).success, false)

  assert.equal(quotesSyncInput.safeParse({ courseId: 'c1' }).success, true)
  assert.equal(quotesSyncOutput.safeParse({
    job: {
      jobId: 'job_0123456789abcdef', assetId: null, courseId: 'c1', kind: 'quotes_sync',
      status: 'succeeded', stage: 'done', progress: 1, attempts: 1, maxAttempts: 2,
      errorCode: null,
    },
    upserted: 12,
  }).success, true)
})

test('M3b 行情条目 schema：口径字段与严格模式', () => {
  const bar = {
    code: '000713', tradeDate: '2026-11-04', open: 8.4, high: 8.8, low: 8.3,
    close: 8.7, volume: 135500, amount: null, source: 'tencent-qfq',
  }
  assert.equal(quotesItem.safeParse(bar).success, true)
  assert.equal(quotesListOutput.safeParse({ pending: false, quotes: [bar] }).success, true)
  assert.equal(quotesListOutput.safeParse({ pending: true, quotes: [] }).success, true)
  // 代号须 6 位数字、日期须 YYYY-MM-DD、成交量须非负整数
  assert.equal(quotesItem.safeParse({ ...bar, code: '713' }).success, false)
  assert.equal(quotesItem.safeParse({ ...bar, tradeDate: '20261104' }).success, false)
  assert.equal(quotesItem.safeParse({ ...bar, volume: 1.5 }).success, false)
  // 多余字段拒绝（strict）
  assert.equal(quotesItem.safeParse({ ...bar, adj: 'qfq' }).success, false)
  assert.equal(quotesListOutput.safeParse({ pending: false, quotes: [bar], extra: 1 }).success, false)
})

test('M3b v3 目录 schema：节摘要 / 节详情 / 播放会话', () => {
  const summary = {
    sectionId: SECTION, title: '趋势线', position: 1, hasArticle: true,
    figureCount: 1, widgetTypes: ['kline-annotator'], caseStockCodes: ['000713'],
  }
  assert.equal(catalogSectionSummary.safeParse(summary).success, true)
  assert.equal(catalogSectionSummary.safeParse({ ...summary, caseStockCodes: ['713'] }).success, false)
  assert.equal(catalogSectionSummary.safeParse({ ...summary, extra: 1 }).success, false)

  const section = {
    sectionId: SECTION,
    courseId: 'TC-101',
    chapterId: 'CH1',
    title: '趋势线',
    position: 1,
    article: { markdown: '正文', dslVersion: 1, version: 1, publishedAt: 1 },
    widgets: [{ widgetId: 'w1', type: 'kline-annotator', specVersion: 1, version: 1, spec: {}, assertions: {} }],
    figures: [{
      figureId: 'fig_1', kind: 'diagram', caption: '图', assetId: null,
      sourceSec: null, candidateId: 'cand_1', url: 'https://cdn/figures/fig_1/cand_1.jpg',
    }],
    caseStocks: [{
      code: '000713', name: '丰乐种业', exchange: 'SZSE',
      windowStart: '2019-01-02', windowEnd: '2020-02-28', events: [],
    }],
  }
  assert.equal(catalogSectionOutput.safeParse(section).success, true)
  // 图示未选定候选时 url 为 null，不允许省略字段
  assert.equal(catalogSectionOutput.safeParse({
    ...section,
    figures: [{ ...section.figures[0], url: null }],
  }).success, true)
  assert.equal(catalogSectionOutput.safeParse({
    ...section,
    figures: [{ ...section.figures[0], url: undefined }],
  }).success, false)
  assert.equal(catalogSectionOutput.safeParse({
    ...section,
    caseStocks: [{ ...section.caseStocks[0], exchange: 'NYSE' }],
  }).success, false)

  const playback = {
    sessionId: 'ps_1', playlistUrl: 'https://cdn/hls/index.m3u8?token=x',
    fromSec: 10, toSec: 40, expiresAt: 1,
  }
  assert.equal(catalogPlaybackOutput.safeParse(playback).success, true)
  assert.equal(catalogPlaybackOutput.safeParse({ ...playback, fromSec: null, toSec: null }).success, true)
  assert.equal(catalogPlaybackOutput.safeParse({ ...playback, playlistUrl: '' }).success, false)
})

// ── M10 v2：:::annotation / :::replay / bar-replay-decision ────────────────

const V2_SINK = () => {
  const hits = []
  return {
    hits,
    bad: (message) => { throw new Error(message) },
    coded: (code, message) => { hits.push(['coded', code]); throw new Error(code) },
    conflict: (code, message) => { hits.push(['conflict', code]); throw new Error(code) },
  }
}

const v2Ctx = (overrides = {}) => ({
  sectionFigureIds: new Set(),
  units: new Map([[UNIT, { assetId: ASSET, startMs: 0, endMs: 10000 }]]),
  courseUnitIds: new Set([UNIT]),
  clipGrounded: () => Promise.resolve(true),
  stockInSection: () => Promise.resolve(true),
  assetExists: () => Promise.resolve(true),
  caseStockWindow: () => Promise.resolve({ start: '2019-01-02', end: '2020-02-28' }),
  isTradingDay: () => Promise.resolve(true),
  conceptNames: new Set(['趋势线']),
  replayWidgetCount: () => Promise.resolve(1),
  ...overrides,
})

const annotationMd = (attrs = '', body = '{"d":"2019-05-17","label":"筹码峰","quote":"老师的原话","glossary":["趋势线"]}') =>
  `:::annotation unitId=${UNIT} assetId=${ASSET} code=sz000713 kind=structure atMs=5000 ${attrs}\n${body}\n:::`

test('DSL v2：:::annotation 属性白名单与必填', () => {
  const fail = throwsWith()
  assert.throws(() => checkAttrs('annotation', { unitId: UNIT, assetId: ASSET, code: 'sz000713', kind: 'structure', atMs: '5000', extra: 'x' }, 1, fail), /not allowed/)
  assert.throws(() => checkAttrs('annotation', { assetId: ASSET, code: 'sz000713', kind: 'structure', atMs: '5000' }, 1, fail), /required/)
  assert.throws(() => checkAttrs('annotation', { unitId: UNIT, assetId: ASSET, code: 'sz000713', kind: 'trend', atMs: '5000' }, 1, fail), /must be one of/)
  assert.throws(() => checkAttrs('annotation', { unitId: UNIT, assetId: ASSET, code: '713', kind: 'structure', atMs: '5000' }, 1, fail), /invalid/)
  assert.throws(() => checkAttrs('annotation', { unitId: UNIT, assetId: ASSET, code: 'sz000713', kind: 'structure', atMs: '99999999' }, 1, fail), /integer between/)
  checkAttrs('annotation', { unitId: UNIT, assetId: ASSET, code: 'sz000713', kind: 'structure', atMs: '5000' }, 1, fail)
})

test('DSL v2：:::annotation body 形状（无 decision 字段）+ :::replay 属性', () => {
  const fail = throwsWith()
  const body = parseBody('annotation', ['{"d":"2019-05-17","label":"l","quote":"q","glossary":[]}'], fail)
  assert.equal(body.d, '2019-05-17')
  assert.equal(body.decision, undefined)
  assert.throws(() => parseBody('annotation', ['{"d":"2019-05-17","label":"l","quote":"q"}'], fail), /invalid/)
  assert.throws(() => parseBody('annotation', ['{"d":"2019/05/17","label":"l","quote":"q","glossary":[]}'], fail), /invalid/)
  assert.throws(() => parseBody('annotation', ['{"d":"2019-05-17","label":"l","quote":"q","glossary":' + JSON.stringify(Array.from({ length: 9 }, (_, i) => `t${i}`)) + '}'], fail), /invalid/)
  assert.throws(() => parseBody('replay', ['x'], fail), /must be empty/)
  assert.throws(() => checkAttrs('replay', { code: 'sz000713' }, 1, fail), /required/)
  checkAttrs('replay', { code: 'sz000713', caption: '逐根回放' }, 1, fail)
})

test('DSL v2：annotation grounded 失败码逐项', async () => {
  const cases = [
    ['annotation_not_grounded', v2Ctx({ units: new Map() })],
    ['annotation_not_grounded', v2Ctx({ assetExists: () => Promise.resolve(false) })],
    ['annotation_not_grounded', v2Ctx({ units: new Map([[UNIT, { assetId: 'asset_ffffffffffffffff', startMs: 0, endMs: 10 }]]) })],
    ['annotation_not_grounded', v2Ctx({ units: new Map([[UNIT, { assetId: ASSET, startMs: 0, endMs: 100 }]]) })],
    ['stock_not_in_list', v2Ctx({ stockInSection: () => Promise.resolve(false) })],
    ['annotation_date_out_of_window', v2Ctx({ caseStockWindow: () => Promise.resolve({ start: '2021-01-01', end: '2021-12-31' }) })],
    ['annotation_date_not_trading_day', v2Ctx({ isTradingDay: () => Promise.resolve(false) })],
    ['annotation_term_unknown', v2Ctx({ conceptNames: new Set(['其他概念']) })],
  ]
  for (const [expected, ctx] of cases) {
    const sink = V2_SINK()
    const parsed = parseArticleDsl(annotationMd(), sink)
    await assert.rejects(
      () => validateArticleDsl(parsed, ctx, sink),
      (error) => {
        assert.equal(sink.hits[0][1], expected)
        return true
      },
    )
  }
})

test('DSL v2：annotation 合法通过，术语与交易日均命中', async () => {
  const sink = V2_SINK()
  const parsed = parseArticleDsl(annotationMd(), sink)
  await validateArticleDsl(parsed, v2Ctx(), sink)
  assert.equal(sink.hits.length, 0)
})

test('DSL v2：annotation 配额超限走 409 通道', async () => {
  const sink = V2_SINK()
  const many = Array.from({ length: 13 }, () => annotationMd()).join('\n\n')
  const parsed = parseArticleDsl(many, sink)
  await assert.rejects(() => validateArticleDsl(parsed, v2Ctx(), sink), /annotation_quota_exceeded/)
  assert.deepEqual(sink.hits[0], ['conflict', 'annotation_quota_exceeded'])
})

test('DSL v2：:::replay 按 code 解析唯一回放课件', async () => {
  const sink = V2_SINK()
  const md = ':::replay code=sz000713 caption=逐根回放\n:::'
  const parsed = parseArticleDsl(md, sink)
  await assert.rejects(() => validateArticleDsl(parsed, v2Ctx({ replayWidgetCount: () => Promise.resolve(0) }), sink), /replay_widget_unknown/)
  assert.deepEqual(sink.hits[0], ['coded', 'replay_widget_unknown'])

  const ambiguous = V2_SINK()
  const parsed2 = parseArticleDsl(md, ambiguous)
  await assert.rejects(() => validateArticleDsl(parsed2, v2Ctx({ replayWidgetCount: () => Promise.resolve(2) }), ambiguous), /replay_widget_ambiguous/)
  assert.deepEqual(ambiguous.hits[0], ['coded', 'replay_widget_ambiguous'])

  const ok = V2_SINK()
  await validateArticleDsl(parseArticleDsl(md, ok), v2Ctx(), ok)
  assert.equal(ok.hits.length, 0)
})

test('DSL v2：replay 配额超限走 409 通道', async () => {
  const sink = V2_SINK()
  const many = ':::replay code=sz000713 caption=a\n:::\n\n:::replay code=sz000713 caption=b\n:::\n\n:::replay code=sz000713 caption=c\n:::'
  const parsed = parseArticleDsl(many, sink)
  await assert.rejects(() => validateArticleDsl(parsed, v2Ctx(), sink), /replay_quota_exceeded/)
  assert.deepEqual(sink.hits[0], ['conflict', 'replay_quota_exceeded'])
})

test('DSL v2：宿主缺少 v2 能力时明确失败（不静默放过）', async () => {
  const sink = V2_SINK()
  const parsed = parseArticleDsl(annotationMd(), sink)
  const ctx = v2Ctx()
  delete ctx.isTradingDay
  await assert.rejects(() => validateArticleDsl(parsed, ctx, sink), /host does not support/)
})

test('DSL v2：正文版本按用到的组件取最大值', () => {
  assert.equal(dslVersionOf(['board', 'figure']), 1)
  assert.equal(dslVersionOf(['board', 'annotation']), 2)
  assert.equal(dslVersionOf(['replay']), 2)
  assert.equal(dslVersionOf([]), 1)
})

test('DSL v3：新增三块与 warn 变体，正文版本升到 3', () => {
  assert.equal(dslVersionOf(['think', 'sidenote', 'cards']), 3)
  assert.equal(dslVersionOf(['board', 'think']), 3)
  assert.equal(dslVersionOf(['warn']), 2)
  assert.equal(DSL_VERSION, 3)
})

test('DSL v3：:::think / :::sidenote / :::cards 属性与 body 形状', () => {
  const fail = throwsWith()
  checkAttrs('think', { title: '先想一想' }, 1, fail)
  assert.throws(() => checkAttrs('think', {}, 1, fail), /required/)
  assert.throws(() => checkAttrs('think', { title: 'x', extra: 'y' }, 1, fail), /not allowed/)

  checkAttrs('sidenote', { title: '阻尼运动', src: '原片 08:42' }, 1, fail)
  checkAttrs('sidenote', { unitId: UNIT }, 1, fail)
  assert.throws(() => checkAttrs('sidenote', { unitId: 'bad' }, 1, fail), /invalid/)

  const cards = parseBody('cards', ['{"items":[{"num":"01","title":"能说清趋势的定义","desc":"用自己的话复述"}]}'], fail)
  assert.equal(cards.items[0].num, '01')
  assert.throws(() => parseBody('cards', ['{"items":[]}'], fail), /invalid/)
  assert.throws(() => parseBody('cards', ['{"items":[{"title":"x","unknown":1}]}'], fail), /invalid/)
})

test('DSL v3：:::warn variant 只接受四型', () => {
  const fail = throwsWith()
  checkAttrs('warn', { title: '风险提示' }, 1, fail)
  checkAttrs('warn', { title: '定义', variant: 'def' }, 1, fail)
  checkAttrs('warn', { title: '定位', variant: 'rule' }, 1, fail)
  checkAttrs('warn', { title: '误用', variant: 'misuse' }, 1, fail)
  checkAttrs('warn', { title: '风险', variant: 'risk' }, 1, fail)
  assert.throws(() => checkAttrs('warn', { title: 'x', variant: 'info' }, 1, fail), /must be one of/)
})

test('DSL v3：think/sidenote/cards 配额超限走 409 通道', async () => {
  const sink = V2_SINK()
  const manyThink = Array.from({ length: 4 }, (_, i) => `:::think title=想${i}\n内容\n:::`).join('\n\n')
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(manyThink, sink), v2Ctx(), sink),
    /think_quota_exceeded/,
  )
  assert.deepEqual(sink.hits[0], ['conflict', 'think_quota_exceeded'])

  const noteSink = V2_SINK()
  const manyNotes = Array.from({ length: 9 }, (_, i) => `:::sidenote title=注${i}\n内容\n:::`).join('\n\n')
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(manyNotes, noteSink), v2Ctx(), noteSink),
    /sidenote_quota_exceeded/,
  )

  const cardsSink = V2_SINK()
  const manyCards = Array.from({ length: 3 }, (_, i) => `:::cards\n{"items":[{"title":"卡${i}"}]}\n:::`).join('\n\n')
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(manyCards, cardsSink), v2Ctx(), cardsSink),
    /cards_quota_exceeded/,
  )
})

test('DSL v3：sidenote 的 unitId 必须落在课程语料内', async () => {
  const sink = V2_SINK()
  const md = `:::sidenote title=术语 unitId=${UNIT}\n术语解释\n:::`
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(md, sink), v2Ctx({ units: new Map() }), sink),
    /unit_ref_unknown/,
  )
})

test('M10 v3：image-juxtaposition spec 形状与必带断言', () => {
  const spec = {
    left: { figureId: 'fig_abc123' },
    right: { generator: 'uptrend', seed: 7, bars: 60 },
    labels: { left: '正确：结构破坏后先证伪', right: '误判：把反弹当趋势延续' },
    captions: { left: '老师标注：高点抬高', right: '学员误判：追涨' },
    citations: [UNIT],
  }
  assert.equal(imageJuxtapositionSpec.safeParse(spec).success, true)
  assert.equal(imageJuxtapositionSpec.safeParse({ ...spec, left: { generator: 'uptrend' } }).success, false)
  assert.equal(imageJuxtapositionSpec.safeParse({ ...spec, extra: 1 }).success, false)
  assert.equal(imageJuxtapositionSpec.safeParse({ ...spec, citations: [] }).success, false)
  assert.deepEqual([...IMAGE_JUXTAPOSITION_ASSERTIONS], ['pairSidesValid', 'captionsGrounded'])
})

test('M10 v3：branching-scenario spec 形状与必带断言', () => {
  const spec = {
    scenario: '一根大阳线之后，你怎么判断？',
    entryId: 'n1',
    nodes: [
      { id: 'n1', prompt: '先做什么？', options: [
        { label: '看结构', next: 'n2', feedback: '方向优先' },
        { label: '看指标', next: 'n3', feedback: '指标是结果不是原因' },
      ] },
      { id: 'n2', prompt: '结构成立吗？' },
      { id: 'n3', prompt: '回到起点。' },
    ],
    optimalPath: ['n1', 'n2'],
    citations: [UNIT],
  }
  assert.equal(branchingScenarioSpec.safeParse(spec).success, true)
  assert.equal(branchingScenarioSpec.safeParse({ ...spec, nodes: [] }).success, false)
  assert.equal(branchingScenarioSpec.safeParse({ ...spec, optimalPath: [] }).success, false)
  assert.deepEqual([...BRANCHING_SCENARIO_ASSERTIONS], [
    'graphAcyclic',
    'allPathsTerminate',
    'optimalPathReachable',
    'feedbackNonEmpty',
  ])
})

test('DSL v2：bar-replay-decision spec 形状与必带断言', () => {
  const spec = {
    code: 'sz000713',
    window: { from: '2019-05-01', to: '2019-06-30' },
    overlays: ['M60'],
    annotations: [{ unitId: UNIT, atMs: 5000, kind: 'structure', d: '2019-05-17', label: '筹码峰' }],
    decisions: [{
      atDate: '2019-05-17',
      question: '此处结构发生了什么？',
      options: [{ label: 'A' }, { label: 'B' }],
      correct: 0,
      revealText: '老师的原话与推理',
      unitId: UNIT,
      atMs: 5000,
    }],
    citations: [UNIT],
  }
  assert.equal(barReplayDecisionSpec.safeParse(spec).success, true)
  // bars 不入 spec（行情由宿主取得）
  assert.equal(barReplayDecisionSpec.safeParse({ ...spec, bars: [] }).success, false)
  // 单选答案越界
  assert.equal(barReplayDecisionSpec.safeParse({
    ...spec,
    decisions: [{ ...spec.decisions[0], correct: 5 }],
  }).success, false)
  // 判断点至少一条
  assert.equal(barReplayDecisionSpec.safeParse({ ...spec, decisions: [] }).success, false)
  // 叠加常量只认 M60
  assert.equal(barReplayDecisionSpec.safeParse({ ...spec, overlays: ['MA20'] }).success, false)
  assert.deepEqual([...BAR_REPLAY_DECISION_ASSERTIONS], [
    'decisionPointsGrounded', 'revealMonotonic', 'annotationTermsGrounded', 'answerUnique',
  ])
})

test('素材入库：建素材/直传凭据/确认/入队的形状与非法值拒绝', () => {
  assert.equal(mediaAssetCreateInput.safeParse({ courseId: 'TC-ZONGLUN', title: '第1讲' }).success, true)
  assert.equal(mediaAssetCreateInput.safeParse({ courseId: 'TC-ZONGLUN', title: '  ' }).success, false)
  assert.equal(mediaAssetCreateInput.safeParse({ courseId: 'TC-ZONGLUN' }).success, false)

  const ticket = {
    assetId: ASSET,
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
  }
  assert.equal(uploadTicketInput.safeParse(ticket).success, true)
  // 摘要必须 64 位小写 hex
  assert.equal(uploadTicketInput.safeParse({ ...ticket, sha256: 'A'.repeat(64) }).success, false)
  assert.equal(uploadTicketInput.safeParse({ ...ticket, sha256: 'a'.repeat(63) }).success, false)
  // 字节数必须正整数
  assert.equal(uploadTicketInput.safeParse({ ...ticket, sizeBytes: 0 }).success, false)

  assert.equal(uploadConfirmInput.safeParse(ticket).success, true)
  assert.equal(uploadConfirmInput.safeParse({ ...ticket, assetId: 'asset_x' }).success, false)

  assert.equal(assetIngestInput.safeParse({ assetId: ASSET }).success, true)
  assert.equal(assetIngestInput.safeParse({ assetId: ASSET, language: 'zh' }).success, true)
  assert.equal(assetIngestInput.safeParse({ assetId: ASSET, language: 'jp' }).success, false)

  // 直传凭据固定为 PUT
  assert.equal(uploadTicketOutput.safeParse({
    assetId: ASSET,
    uploadUrl: 'http://cloud/v1/admin/content/media-assets/x/source?expires=1&sig=2',
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    expiresAt: 1,
  }).success, true)
  assert.equal(uploadTicketOutput.safeParse({
    assetId: ASSET,
    uploadUrl: 'http://cloud/x',
    method: 'POST',
    headers: {},
    expiresAt: 1,
  }).success, false)
})

test('生产任务：9 步顺序固定、标签齐备、任务与看板形状', () => {
  assert.deepEqual([...PRODUCTION_STEPS], [
    'case_stocks', 'quotes_sync', 'quotes_read', 'figures', 'replay_widget',
    'article', 'widgets', 'review', 'provenance',
  ])
  for (const step of PRODUCTION_STEPS) {
    assert.equal(typeof PRODUCTION_STEP_LABELS[step], 'string')
    assert.ok(PRODUCTION_STEP_LABELS[step].length > 0)
  }

  const upsert = {
    courseId: 'TC-ZONGLUN',
    sectionId: SECTION,
    step: 'case_stocks',
    status: 'done',
  }
  assert.equal(productionTaskUpsertInput.safeParse(upsert).success, true)
  assert.equal(productionTaskUpsertInput.safeParse({ ...upsert, step: 'unknown' }).success, false)
  assert.equal(productionTaskUpsertInput.safeParse({ ...upsert, status: 'archived' }).success, false)
  assert.equal(productionTaskUpsertInput.safeParse({ ...upsert, maxAttempts: 0 }).success, false)

  assert.equal(productionTaskListInput.safeParse({ courseId: 'TC-ZONGLUN' }).success, true)
  assert.equal(productionTaskListInput.safeParse({ courseId: 'TC-ZONGLUN', sectionId: SECTION }).success, true)
  assert.equal(productionTaskListInput.safeParse({ courseId: 'TC-ZONGLUN', sectionId: 'bad' }).success, false)

  const board = productionBoardOutput.safeParse({
    courseId: 'TC-ZONGLUN',
    courseTitle: '趋势交易体系·总论卷',
    sections: [{
      sectionId: SECTION,
      chapterId: 'ch_1',
      title: '总论 1',
      position: 1,
      steps: [{
        taskId: 'pt_0123456789abcdef',
        courseId: 'TC-ZONGLUN',
        sectionId: SECTION,
        step: 'article',
        status: 'done',
        attempt: 1,
        maxAttempts: 3,
        note: null,
        updatedAt: 0,
      }],
      articleVersion: 7,
      widgetCount: 5,
      figureCount: 3,
      caseStockCount: 3,
      reviewVerdict: 'approve',
    }],
  })
  assert.equal(board.success, true)
  assert.equal(productionBoardOutput.safeParse({
    courseId: 'TC-ZONGLUN',
    courseTitle: 'x',
    sections: [{
      sectionId: SECTION, chapterId: 'ch_1', title: 't', position: 1, steps: [],
      articleVersion: null, widgetCount: 0, figureCount: 0, caseStockCount: 0,
      reviewVerdict: 'pending',
    }],
  }).success, false)
})
