import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  figureWriteInput, firstIssueDetail, sourceUnitsWriteInput, widgetWriteInput,
  caseStocksWriteInput, checkAttrs, parseBody, sectionArticleWriteInput,
  parseArticleDsl, validateArticleDsl, sourceUnitsReadInput, approvalsWriteInput,
  quotesSyncInput, quotesSyncOutput, quotesItem, quotesListOutput,
  catalogSectionSummary, catalogSectionOutput, catalogPlaybackOutput,
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
  assert.equal(widgetWriteInput.safeParse({ ...base, type: 'mcq-quiz', specVersion: 2 }).success, false)
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
    bad: throwsWith(), coded: throwsWith(),
  })
  assert.equal(parsed.unitAnchors.length, 1)
  assert.equal(parsed.unitAnchors[0].unitId, 'su_0123456789abcdef')
  assert.equal(parsed.unitAnchors[0].label, '平台定义')
})

test('validateArticleDsl：unit 锚不在课程 → unit_anchor_unknown', async () => {
  const parsed = parseArticleDsl('证据见 [[unit:su_ffffffffffffffff|他课证据]]。', {
    bad: throwsWith(), coded: throwsWith(),
  })
  let code = null
  await validateArticleDsl(parsed, {
    sectionFigureIds: new Set(),
    units: new Map(),
    courseUnitIds: new Set([UNIT]),
    clipGrounded: () => Promise.resolve(true),
    stockInSection: () => Promise.resolve(true),
  }, { bad: throwsWith(), coded: (c) => { code = c } })
  assert.equal(code, 'unit_anchor_unknown')
})

test('validateArticleDsl：unit 锚在课程内通过', async () => {
  const parsed = parseArticleDsl('证据见 [[unit:su_0123456789abcdef|平台定义]]。', {
    bad: throwsWith(), coded: throwsWith(),
  })
  await validateArticleDsl(parsed, {
    sectionFigureIds: new Set(),
    units: new Map(),
    courseUnitIds: new Set([UNIT]),
    clipGrounded: () => Promise.resolve(true),
    stockInSection: () => Promise.resolve(true),
  }, { bad: throwsWith(), coded: (c) => { throw new Error(c) } })
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
