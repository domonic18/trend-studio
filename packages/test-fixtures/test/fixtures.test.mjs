import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseArticleDsl,
  validateArticleDsl,
  sourceUnitsWriteInput,
  sectionArticleWriteInput,
  caseStocksWriteInput,
  widgetWriteInput,
  figureWriteInput,
} from '@trend/contracts'
import {
  clipFromGteTo, clipNotGrounded, clipSpanTooLong, figureInvalidSecInput,
  sectionCrossUnit, sectionFull, sectionMissingFigure, sectionStockNotInList,
  sectionUnitAnchorUnknown, widgetWrongVersion,
} from '../lib/index.js'

class Rejected extends Error {
  constructor(kind) {
    super(kind)
    this.kind = kind
  }
}

const sink = {
  bad: () => { throw new Error('unexpected bad') },
  coded: (code) => { throw new Rejected(code) },
}

/** 标准判定器：zod 层（写入形状）→ DSL 层（parse + validate），返回命中的拒绝类别。 */
async function judge(fixture) {
  const unitsPayload = fixture.units.map(({ unitId, ...unit }) => unit)
  if (!sourceUnitsWriteInput.safeParse({ units: unitsPayload }).success) return 'schema'
  if (!sectionArticleWriteInput.safeParse({
    sectionId: fixture.sectionId, ...fixture.article,
  }).success) return 'schema'
  if (!caseStocksWriteInput.safeParse({
    sectionId: fixture.sectionId, stocks: fixture.caseStocks,
  }).success) return 'schema'
  for (const widget of fixture.widgets ?? []) {
    if (!widgetWriteInput.safeParse(widget).success) return 'schema'
  }

  const units = new Map(fixture.units.map(unit => [unit.unitId, {
    assetId: unit.assetId, startMs: unit.startMs, endMs: unit.endMs,
  }]))
  try {
    const parsed = parseArticleDsl(fixture.article.markdown, {
      bad: (message) => { throw new Rejected(`schema:${message}`) },
      coded: (code) => { throw new Rejected(code) },
    })
    await validateArticleDsl(parsed, {
      sectionFigureIds: new Set(fixture.figures.map(f => f.figureId)),
      units,
      courseUnitIds: new Set(units.keys()),
      clipGrounded: (assetId, fromMs, toMs) => Promise.resolve(
        [...units.values()].some(unit =>
          unit.assetId === assetId && fromMs >= unit.startMs && toMs <= unit.endMs)),
      stockInSection: (exchange, code) => Promise.resolve(
        fixture.caseStocks.some(stock => stock.exchange === exchange && stock.code === code)),
    }, sink)
  } catch (error) {
    if (error instanceof Rejected) {
      return error.kind.startsWith('schema:') ? 'schema' : error.kind
    }
    throw error
  }
  return 'accept'
}

test('合法全节：七类块 + 锚 + widget 全链通过', async () => {
  assert.equal(await judge(sectionFull), 'accept')
})

test('缺引用：figure_ref_unknown', async () => {
  assert.equal(await judge(sectionMissingFigure), 'figure_ref_unknown')
})

test('跨节引用：unit_ref_unknown', async () => {
  assert.equal(await judge(sectionCrossUnit), 'unit_ref_unknown')
})

test('个股锚不在清单：stock_not_in_list', async () => {
  assert.equal(await judge(sectionStockNotInList), 'stock_not_in_list')
})

test('段落级 unit 锚不在课程：unit_anchor_unknown', async () => {
  assert.equal(await judge(sectionUnitAnchorUnknown), 'unit_anchor_unknown')
})

test('非法媒体：窗超长 / from≥to / 未 grounded 均 clip_not_grounded', async () => {
  assert.equal(await judge(clipSpanTooLong), 'clip_not_grounded')
  assert.equal(await judge(clipFromGteTo), 'clip_not_grounded')
  assert.equal(await judge(clipNotGrounded), 'clip_not_grounded')
})

test('错误版本：widget specVersion=2 schema 拒绝', async () => {
  assert.equal(await judge(widgetWrongVersion), 'schema')
})

test('非法媒体写入：keyframe sec=-1 schema 拒绝', () => {
  assert.equal(figureWriteInput.safeParse(figureInvalidSecInput).success, false)
})
