import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  figureWriteInput, firstIssueDetail, sourceUnitsWriteInput, widgetWriteInput,
  caseStocksWriteInput, checkAttrs, parseBody, sectionArticleWriteInput,
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
