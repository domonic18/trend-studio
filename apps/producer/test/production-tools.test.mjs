import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerProductionTools } from '../lib/host/production-tools.js'
import { registerCloudTools } from '../lib/host/tools.js'

function collectTools(client) {
  const registered = []
  const ctx = { tools: { register(tool) { registered.push(tool) } } }
  registerCloudTools(ctx, client, {}, {})
  registerProductionTools(ctx, client)
  return registered
}

function task(overrides) {
  return {
    taskId: 'pt_0123456789abcdef',
    courseId: 'TC-ZONGLUN',
    sectionId: 'sec_0123456789abcdef',
    step: 'case_stocks',
    status: 'done',
    attempt: 1,
    maxAttempts: 3,
    note: null,
    updatedAt: 1_761_000_000_000,
    ...overrides,
  }
}

/** 全部 cloud_* 工具的 schema 必须在 dsh 的 schema DSL 里编译得过（插件能激活）。 */
test('生产任务工具的 schema 可被 dsh schema DSL 编译（插件能激活）', () => {
  const registered = collectTools({})
  const names = registered.map(tool => tool.name)
  for (const expected of [
    'cloud_production_task_write',
    'cloud_production_tasks_read',
    'cloud_production_board_read',
    'cloud_material_impact',
    'cloud_material_choice',
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
})

test('cloud_production_task_write：前置步骤未完成时挡住，并告知当前该做第几步', async () => {
  const client = {
    async listProductionTasks() {
      return {
        tasks: [
          task({ step: 'case_stocks', status: 'done' }),
          task({ step: 'quotes_sync', status: 'pending' }),
        ],
      }
    },
    async upsertProductionTask() {
      throw new Error('不应被调用')
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_production_task_write')
  await assert.rejects(
    () => tool.execute(
      { courseId: 'TC-ZONGLUN', sectionId: 'sec_0123456789abcdef', step: 'article', status: 'running' },
      { signal: undefined },
    ),
    /第 2 步/,
  )
})

test('cloud_production_task_write：顺序正确时上报成功并回报下一步', async () => {
  const seen = []
  const client = {
    async listProductionTasks() {
      return { tasks: [task({ step: 'case_stocks', status: 'done' })] }
    },
    async upsertProductionTask(input) {
      seen.push(input)
      return { task: task({ step: 'quotes_sync', status: 'running', attempt: 1 }) }
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_production_task_write')
  const result = await tool.execute(
    { courseId: 'TC-ZONGLUN', sectionId: 'sec_0123456789abcdef', step: 'quotes_sync', status: 'running' },
    { signal: undefined },
  )
  assert.equal(seen[0].step, 'quotes_sync')
  assert.equal(seen[0].status, 'running')
  assert.equal(seen[0].attempt, 1)
  assert.equal(result.status, 'running')
  assert.equal(result.currentStep, 'quotes_sync')
})

test('cloud_production_task_write：回灌次数超预算即拒绝', async () => {
  const client = {
    async listProductionTasks() {
      return {
        tasks: [
          task({ step: 'case_stocks', status: 'done' }),
          task({ step: 'quotes_sync', status: 'failed', attempt: 3 }),
        ],
      }
    },
    async upsertProductionTask() {
      throw new Error('不应被调用')
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_production_task_write')
  await assert.rejects(
    () => tool.execute(
      { courseId: 'TC-ZONGLUN', sectionId: 'sec_0123456789abcdef', step: 'quotes_sync', status: 'running' },
      { signal: undefined },
    ),
    /上限 3 次/,
  )
})

test('cloud_production_tasks_read：返回每节的当前步与被挡步骤', async () => {
  const client = {
    async listProductionTasks() {
      return {
        tasks: [
          task({ step: 'case_stocks', status: 'done' }),
          task({ step: 'quotes_sync', status: 'running' }),
        ],
      }
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_production_tasks_read')
  const result = await tool.execute({ courseId: 'TC-ZONGLUN' }, { signal: undefined })
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].currentStep, 'quotes_sync')
  assert.equal(result.sections[0].currentLabel, '行情同步')
  assert.equal(result.sections[0].blocked.length, 7)
})

test('cloud_material_impact：入参透传，影响面进 render 输出', async () => {
  const seen = []
  const client = {
    async readMaterialImpact(input) {
      seen.push(input)
      return {
        choice: 'A',
        affectedSectionIds: ['sec_0123456789abcdef'],
        affectedTitles: ['总论 2'],
        resetStepCount: 9,
      }
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_material_impact')
  const result = await tool.execute(
    { courseId: 'TC-ZONGLUN', assetId: 'asset_0123456789abcdef', choice: 'A', sectionId: 'sec_0123456789abcdef' },
    { signal: undefined },
  )
  assert.deepEqual(seen[0], {
    courseId: 'TC-ZONGLUN',
    assetId: 'asset_0123456789abcdef',
    choice: 'A',
    sectionId: 'sec_0123456789abcdef',
  })
  assert.equal(result.affectedTitles[0], '总论 2')
  const rendered = tool.output.render({}, result)
  assert.match(rendered[0].text, /总论 2/)
})

test('cloud_material_choice：落库后回报受影响节', async () => {
  const client = {
    async recordMaterialChoice(input) {
      assert.equal(input.choice, 'B')
      return {
        choice: {
          choiceId: 'pmc_0123456789abcdef',
          courseId: 'TC-ZONGLUN',
          assetId: 'asset_0123456789abcdef',
          sectionId: null,
          choice: 'B',
          affectedSectionIds: ['sec_0123456789abcdef', 'sec_0123456789abcdee'],
          note: null,
          createdAt: 1_761_000_000_000,
        },
      }
    },
  }
  const tool = collectTools(client).find(item => item.name === 'cloud_material_choice')
  const result = await tool.execute(
    { courseId: 'TC-ZONGLUN', assetId: 'asset_0123456789abcdef', choice: 'B' },
    { signal: undefined },
  )
  assert.equal(result.choiceId, 'pmc_0123456789abcdef')
  assert.equal(result.affectedSectionIds.length, 2)
})
