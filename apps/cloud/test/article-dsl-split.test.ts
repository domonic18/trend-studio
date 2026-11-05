import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rewriteStockAnchors, splitArticle } from '../web/widgets/dsl.js'

test('前端 DSL 切分：markdown 游程与容器块交替', () => {
  const markdown = [
    '开篇导语。',
    '',
    ':::board unitId=su_0000000000000001',
    '峰形三要素。',
    ':::',
    '',
    ':::bignum',
    '{"items":[{"label":"峰位","value":"8.68"}]}',
    ':::',
    '',
    '结尾。',
  ].join('\n')

  const segments = splitArticle(markdown)
  assert.deepEqual(segments.map(s => s.kind), ['markdown', 'block', 'block', 'markdown'])
  assert.equal(segments[0]?.kind === 'markdown' ? segments[0].text.trim() : '', '开篇导语。')
  const board = segments[1]
  assert.ok(board?.kind === 'block' && board.directive === 'board')
  assert.equal(board.attrs.unitId, 'su_0000000000000001')
  assert.deepEqual(board.bodyLines, ['峰形三要素。'])
  const bignum = segments[2]
  assert.ok(bignum?.kind === 'block' && bignum.directive === 'bignum')
  assert.ok(bignum.bodyLines[0]?.startsWith('{"items"'))
})

test('前端 DSL 切分：引号属性、未知 directive 回落、未闭合保真', () => {
  const quoted = splitArticle(':::warn title="风险 提示"\n正文\n:::')
  const warn = quoted[0]
  assert.ok(warn?.kind === 'block' && warn.directive === 'warn')
  assert.equal(warn.attrs.title, '风险 提示')

  const unknown = splitArticle(':::replay code=abc\n内容\n:::')
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0]?.kind, 'markdown')

  const unclosed = splitArticle('前文\n\n:::board unitId=su_x\n未闭合')
  const last = unclosed[unclosed.length - 1]
  assert.ok(last?.kind === 'markdown' && last.text.includes(':::board') && last.text.includes('未闭合'))
})

test('个股锚重写：[[stock:code|label]] → stock-anchor: 链接', () => {
  const rewritten = rewriteStockAnchors('参考 [[stock:sz000651|格力电器]] 走势。')
  assert.equal(rewritten, '参考 [格力电器](stock-anchor:sz000651) 走势。')
  const untouched = rewriteStockAnchors('普通 [链接](https://example.com) 不受影响。')
  assert.equal(untouched, '普通 [链接](https://example.com) 不受影响。')
})
