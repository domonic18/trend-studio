import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewProve } from '../lib/engine.js'

const spec = {
  type: 'bar-replay-decision',
  code: 'sz002079',
  window: { from: '2025-08-18', to: '2025-10-10' },
  overlays: ['M60'],
  citations: ['su_1'],
  decisions: [
    { atDate: '2025-09-10', question: '量能说明什么？', options: [{ label: 'A' }, { label: 'B' }], correct: 1, revealText: '缩量', unitId: 'su_1', atMs: 600000 },
    { atDate: '2025-09-24', question: '放量向上怎么处理？', options: [{ label: 'A' }], correct: 0, revealText: '顺势', unitId: 'su_2', atMs: 870000 },
  ],
  annotations: [
    { unitId: 'su_3', atMs: 700000, kind: 'structure', d: '2025-09-25', label: '趋势启动' },
    { unitId: 'su_4', atMs: 1300000, kind: 'structure', d: '2025-09-30', label: '上升通道' },
  ],
}

const assertions = {
  answerUnique: true,
  revealMonotonic: true,
  decisionPointsGrounded: true,
  annotationTermsGrounded: true,
}

test('bar-replay-decision 预览证明：无顶层 options 也不崩溃', () => {
  const proof = previewProve('bar-replay-decision', spec, assertions)
  assert.equal(proof.validation.answerUnique, 'pass')
  assert.equal(proof.validation.revealMonotonic, 'pass')
  assert.deepEqual(proof.failed, [])
})

test('bar-replay-decision 预览证明：correct 越界判失败', () => {
  const broken = { ...spec, decisions: [{ ...spec.decisions[0], correct: 5 }] }
  const proof = previewProve('bar-replay-decision', broken, assertions)
  assert.equal(proof.validation.answerUnique, 'fail')
  assert.ok(proof.failed.includes('answerUnique'))
})

test('bar-replay-decision 预览证明：揭晓顺序倒挂判失败', () => {
  const broken = {
    ...spec,
    annotations: [
      { unitId: 'su_3', atMs: 700000, kind: 'structure', d: '2025-09-01', label: '趋势启动' },
      { unitId: 'su_4', atMs: 1300000, kind: 'structure', d: '2025-09-30', label: '上升通道' },
    ],
  }
  const proof = previewProve('bar-replay-decision', broken, assertions)
  assert.equal(proof.validation.revealMonotonic, 'fail')
})

test('需课程上下文的断言在预览态标记 n/a', () => {
  const proof = previewProve('bar-replay-decision', spec, assertions)
  assert.equal(proof.validation.decisionPointsGrounded, 'n/a')
  assert.equal(proof.validation.annotationTermsGrounded, 'n/a')
})

test('mcq-quiz 预览证明：options 缺失判失败而非抛错', () => {
  const proof = previewProve('mcq-quiz', { type: 'mcq-quiz' }, { answerUnique: true })
  assert.equal(proof.validation.answerUnique, 'fail')
})
