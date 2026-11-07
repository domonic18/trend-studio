import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  caseStocksWriteOutput,
  chapterWriteOutput,
  conceptsListOutput,
  courseCreateOutput,
  courseReadOutput,
  figureWriteOutput,
  framesOutput,
  materialImpactOutput,
  pipelineStatusOutput,
  productionBoardOutput,
  productionTaskDto,
  provenanceOutput,
  quotesListOutput,
  quotesSyncOutput,
  sectionArticleWriteOutput,
  sourceUnitsReadOutput,
  sourceUnitsSearchOutput,
  sourceUnitsWriteOutput,
  transcriptOutput,
  widgetWriteOutput,
} from '@trend/contracts'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { registerCloudTools } from '../lib/host/tools.js'
import { registerProductionTools } from '../lib/host/production-tools.js'

/**
 * 出参 schema 必须声明云端实际返回的每一个字段。
 *
 * dsh 按工具声明的 `output.schema` 校验返回值，且 `additionalProperties: false`——
 * 云端多返回一个未声明字段，整个工具结果被判非法，工具表现为「读证据报 schema 错」
 * 而不是「少了一个字段」。端到端验收里栽过两次：
 *   - `cloud_source_units_read` 漏声明云端固定返回的 `partial`，生产端整条证据链读不出来；
 *   - `cloud_production_board_read` / `cloud_production_tasks_read` 漏声明 `courseId` /
 *     `chapterId`，看板与进度读不出来。
 *
 * 本测试对每个工具做**双向**校验：拿契约生成的样例载荷喂给工具声明的出参 schema，
 *   ① 载荷里的每个字段都必须在出参里声明（漏一个 → dsh 判非法）；
 *   ② 出参里不能有契约没有的野字段（声明了但云端不返回 → 永远拿不到值）。
 * 契约形状变了而工具没跟上时，这里先炸。
 */

/** 按 zod 契约生成一份样例载荷：字段名与嵌套结构一律取自契约本身。 */
function sample(schema) {
  const def = schema?._zod?.def
  if (def === undefined) throw new Error('契约不是 zod schema')
  switch (def.type) {
    case 'object': {
      const out = {}
      for (const [key, value] of Object.entries(schema.shape)) out[key] = sample(value)
      return out
    }
    case 'array':
      return [sample(def.element)]
    case 'nullable':
      return sample(def.innerType)
    case 'optional':
      return sample(def.innerType)
    case 'record':
      // 键由云端给，值按契约的类型；出参若禁了额外字段，喂一个键就会炸。
      return { 'sample-key': sample(def.valueType) }
    case 'lazy':
      return sample(def.getter())
    case 'union':
      return sample(def.options[0])
    case 'default':
      return sample(def.innerType)
    case 'string':
      return 'sample'
    case 'number':
      return 1
    case 'boolean':
      return true
    case 'enum':
      return Object.keys(def.entries)[0]
    case 'literal':
      return def.values[0]
    default:
      throw new Error(`未覆盖的契约类型：${def.type}`)
  }
}

function registerAll() {
  const registered = []
  const ctx = { tools: { register: tool => registered.push(tool) } }
  registerCloudTools(ctx, {}, {}, {})
  registerProductionTools(ctx, {})
  return registered
}

function declared(tool) {
  return Object.keys(tool.output.schema.properties ?? {})
}

/** 直通型工具：工具返回值就是 zod 契约本身，契约字段必须全被声明。 */
const PASSTHROUGH = {
  cloud_pipeline_status: pipelineStatusOutput,
  cloud_transcript: transcriptOutput,
  cloud_frames: framesOutput,
  cloud_source_units_write: sourceUnitsWriteOutput,
  cloud_source_units_search: sourceUnitsSearchOutput,
  cloud_source_units_read: sourceUnitsReadOutput,
  cloud_concepts_list: conceptsListOutput,
  cloud_course_create: courseCreateOutput,
  cloud_chapter_write: chapterWriteOutput,
  cloud_course_read: courseReadOutput,
  cloud_section_article_write: sectionArticleWriteOutput,
  cloud_widget_write: widgetWriteOutput,
  cloud_case_stocks_write: caseStocksWriteOutput,
  cloud_quotes_sync: quotesSyncOutput,
  cloud_quotes_read: quotesListOutput,
  cloud_provenance: provenanceOutput,
  cloud_production_board_read: productionBoardOutput,
  cloud_material_impact: materialImpactOutput,
}

