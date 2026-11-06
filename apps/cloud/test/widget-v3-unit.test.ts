import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proveWidget } from '../src/production/widgets/provers.js'
import { validateAssertions, validateSpec } from '../src/production/widgets/schema.js'

const UNIT = 'su_0123456789abcdef'

test('image-juxtaposition：spec 接受 figureId 侧与合成 K 线侧，断言在真实上下文下全过', () => {
  const spec = validateSpec('image-juxtaposition', {
    left: { figureId: 'fig_00112233445566aa' },
    right: { generator: 'uptrend', seed: 42, bars: 60 },
    labels: { left: '整理前筹码', right: '整理后筹码' },
    captions: { left: '阻尼运动前的密集区', right: '阻尼运动后的集中区' },
    citations: [UNIT],
  })
  const assertions = validateAssertions('image-juxtaposition', {
    pairSidesValid: true,
    captionsGrounded: true,
  })
  const ctx = {
    conceptNames: new Set(['阻尼运动']),
    figureIds: new Set(['fig_00112233445566aa']),
  }
  const proved = proveWidget('image-juxtaposition', spec, assertions, ctx)
  assert.equal(proved.ok, true, proved.ok ? '' : proved.failed.join(','))
})

test('image-juxtaposition：figureId 不在本节图示集 / 标注术语不在 concepts 时证明失败', () => {
  const spec = validateSpec('image-juxtaposition', {
    left: { figureId: 'fig_00112233445566aa' },
    right: { figureId: 'fig_00112233445566bb' },
    labels: { left: '整理前筹码', right: '整理后筹码' },
    captions: { left: '阻尼运动前的密集区', right: '阻尼运动后的集中区' },
    citations: [UNIT],
  })
  const assertions = validateAssertions('image-juxtaposition', {
    pairSidesValid: true,
    captionsGrounded: true,
  })
  const missingFigure = proveWidget('image-juxtaposition', spec, assertions, {
    conceptNames: new Set(['阻尼运动']),
    figureIds: new Set(['fig_00112233445566aa']),
  })
  assert.deepEqual(missingFigure.ok === false ? missingFigure.failed : [], ['pairSidesValid'])

  const unknownTerm = proveWidget('image-juxtaposition', spec, assertions, {
    conceptNames: new Set(['均线多头排列']),
    figureIds: new Set(['fig_00112233445566aa', 'fig_00112233445566bb']),
  })
  assert.deepEqual(unknownTerm.ok === false ? unknownTerm.failed : [], ['captionsGrounded'])
})

test('image-juxtaposition：spec 拒绝未知字段、非法 citations 与混合形态的一侧', () => {
  assert.throws(() => validateSpec('image-juxtaposition', {
    left: { figureId: 'fig_00112233445566aa' },
    right: { generator: 'uptrend', seed: 42, bars: 60 },
    labels: { left: '左', right: '右' },
    captions: { left: '左', right: '右' },
    citations: [UNIT],
    zoom: 2,
  }))
  assert.throws(() => validateSpec('image-juxtaposition', {
    left: { figureId: 'fig_00112233445566aa' },
    right: { figureId: 'fig_00112233445566bb' },
    labels: { left: '左', right: '右' },
    captions: { left: '左', right: '右' },
    citations: ['not-a-unit-id'],
  }))
  assert.throws(() => validateSpec('image-juxtaposition', {
    left: { figureId: 'fig_00112233445566aa', generator: 'uptrend' },
    right: { figureId: 'fig_00112233445566bb' },
    labels: { left: '左', right: '右' },
    captions: { left: '左', right: '右' },
    citations: [UNIT],
  }))
})

const branchingSpec = {
  scenario: '一根放量长阳之后，你如何判断是趋势启动还是诱多？',
  entryId: 'n1',
  nodes: [
    {
      id: 'n1',
      prompt: '先看什么？',
      options: [
        { label: '看量能', next: 'n2', feedback: '量能是阻尼运动启动的第一信号。' },
        { label: '看均线', next: 'n2', feedback: '均线方向只能佐证，不能定根。' },
      ],
    },
    {
      id: 'n2',
      prompt: '然后呢？',
      options: [
        { label: '看回踩', next: 'n3', feedback: '回踩不破前高才是有效确认。' },
        { label: '看缩量', next: 'n3', feedback: '缩量回踩同样指向阻尼运动末端。' },
      ],
    },
    { id: 'n3', prompt: '结论：趋势启动。' },
  ],
  optimalPath: ['n1', 'n2', 'n3'],
  citations: [UNIT],
}

test('branching-scenario：spec 校验通过，四条断言全过', () => {
  const spec = validateSpec('branching-scenario', branchingSpec)
  const assertions = validateAssertions('branching-scenario', {
    graphAcyclic: true,
    allPathsTerminate: true,
    optimalPathReachable: true,
    feedbackNonEmpty: true,
  })
  const proved = proveWidget('branching-scenario', spec, assertions, { conceptNames: new Set(['阻尼运动']) })
  assert.equal(proved.ok, true, proved.ok ? '' : proved.failed.join(','))
})

test('branching-scenario：成环 / 悬空后继 / 最优路径不可达时证明失败', () => {
  const assertions = validateAssertions('branching-scenario', {
    graphAcyclic: true,
    allPathsTerminate: true,
    optimalPathReachable: true,
    feedbackNonEmpty: true,
  })
  const cyclic = validateSpec('branching-scenario', {
    ...branchingSpec,
    nodes: [
      {
        id: 'n1',
        prompt: 'p',
        options: [
          { label: 'a', next: 'n2', feedback: 'f' },
          { label: 'b', next: 'n2', feedback: 'f' },
        ],
      },
      {
        id: 'n2',
        prompt: 'p',
        options: [
          { label: 'c', next: 'n1', feedback: 'f' },
          { label: 'd', next: 'n1', feedback: 'f' },
        ],
      },
    ],
    optimalPath: ['n1', 'n2'],
  })
  const cyclicProof = proveWidget('branching-scenario', cyclic, assertions, { conceptNames: new Set() })
  assert.deepEqual(cyclicProof.ok === false ? cyclicProof.failed : [], ['graphAcyclic', 'allPathsTerminate'])

  const unreachable = validateSpec('branching-scenario', {
    ...branchingSpec,
    optimalPath: ['n2', 'n3'],
  })
  const unreachableProof = proveWidget('branching-scenario', unreachable, assertions, { conceptNames: new Set() })
  assert.deepEqual(unreachableProof.ok === false ? unreachableProof.failed : [], ['optimalPathReachable'])
})

test('branching-scenario：spec 拒绝重复 id、未知 entryId 与悬空 next', () => {
  assert.throws(() => validateSpec('branching-scenario', {
    ...branchingSpec,
    nodes: [
      { id: 'n1', prompt: 'p' },
      { id: 'n1', prompt: 'p' },
    ],
    optimalPath: ['n1'],
  }))
  assert.throws(() => validateSpec('branching-scenario', { ...branchingSpec, entryId: 'nope' }))
  assert.throws(() => validateSpec('branching-scenario', {
    ...branchingSpec,
    nodes: [
      {
        id: 'n1',
        prompt: 'p',
        options: [
          { label: 'a', next: 'n9', feedback: 'f' },
          { label: 'b', next: 'n3', feedback: 'f' },
        ],
      },
      { id: 'n3', prompt: 'p' },
    ],
    optimalPath: ['n1'],
  }))
})
