import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodedHttpError } from '../src/errors.js'
import { parseArticleDsl } from '../src/production/dsl/parse.js'
import { checkAttrs, parseBody } from '../src/production/dsl/schemas.js'
import { validateArticleDsl, type DslValidateCtx } from '../src/production/dsl/validate.js'

const UNIT = 'su_0123456789abcdef'
const FIGURE = 'fig_m10abcdef'
const ASSET = 'asset_0123456789abcdef'

function ctx(overrides: Partial<DslValidateCtx> = {}): DslValidateCtx {
  return {
    sectionFigureIds: new Set([FIGURE]),
    units: new Map([[UNIT, { assetId: ASSET, startMs: 60_000, endMs: 180_000 }]]),
    clipGrounded: async (assetId, fromMs, toMs) =>
      assetId === ASSET && fromMs >= 60_000 && toMs <= 180_000,
    stockInSection: async (exchange, code) => exchange === 'SZSE' && code === '000713',
    ...overrides,
  }
}

test('解析：基本容器块与引号属性', () => {
  const markdown = [
    '段落开头。',
    '',
    `:::board unitId=${UNIT}`,
    '老师原话：趋势线触及三次以上才有效。',
    ':::',
    '',
    `:::warn title="常见误用"`,
    '不要把每一次回调都当成趋势终结。',
    ':::',
  ].join('\n')
  const parsed = parseArticleDsl(markdown)
  assert.equal(parsed.blocks.length, 2)
  assert.equal(parsed.blocks[0]?.directive, 'board')
  assert.deepEqual(parsed.blocks[0]?.attrs, { unitId: UNIT })
  assert.equal(parsed.blocks[1]?.attrs.title, '常见误用')
  assert.equal(parsed.anchors.length, 0)
})

test('解析：未知 directive 400', () => {
  assert.throws(() => parseArticleDsl(':::h5page\nbody\n:::'), /unknown directive 'h5page'/)
})

test('解析：嵌套容器拒绝', () => {
  const markdown = `:::board unitId=${UNIT}\n:::warn title="x"\n:::\n:::`
  assert.throws(() => parseArticleDsl(markdown), /nested container/)
})

test('解析：未闭合与多余闭合拒绝', () => {
  assert.throws(() => parseArticleDsl(`:::board unitId=${UNIT}\nbody`), /not closed/)
  assert.throws(() => parseArticleDsl('正文\n:::'), /unexpected closing/)
})

test('解析：属性残片与重复属性拒绝', () => {
  assert.throws(() => parseArticleDsl(`:::board unitId\n:::`), /malformed attribute/)
  assert.throws(() => parseArticleDsl(`:::board unitId=${UNIT} unitId=${UNIT}\n:::`), /duplicate attribute/)
  assert.throws(() => parseArticleDsl(`:::board unitId="${UNIT}\n:::`), /malformed attribute/)
})

test('解析：个股内联锚在散文中收集，块内不扫', () => {
  const markdown = [
    `看看 [[stock:sz000713|丰乐种业]] 的表现。`,
    '',
    ':::board unitId=' + UNIT,
    '正文里的 [[stock:sh600804|鹏博士]] 不算锚。',
    ':::',
  ].join('\n')
  const parsed = parseArticleDsl(markdown)
  assert.equal(parsed.anchors.length, 1)
  assert.equal(parsed.anchors[0]?.code, 'sz000713')
})

test('schema：未声明属性 400，必填缺失 400', () => {
  assert.throws(
    () => checkAttrs('board', { unitId: UNIT, extra: '1' }, 1),
    /attribute 'extra' is not allowed/,
  )
  assert.throws(() => checkAttrs('clip', { assetId: ASSET, from: '0', to: '10' }, 1), /'caption' is required/)
  assert.throws(() => checkAttrs('cmp', { mode: 'grid' }, 1), /mode/)
})

test('schema：结构化 body zod 逐组件校验', () => {
  assert.deepEqual(
    parseBody('bignum', ['{"items":[{"label":"峰位","value":"8.68","note":"2019-05-17"}]}']),
    { items: [{ label: '峰位', value: '8.68', note: '2019-05-17' }] },
  )
  assert.throws(() => parseBody('bignum', ['{"items":[]}']), /body invalid/)
  assert.throws(() => parseBody('bignum', ['{"items":[{"label":"a","value":"b"}],"x":1}']), /body invalid/)
  assert.throws(() => parseBody('timeline', ['{"events":[{"date":"2019-5-1","title":"x"}]}']), /body invalid/)
  assert.throws(() => parseBody('figure', ['不该有内容']), /body must be empty/)
  assert.throws(() => parseBody('bignum', ['不是 json']), /single JSON object/)
  assert.equal(parseBody('warn', ['警示文本']), '警示文本')
})

test('校验：figure 引用不在本节 figure_ref_unknown', async () => {
  const markdown = `:::figure figureId=fig_unknown caption="配图"\n:::`
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(markdown), ctx()),
    (error: { code?: string }) => error?.code === 'figure_ref_unknown',
  )
})

test('校验：unitId 不存在 unit_ref_unknown', async () => {
  const markdown = `:::board unitId=su_0000000000000000\n原话\n:::`
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(markdown), ctx()),
    (error: { code?: string }) => error?.code === 'unit_ref_unknown',
  )
})

test('校验：clip 窗与 grounded', async () => {
  const clip = (from: number, to: number) =>
    `:::clip assetId=${ASSET} from=${from} to=${to} caption="片段" unitId=${UNIT}\n:::`
  // 完整落 unit（60s–180s）内且窗 ≤60s
  await validateArticleDsl(parseArticleDsl(clip(70, 100)), ctx())
  // 窗超 60s
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(clip(70, 200)), ctx()),
    (error: { code?: string }) => error?.code === 'clip_not_grounded',
  )
  // 窗未完整落 unit
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(clip(0, 30)), ctx()),
    (error: { code?: string }) => error?.code === 'clip_not_grounded',
  )
  // 每节超 3 个
  const fourClips = [clip(70, 80), clip(90, 100), clip(110, 120), clip(130, 140)].join('\n')
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl(fourClips), ctx()),
    (error: { code?: string }) => error?.code === 'clip_not_grounded',
  )
})

test('校验：个股锚格式', async () => {
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl('锚 [[stock:000713|丰乐]] 格式错'), ctx()),
    /anchor code '000713' invalid/,
  )
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl('锚 [[stock:sz000713|]] 空 label'), ctx()),
    /label must be 1–20/,
  )
  await validateArticleDsl(parseArticleDsl('锚 [[stock:sz000713|丰乐种业]] 合法'), ctx())
})

test('校验：个股锚必须在本节清单内（R2）', async () => {
  await assert.rejects(
    () => validateArticleDsl(parseArticleDsl('锚 [[stock:sh600000|浦发银行]] 不在清单'), ctx()),
    (error: unknown) => error instanceof CodedHttpError && error.code === 'stock_not_in_list',
  )
  await validateArticleDsl(parseArticleDsl('锚 [[stock:sz000713|丰乐种业]] 在清单'), ctx())
})

test('校验：无 DSL 的存量纯 Markdown 通过（向后兼容）', async () => {
  await validateArticleDsl(parseArticleDsl('普通正文，含 figure:fig_legacy 图片引用。'), ctx())
})
