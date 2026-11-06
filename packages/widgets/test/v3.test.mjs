import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewProve } from '../lib/engine.js'
import { splitArticle } from '../lib/dsl.js'

const juxtaposeSpec = {
  type: 'image-juxtaposition',
  left: { generator: 'range', seed: 7, bars: 60 },
  right: { generator: 'uptrend', seed: 7, bars: 60 },
  labels: { left: '拉升前', right: '拉升后' },
  captions: { left: '阻尼运动的底部结构', right: '趋势启动后的加速段' },
  citations: ['su_1'],
}

const juxtaposeAssertions = {
  pairSidesValid: true,
  captionsGrounded: true,
}

test('image-juxtaposition 预览证明：合成 K 线两侧参数合法判通过', () => {
  const proof = previewProve('image-juxtaposition', juxtaposeSpec, juxtaposeAssertions)
  assert.equal(proof.validation.pairSidesValid, 'pass')
  assert.deepEqual(proof.failed, [])
})

test('image-juxtaposition 预览证明：bars 越界判失败', () => {
  const broken = { ...juxtaposeSpec, right: { generator: 'uptrend', seed: 7, bars: 3 } }
  const proof = previewProve('image-juxtaposition', broken, juxtaposeAssertions)
  assert.equal(proof.validation.pairSidesValid, 'fail')
  assert.ok(proof.failed.includes('pairSidesValid'))
})

test('image-juxtaposition 预览证明：课程画面侧缺上下文标记 n/a', () => {
  const withFigure = {
    ...juxtaposeSpec,
    left: { figureId: 'fig_0000000000000001' },
  }
  const proof = previewProve('image-juxtaposition', withFigure, juxtaposeAssertions)
  assert.equal(proof.validation.pairSidesValid, 'n/a')
  assert.equal(proof.validation.captionsGrounded, 'n/a')
})

const branchSpec = {
  type: 'branching-scenario',
  scenario: '放量长阳之后，你如何判断是趋势启动还是诱多？',
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
  citations: ['su_1'],
}

const branchAssertions = {
  graphAcyclic: true,
  allPathsTerminate: true,
  optimalPathReachable: true,
  feedbackNonEmpty: true,
}

test('branching-scenario 预览证明：合规决策树四条断言全通过', () => {
  const proof = previewProve('branching-scenario', branchSpec, branchAssertions)
  assert.equal(proof.validation.graphAcyclic, 'pass')
  assert.equal(proof.validation.allPathsTerminate, 'pass')
  assert.equal(proof.validation.optimalPathReachable, 'pass')
  assert.equal(proof.validation.feedbackNonEmpty, 'pass')
  assert.deepEqual(proof.failed, [])
})

test('branching-scenario 预览证明：成环判失败', () => {
  const cyclic = {
    ...branchSpec,
    nodes: [
      {
        id: 'n1',
        prompt: '先看什么？',
        options: [
          { label: 'A', next: 'n2', feedback: 'a' },
          { label: 'B', next: 'n2', feedback: 'b' },
        ],
      },
      {
        id: 'n2',
        prompt: '然后呢？',
        options: [
          { label: 'C', next: 'n1', feedback: 'c' },
          { label: 'D', next: 'n1', feedback: 'd' },
        ],
      },
    ],
  }
  const proof = previewProve('branching-scenario', cyclic, branchAssertions)
  assert.equal(proof.validation.graphAcyclic, 'fail')
  assert.equal(proof.validation.allPathsTerminate, 'fail')
})

test('branching-scenario 预览证明：最优路径不可达判失败', () => {
  const broken = { ...branchSpec, optimalPath: ['n1', 'n3'] }
  const proof = previewProve('branching-scenario', broken, branchAssertions)
  assert.equal(proof.validation.optimalPathReachable, 'fail')
})

test('branching-scenario 预览证明：反馈为空判失败', () => {
  const broken = {
    ...branchSpec,
    nodes: [
      {
        id: 'n1',
        prompt: '先看什么？',
        options: [
          { label: 'A', next: 'n3', feedback: '' },
          { label: 'B', next: 'n3', feedback: 'b' },
        ],
      },
      { id: 'n3', prompt: '结论。' },
    ],
  }
  const proof = previewProve('branching-scenario', broken, branchAssertions)
  assert.equal(proof.validation.feedbackNonEmpty, 'fail')
})

test('DSL 切分：v3 三块被识别为容器块', () => {
  const markdown = [
    ':::think title="先想一想"',
    '这根长阳是启动还是诱多？',
    ':::',
    '',
    ':::sidenote title="阻尼运动" src="课程第 3 节"',
    '价格围绕均线往复运动。',
    ':::',
    '',
    ':::cards',
    '{"items":[{"num":"01","title":"量能","desc":"先看量能是否放大。"}]}',
    ':::',
  ].join('\n')

  const segments = splitArticle(markdown)
  assert.deepEqual(segments.map(s => s.kind), ['block', 'block', 'block'])
  assert.deepEqual(
    segments.map(s => (s.kind === 'block' ? s.directive : '')),
    ['think', 'sidenote', 'cards'],
  )
  assert.equal(segments[0]?.kind === 'block' ? segments[0].attrs.title : '', '先想一想')
  assert.equal(segments[1]?.kind === 'block' ? segments[1].attrs.src : '', '课程第 3 节')
})
