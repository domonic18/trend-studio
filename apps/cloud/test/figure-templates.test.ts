import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderTemplate, TEMPLATE_NAMES } from '../src/production/figures/templates/index.js'

const CASES: { template: string; params: unknown }[] = [
  {
    template: 'chip-contrast',
    params: {
      title: '密集峰 vs 发散峰',
      left: { head: '密集', peakPrice: '8.68', peakWidthPct: 62, dispersionPct: 18, note: '获利盘集中，支撑明确' },
      right: { head: '发散', peakPrice: '12.40', peakWidthPct: 31, dispersionPct: 74 },
    },
  },
  {
    template: 'chip-horizontal',
    params: {
      title: '三峰价位示意',
      peaks: [
        { label: '主峰（套牢区）', price: '9.20', weightPct: 78 },
        { label: '次峰（获利区）', price: '7.65', weightPct: 45 },
        { label: '远端峰', price: '11.80', weightPct: 12 },
      ],
    },
  },
  {
    template: 'timeline',
    params: {
      events: [
        { date: '2019-05-17', title: '峰位确认', desc: '放量触及峰位' },
        { date: '2019-06-03', title: '缩量回踩' },
        { date: '2019-07-11', title: '趋势延续', desc: '峰形未破' },
        { date: '2019-09-02', title: '二次密集' },
      ],
    },
  },
  {
    template: 'stat-inline',
    params: {
      label: '峰位价位',
      value: '8.68',
      unit: '元',
      note: '2019-05-17 前复权收盘',
      spark: { kind: 'line', points: [7.2, 7.8, 8.1, 8.68, 8.4, 8.5] },
    },
  },
]

test('模板白名单 v1：四模板逐字节确定性渲染', () => {
  for (const entry of CASES) {
    const first = renderTemplate(entry.template, entry.params)
    const second = renderTemplate(entry.template, entry.params)
    assert.equal(first.svg, second.svg)
    assert.ok(first.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
    assert.ok(first.svg.endsWith('</svg>'))
    assert.deepEqual([first.width, first.height], [1200, 675])
  }
})

test('XML 转义：标注文本不破坏 SVG 结构', () => {
  const rendered = renderTemplate('timeline', {
    events: [
      { date: '2019-05-17', title: 'a<b & "c"', desc: "it's <script>alert(1)</script>" },
      { date: '2019-06-03', title: '正常' },
      { date: '2019-07-11', title: 'd>e' },
    ],
  })
  assert.ok(!rendered.svg.includes('<script>'))
  assert.ok(rendered.svg.includes('&lt;script&gt;'))
  assert.ok(rendered.svg.includes('&amp;'))
})

test('模板与参数校验：白名单外 400，参数不合法 400', () => {
  assert.throws(() => renderTemplate('mermaid', {}), /not in the frozen whitelist/)
  assert.throws(() => renderTemplate('timeline', { events: [{ date: '2019-5-1', title: 'x' }] }), /params invalid/)
  assert.throws(
    () => renderTemplate('timeline', { events: [
      { date: '2019-05-01', title: 'x' },
      { date: '2019-05-02', title: 'y' },
    ] }),
    /params invalid/,
  )
  assert.throws(() => renderTemplate('stat-inline', { label: 'x', value: '1', spark: { kind: 'pie', points: [1, 2] } }), /params invalid/)
  assert.deepEqual(TEMPLATE_NAMES, ['chip-contrast', 'chip-horizontal', 'timeline', 'stat-inline'])
})
