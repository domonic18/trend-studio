import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  diffUnderstandingTodos,
  normalizeKeyframes,
  planUnderstandingChunks,
} from '../lib/host/orchestrator.js'
import { deepNormalizeTypes } from '../lib/host/tools.js'

function seg(idx, startSec, endSec, text = 'x') {
  return { idx, startMs: startSec * 1000, endMs: endSec * 1000, text }
}

test('分块规划：按段边界聚合，段不跨窗口截断', () => {
  const segments = [
    seg(0, 0, 100),
    seg(1, 100, 200),
    seg(2, 200, 500),
    seg(3, 500, 600),
  ]
  const plans = planUnderstandingChunks(600_000, segments, { chunkMs: 300_000, overlapMs: 30_000 })
  // 规则：段起点越过窗口下界才收口（段不跨窗截断，seg2 起点 200s < 300s 归第一窗）
  assert.equal(plans.length, 2)
  assert.deepEqual(plans[0].segmentIdxs, [0, 1, 2])
  assert.equal(plans[0].endMs, 500_000)
  assert.deepEqual(plans[1].segmentIdxs, [3])
  // 不变量：段恰好出现一次、窗口时序单调
  const all = plans.flatMap(plan => plan.segmentIdxs)
  assert.deepEqual(all, [0, 1, 2, 3])
})

test('分块规划：单段超长窗口独立成块，不丢段', () => {
  const segments = [seg(0, 0, 480), seg(1, 480, 960), seg(2, 960, 1200)]
  const plans = planUnderstandingChunks(1_200_000, segments, { chunkMs: 300_000, overlapMs: 0 })
  const all = plans.flatMap(plan => plan.segmentIdxs)
  assert.deepEqual(all, [0, 1, 2])
})

test('分块规划：空转写不产生窗口', () => {
  assert.deepEqual(planUnderstandingChunks(600_000, []), [])
})

test('断点恢复差集：空窗口重跑，已覆盖窗口跳过', () => {
  const segments = [seg(0, 0, 100), seg(1, 100, 200), seg(2, 200, 500)]
  const plans = planUnderstandingChunks(500_000, segments, { chunkMs: 150_000, overlapMs: 0 })
  const todos = diffUnderstandingTodos({ plans, existingStartMs: [0, 100] })
  assert.equal(todos.length, 1)
  assert.deepEqual(todos[0].segmentIdxs, [2])
})

test('断点恢复差集：部分覆盖整窗重跑（幂等由云端承担）', () => {
  const segments = [seg(0, 0, 100), seg(1, 100, 200)]
  const plans = planUnderstandingChunks(200_000, segments, { chunkMs: 300_000, overlapMs: 0 })
  const todos = diffUnderstandingTodos({ plans, existingStartMs: [0] })
  // 窗口内已有 1 个起点 → covered=1 → 跳过；单元起点覆盖即视为完成
  assert.equal(todos.length, 0)
  const todos2 = diffUnderstandingTodos({ plans, existingStartMs: [] })
  assert.equal(todos2.length, 1)
})

test('keyframes 归一化：裸 sec 与对象形态统一为对象，非法值剔除', () => {
  assert.deepEqual(normalizeKeyframes([800, { sec: 1146 }, 'x', -1]), [{ sec: 800 }, { sec: 1146 }])
  assert.equal(normalizeKeyframes([]), undefined)
  assert.equal(normalizeKeyframes(undefined), undefined)
})

test('deepNormalizeTypes：松散 object 内字符串化的数字/布尔归位', () => {
  const input = {
    spec: {
      data: { seed: '420', bars: '60', ratio: '0.25' },
      assertions: { noBreakBelow: 'true', touch: 'false', slope: ['10', '40'] },
      label: '60日均线',
    },
    model: 'MiniMax-M3.1-Flash',
  }
  const out = deepNormalizeTypes(input)
  assert.deepEqual(out, {
    spec: {
      data: { seed: 420, bars: 60, ratio: 0.25 },
      assertions: { noBreakBelow: true, touch: false, slope: [10, 40] },
      label: '60日均线',
    },
    model: 'MiniMax-M3.1-Flash',
  })
})
