import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeFormula, formulaInputsInBounds } from '../src/production/widgets/formulas.js'
import {
  atr,
  classifyShape,
  countTrendlineTouches,
  closesHoldAbove,
  generateCandles,
  trendlineAt,
} from '../src/production/widgets/generators.js'
import { planKeyframeSecs } from '../src/pipeline/keyframes.js'
import { jpegDimensions } from '../src/pipeline/keyframes.js'
import { proveWidget } from '../src/production/widgets/provers.js'
import { validateAssertions, validateSpec } from '../src/production/widgets/schema.js'

const SEEDS = [42, 7, 99, 123, 2024, 555, 777, 888, 999, 31337]

test('K 线合成确定性：同 generator+seed+bars 逐字节一致', () => {
  const a = generateCandles('uptrend-platform', 42, 60)
  const b = generateCandles('uptrend-platform', 42, 60)
  assert.deepEqual(a, b)
  const c = generateCandles('uptrend-platform', 43, 60)
  assert.notDeepEqual(a, c)
})

test('形态归类：五族生成器跨种子全部落入本族', () => {
  const families = ['uptrend', 'downtrend', 'range', 'uptrend-platform', 'downtrend-platform'] as const
  for (const family of families) {
    for (const seed of SEEDS) {
      assert.equal(classifyShape(generateCandles(family, seed, 60)), family, `${family} seed=${seed}`)
    }
  }
})

test('形态归类：短序列与长序列均稳定', () => {
  for (const bars of [20, 40, 90, 120]) {
    assert.equal(classifyShape(generateCandles('uptrend-platform', 42, bars)), 'uptrend-platform')
    assert.equal(classifyShape(generateCandles('downtrend-platform', 7, bars)), 'downtrend-platform')
  }
})

test('趋势线证明：平台族存在同时满足触点/角度/不跌破的锚点', () => {
  const candles = generateCandles('uptrend-platform', 42, 60)
  const line = { startIdx: 1, endIdx: 58 }
  assert.ok(countTrendlineTouches(candles, line) >= 6)
  const angle = trendlineAt(candles, line).angleDeg
  assert.ok(angle >= 10 && angle <= 45, `angle=${angle}`)
  assert.ok(closesHoldAbove(candles, line))
  assert.ok(atr(candles) > 0)
})

test('断言证明：mcq 未知术语失败，已知术语通过', () => {
  const spec = validateSpec('mcq-quiz', {
    question: '哪个是趋势中继？',
    options: [{ id: 'a', label: '起飞平台' }, { id: 'b', label: '阻尼运动' }],
    answerId: 'a',
    conceptRefs: ['起飞平台', '阻尼运动'],
  })
  const assertions = validateAssertions('mcq-quiz', { answerUnique: true, termsInConcepts: true })
  const known = proveWidget('mcq-quiz', spec, assertions, { conceptNames: new Set(['起飞平台', '阻尼运动', '阻尼']) })
  assert.equal(known.ok, true)
  const unknown = proveWidget('mcq-quiz', spec, assertions, { conceptNames: new Set(['阻尼运动']) })
  assert.deepEqual(unknown.ok === false ? unknown.failed : [], ['termsInConcepts'])
})

test('断言证明：calc-trainer 复算错误答案判失败', () => {
  const good = validateSpec('calc-trainer', {
    formula: 'position-size',
    inputs: { capital: 100000, price: 10, riskPct: 1, stopDistancePct: 5 },
    examples: [{ inputs: { capital: 100000, price: 10, riskPct: 1, stopDistancePct: 5 }, answer: 2000 }],
  })
  const assertions = validateAssertions('calc-trainer', { examplesRecomputable: true, paramsInBounds: true })
  assert.equal(proveWidget('calc-trainer', good, assertions, { conceptNames: new Set() }).ok, true)
  assert.equal(computeFormula('position-size', good.inputs!), 2000)
  const bad = validateSpec('calc-trainer', {
    formula: 'risk-reward',
    inputs: { entry: 100, stop: 95, target: 115 },
    examples: [{ inputs: { entry: 100, stop: 95, target: 115 }, answer: 7 }],
  })
  const result = proveWidget('calc-trainer', bad, assertions, { conceptNames: new Set() })
  assert.deepEqual(result.ok === false ? result.failed : [], ['examplesRecomputable'])
  assert.equal(formulaInputsInBounds('risk-reward', { entry: 0, stop: 95, target: 115 }), false)
})

test('关键帧规划：固定网格并吸收邻近场景切点，按上限截断', () => {
  // mergeWindow = floor(15/3) = 5：120.5 距网格 120 为 0.5 → 并入；其余切点远离网格 → 保留
  const planned = planKeyframeSecs({ durationSec: 600, intervalSec: 15, sceneTimes: [7, 15, 22.9, 100, 120.5], maxPerAsset: 2000 })
  assert.ok(planned.includes(7))
  assert.ok(planned.includes(22))
  assert.ok(planned.includes(100))
  assert.ok(planned.includes(120))
  const nearMerge = planKeyframeSecs({ durationSec: 600, intervalSec: 15, sceneTimes: [107, 119], maxPerAsset: 2000 })
  assert.ok(!nearMerge.includes(107))
  assert.ok(!nearMerge.includes(119))
  const capped = planKeyframeSecs({ durationSec: 10_000, intervalSec: 15, sceneTimes: [], maxPerAsset: 10 })
  assert.equal(capped.length, 10)
  assert.deepEqual(capped, [...capped].sort((a, b) => a - b))
})

