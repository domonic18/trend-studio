import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  conceptEdgeWriteInput,
  parseInput,
  parseOutput,
  pipelineStatusInput,
  provenanceEntry,
  sourceUnitInput,
  sourceUnitsWriteInput,
  widgetWriteInput,
} from '../lib/host/contracts.js'

const validUnit = {
  assetId: 'asset_0123456789abcdef',
  startMs: 0,
  endMs: 420000,
  transcriptText: '起飞平台是趋势延续的中继形态',
  summary: '起飞平台定义',
}

test('source unit 契约：合法样本通过，未知字段拒绝', () => {
  const parsed = sourceUnitInput.parse({ ...validUnit, visual: { description: 'K线图', keyframes: [{ sec: 12 }] } })
  assert.equal(parsed.summary, '起飞平台定义')
  assert.throws(() => sourceUnitInput.parse({ ...validUnit, extra: 1 }), /Unrecognized|无法识别|校验/)
})

test('source unit 契约：endMs 必须大于 startMs，ID 格式受限', () => {
  assert.throws(() => sourceUnitInput.parse({ ...validUnit, endMs: 0 }))
  assert.throws(() => sourceUnitInput.parse({ ...validUnit, assetId: 'as_bad' }))
  assert.throws(() => sourceUnitInput.parse({ ...validUnit, transcriptId: 'tr_short' }))
})

test('批量写入：1–100 条边界', () => {
  assert.throws(() => sourceUnitsWriteInput.parse({ units: [] }))
  const units = Array.from({ length: 100 }, (_, index) => ({ ...validUnit, startMs: index * 1000, endMs: index * 1000 + 500 }))
  assert.equal(sourceUnitsWriteInput.parse({ units }).units.length, 100)
  assert.throws(() => sourceUnitsWriteInput.parse({ units: [...units, validUnit] }))
})

test('依赖边：自环在入参边界即拒绝', () => {
  const edge = {
    courseId: 'T-M9',
    fromConceptId: 'cpt_0123456789abcdef',
    toConceptId: 'cpt_0123456789abcdef',
    kind: 'prerequisite',
  }
  assert.throws(() => conceptEdgeWriteInput.parse(edge))
  assert.equal(conceptEdgeWriteInput.safeParse({ ...edge, toConceptId: 'cpt_fedcba9876543210' }).success, true)
})

test('pipeline 状态：assetId 与 courseId 至少一项', () => {
  assert.throws(() => pipelineStatusInput.parse({}))
  assert.equal(pipelineStatusInput.parse({ assetId: 'asset_0123456789abcdef' }).assetId, 'asset_0123456789abcdef')
})

test('课件提交：specVersion 取 1/2，type 白名单，citations ≥1', () => {
  const base = {
    sectionId: 'sec_0123456789abcdef',
    specVersion: 1,
    spec: { data: { generator: 'uptrend-platform', seed: 42, bars: 60 } },
    assertions: { trendlineTouches: { min: 3 } },
    citations: ['su_0123456789abcdef'],
  }
  assert.equal(widgetWriteInput.parse({ ...base, type: 'kline-annotator' }).type, 'kline-annotator')
  assert.equal(widgetWriteInput.parse({ ...base, type: 'kline-annotator', specVersion: 2 }).specVersion, 2)
  assert.throws(() => widgetWriteInput.parse({ ...base, type: 'free-code-canvas' }))
  assert.throws(() => widgetWriteInput.parse({ ...base, type: 'kline-annotator', specVersion: 3 }))
  assert.throws(() => widgetWriteInput.parse({ ...base, type: 'kline-annotator', citations: [] }))
})

test('溯源：taskKey 仅生产命名空间 8 键', () => {
  const entry = { taskKey: 'content.section_draft', model: 'test-model', status: 'success' }
  assert.equal(provenanceEntry.parse(entry).status, 'success')
  assert.throws(() => provenanceEntry.parse({ ...entry, taskKey: 'content.outline' }))
  assert.throws(() => provenanceEntry.parse({ taskKey: 'content.section_draft', status: 'success' }))
})

test('parseInput/parseOutput：错误消息带字段路径；出参错误独立于入参', () => {
  assert.throws(() => parseInput(sourceUnitInput, { bad: true }, 'units'), /units 校验失败/)
  assert.throws(() => parseOutput(sourceUnitsWriteInput, {}, 'units'), /响应与契约不符/)
})