/**
 * 加工型工具：出参不是契约本身。
 * `items` 是契约里被摊平的数组字段（看板的 steps / 任务列表），
 * `dropped` 是工具刻意裁掉的契约字段——裁掉是有意的，但要显式登记，
 * 改契约时才有人知道要重新裁决。
 */
const RESHAPED = {
  cloud_figure_write: { top: ['figureId', 'kind', 'status', 'selectedCandidateId', 'assetId', 'sourceSec', 'spec'], dropped: ['caption'] },
  cloud_section_preview: { top: ['sectionId', 'title', 'status', 'article', 'widgets', 'figures'] },
  cloud_production_task_write: {
    top: ['taskId', 'step', 'status', 'attempt', 'maxAttempts', 'note', 'currentStep', 'currentLabel'],
  },
  cloud_production_tasks_read: {
    top: ['tasks', 'sections'],
    items: { tasks: 'productionTaskDto' },
    // sections 是工具自己摊出来的（按节聚合九步），不在契约里；这里给一份合法值。
    extra: {
      sections: [{
        sectionId: 'sec_0123456789abcdef',
        currentStep: 'figures',
        currentLabel: '图示',
        completed: ['case_stocks', 'quotes_sync', 'quotes_read'],
        blocked: [],
      }],
    },
  },
  cloud_material_choice: {
    top: ['choiceId', 'choice', 'affectedSectionIds', 'note'],
  },
}

test('cloud_* 出参声明覆盖云端契约的全部字段（漏一个整个结果被判非法）', () => {
  const registered = registerAll()
  for (const tool of registered) {
    const contract = PASSTHROUGH[tool.name]
    if (contract === undefined) continue
    const violations = validateJsonSchemaValue(tool.output.schema, sample(contract), '')
    assert.deepEqual(violations, [], `${tool.name} 的出参没接住契约载荷`)
  }
})

test('cloud_* 出参声明与契约对齐（没有多声明的野字段）', () => {
  const registered = registerAll()
  for (const tool of registered) {
    const reshaped = RESHAPED[tool.name]
    if (reshaped === undefined) continue
    assert.deepEqual(declared(tool).sort(), [...reshaped.top].sort(), `${tool.name} 的出参形状变了，要显式改这里`)
  }
})

test('加工型工具摊平的数组字段逐项对齐契约', () => {
  const registered = registerAll()
  for (const tool of registered) {
    const reshaped = RESHAPED[tool.name]
    if (reshaped?.items === undefined) continue
    for (const [field, contractName] of Object.entries(reshaped.items)) {
      const items = tool.output.schema.properties[field].items
      const contract = { productionTaskDto }[contractName]
      assert.ok(contract !== undefined, `未登记的契约：${contractName}`)
      const payload = { [field]: [sample(contract)], ...(reshaped.extra ?? {}) }
      const violations = validateJsonSchemaValue(tool.output.schema, payload, '')
      assert.deepEqual(violations, [], `${tool.name} 的 ${field} 元素没接住契约载荷`)
      assert.equal(items.additionalProperties, false, `${tool.name} 的 ${field} 必须禁止额外字段`)
    }
  }
})

test('cloud_source_units_read 声明 partial（云端固定返回，漏了整条证据链读不出来）', () => {
  const tool = registerAll().find(item => item.name === 'cloud_source_units_read')
  assert.ok(declared(tool).includes('partial'), 'cloud_source_units_read 出参必须声明 partial')
  assert.ok(Object.keys(sourceUnitsReadOutput.shape).includes('partial'))
})

test('看板与任务读出参声明 courseId / chapterId（漏了看板读不出来）', () => {
  const registered = registerAll()
  const board = registered.find(item => item.name === 'cloud_production_board_read')
  const boardSection = board.output.schema.properties.sections.items.properties
  assert.ok('chapterId' in boardSection, 'cloud_production_board_read 的节必须声明 chapterId')
  assert.ok('courseId' in boardSection.steps.items.properties, '节内步骤必须声明 courseId')
  assert.ok(
    'courseId' in board.output.schema.properties.materialChoices.items.properties,
    '追加素材决策必须声明 courseId',
  )
  const tasks = registered.find(item => item.name === 'cloud_production_tasks_read')
  assert.ok(
    'courseId' in tasks.output.schema.properties.tasks.items.properties,
    'cloud_production_tasks_read 的任务必须声明 courseId',
  )
})