test('JPEG 尺寸解析：SOI 后首个 SOF 段给出宽高', () => {
  const sof = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14, 1),
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, ...Buffer.alloc(5, 0),
    0xff, 0xd9,
  ])
  assert.deepEqual(jpegDimensions(sof), { width: 1280, height: 720 })
  assert.equal(jpegDimensions(Buffer.from([0xff, 0xd8])), undefined)
})

test('关键帧签名：URL 不重复 media 前缀，校验通过', async () => {
  const { signKeyframeUrl, verifyKeyframeSignature, isKeyframePath } = await import('../src/media/keyframe-sign.js')
  const secret = 'unit-test-secret'
  const relPath = 'asset_0123456789abcdef/keyframes/15.jpg'
  assert.ok(isKeyframePath(relPath))
  const url = signKeyframeUrl(secret, 'http://127.0.0.1:3939/media', relPath, 600)
  assert.match(url, /^http:\/\/127\.0\.0\.1:3939\/media\/keyframes\/asset_0123456789abcdef\/keyframes\/15\.jpg\?/)
  assert.ok(!url.includes('/media/media/'))
  const parsed = new URL(url)
  assert.equal(verifyKeyframeSignature(secret, relPath, parsed.searchParams.get('expires'), parsed.searchParams.get('sig')), true)
  assert.equal(verifyKeyframeSignature(secret, relPath, '1', 'bad'), false)
  assert.equal(isKeyframePath('asset_0123456789abcdef/../etc/passwd'), false)
})

test('语料检索 q 融合：向量分支不外泄未引用占位符（42P18 回归）', async () => {
  const { ProductionService } = await import('../src/production/service.js')
  const queries: { sql: string; values: unknown[] }[] = []
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values })
      return { rows: [] }
    },
  }
  const service = new ProductionService({
    pool: pool as never,
    embedding: { resolve: async () => async () => [0.1, 0.2, 0.3] },
    usage: { recordProducer: async () => ({ runId: 'run_test', usageId: 'usage_test' }) },
    searchMinConfidence: 0.05,
    recallWindow: 50,
  } as never)

  await service.searchSourceUnits({ assetId: 'asset_0123456789abcdef', q: '趋势线', limit: 5 })
  const vectorQuery = queries[queries.length - 1]
  assert.ok(vectorQuery !== undefined)
  const referenced = new Set([...vectorQuery.sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])))
  // 每个占位符都被 SQL 引用：多余参数会让 PG 无法推断类型
  assert.equal(referenced.size, vectorQuery.values.length)
  assert.equal(Math.max(...referenced), vectorQuery.values.length)
})

test('补向量 reindexSourceUnits：未配置 embedding 抛 409', async () => {
  const { ProductionService } = await import('../src/production/service.js')
  const service = new ProductionService({
    pool: { query: async () => ({ rows: [] }) } as never,
    embedding: { resolve: async () => undefined },
    usage: { recordProducer: async () => ({ runId: 'run_test', usageId: 'usage_test' }) },
    searchMinConfidence: 0.05,
    recallWindow: 50,
  } as never)
  await assert.rejects(service.reindexSourceUnits(200), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal((error as { statusCode?: number }).statusCode, 409)
    assert.match(error.message, /embedding provider not configured/)
    return true
  })
})

test('补向量 reindexSourceUnits：limit 分批、失败保持 NULL 可重入', async () => {
  const { ProductionService } = await import('../src/production/service.js')
  const summaries = new Map([
    ['su_0000000000000001', '起飞平台'],
    ['su_0000000000000002', '阻尼运动'],
    ['su_0000000000000003', '趋势线'],
  ])
  const pending = new Set(summaries.keys())
  const embeddedTexts: string[] = []
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith('SELECT unit_id')) {
        const rows = [...pending].slice(0, values[0] as number)
          .map(unitId => ({ unit_id: unitId, summary: summaries.get(unitId) }))
        return { rows }
      }
      if (sql.startsWith('UPDATE source_units')) {
        if (values[0] === 'su_0000000000000003') throw new Error('write failed')
        pending.delete(values[0] as string)
        return { rowCount: 1 }
      }
      if (sql.startsWith('SELECT count(*)')) {
        return { rows: [{ count: String(pending.size) }] }
      }
      return { rows: [] }
    },
  }
  const service = new ProductionService({
    pool: pool as never,
    embedding: {
      resolve: async () => async (text: string) => {
        embeddedTexts.push(text)
        return [0.1, 0.2, 0.3]
      },
    },
    usage: { recordProducer: async () => ({ runId: 'run_test', usageId: 'usage_test' }) },
    searchMinConfidence: 0.05,
    recallWindow: 50,
  } as never)

  assert.deepEqual(await service.reindexSourceUnits(2), { embedded: 2, failed: 0, remaining: 1 })
  // 第二轮只取仍为 NULL 的单位：写入失败者重试，仍失败则继续留 NULL
  assert.deepEqual(await service.reindexSourceUnits(200), { embedded: 0, failed: 1, remaining: 1 })
  assert.deepEqual([...embeddedTexts].sort(), [...summaries.values()].sort())
})
