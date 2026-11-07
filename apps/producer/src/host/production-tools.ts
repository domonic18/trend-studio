/** 生产任务状态机工具族：九步进度上报、看板读回、追加素材决策。顺序门禁在本地判定，云端只存状态。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PRODUCTION_STEPS, PRODUCTION_STEP_LABELS } from '@trend/contracts'
import { InputError, toToolError } from '../errors.js'
import { sanitizeInlineUntrusted } from '../untrusted.js'
import type { TrendCloudClient } from './cloud-client.js'
import {
  checkStepGate,
  isGateEnforced,
  nextAttempt,
  planSectionSteps,
  type StepTaskView,
} from './production-steps.js'
import type { ProductionStep, ProductionTaskStatus } from '@trend/contracts'

const ID_NOTE = 'ID 必须原样使用工具返回值，不得自行构造。'

const STEP_LABELS = PRODUCTION_STEP_LABELS
const STEP_NAMES = [...PRODUCTION_STEPS]
const STATUS_NAMES = ['pending', 'running', 'done', 'blocked', 'failed'] as ProductionTaskStatus[]

/** 任务行的输出 schema：三个工具共用。 */
const taskSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string', required: true },
    sectionId: { type: 'string', required: true },
    step: { type: 'string', required: true },
    status: { type: 'string', required: true },
    attempt: { type: 'number', required: true },
    maxAttempts: { type: 'number', required: true },
    note: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    updatedAt: { type: 'number', required: true },
  },
  additionalProperties: false,
} as const

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } as const

export function registerProductionTools(ctx: Context, client: TrendCloudClient): void {
  ctx.tools.register(defineTool({
    name: 'cloud_production_task_write',
    description:
      '上报生产任务状态：把九步生产（案例股→行情同步→行情读回→图示→回放课件→正文→其余课件→评审→溯源）'
      + '的进度落到云端，看板与断点续跑都靠它。'
      + '**顺序由引擎强制**：标记 running/done 时前置步骤必须已完成，否则本工具报错并告诉你「当前该做第几步」。'
      + '纪律：开始做某步先报 running，做完报 done 并在 note 写明产出；出错报 failed 并在 note 写错误码。'
      + 'attempt 是这一步已开始的次数，默认预算 3 次——超预算会被拒，此时转人工待办，不要继续重跑。' + ID_NOTE,
    parameters: {
      courseId: { type: 'string', required: true, description: '课程 ID' },
      sectionId: { type: 'string', required: true, description: '节 ID（sec_ 开头）' },
      step: {
        type: 'string',
        required: true,
        enum: STEP_NAMES,
        description: '九步之一：case_stocks 案例股 / quotes_sync 行情同步 / quotes_read 行情读回 / figures 图示 / replay_widget 回放课件 / article 正文 / widgets 其余课件 / review 评审 / provenance 溯源',
      },
      status: {
        type: 'string',
        required: true,
        enum: [...STATUS_NAMES],
        description: 'pending 待开始 / running 进行中 / done 已完成 / blocked 被挡 / failed 失败',
      },
      attempt: { type: 'number', description: '可选:这步已开始的次数；省略则由工具按已有记录推算' },
      maxAttempts: { type: 'number', description: '可选:回灌预算上限，默认 3' },
      note: { type: 'string', description: '可选:产出说明或错误码（≤2000 字）' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', required: true },
          step: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          maxAttempts: { type: 'number', required: true },
          note: nullableString,
          currentStep: nullableString,
          currentLabel: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `生产任务已上报: ${sanitizeInlineUntrusted(value.step)} = ${sanitizeInlineUntrusted(value.status)}`
          + `（第 ${value.attempt}/${value.maxAttempts} 次）｜下一步：${sanitizeInlineUntrusted(value.currentLabel)}`,
      }],
    },
    async execute(args, exec) {
      const {
        courseId, sectionId, step, status, attempt, maxAttempts, note,
      } = args as {
        courseId: string
        sectionId: string
        step: ProductionStep
        status: ProductionTaskStatus
        attempt?: number
        maxAttempts?: number
        note?: string
      }
      try {
        const existing = await client.listProductionTasks(
          { courseId: String(courseId), sectionId: String(sectionId) },
          exec.signal,
        )
        const tasks: StepTaskView[] = existing.tasks.map(task => ({ step: task.step, status: task.status }))
        const previous = existing.tasks.find(task => task.step === step)

        if (isGateEnforced(status)) {
          const gate = checkStepGate(tasks, step)
          if (!gate.ok) throw new InputError(gate.message)
        }

        const nextAttemptCount = attempt ?? nextAttempt(previous, status)
        const budget = maxAttempts ?? previous?.maxAttempts ?? 3
        if (status === 'running' && nextAttemptCount > budget) {
          throw new InputError(
            `「${STEP_LABELS[step]}」回灌已达上限 ${budget} 次，按纪律转人工待办，不要继续重跑。`,
          )
        }

        const result = await client.upsertProductionTask({
          courseId: String(courseId),
          sectionId: String(sectionId),
          step,
          status,
          attempt: nextAttemptCount,
          maxAttempts: budget,
          ...(note === undefined ? {} : { note: String(note) }),
        }, exec.signal)
        const plan = planSectionSteps([
          ...tasks.filter(task => task.step !== step),
          { step, status },
        ])
        return {
          taskId: result.task.taskId,
          step: result.task.step,
          status: result.task.status,
          attempt: result.task.attempt,
          maxAttempts: result.task.maxAttempts,
          note: result.task.note,
          currentStep: plan.currentStep,
          currentLabel: plan.currentLabel,
        }
      } catch (error) {
        throw toToolError(error, '上报生产任务')
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cloud_production_tasks_read',
    description:
      '读生产任务进度：返回各节的九步状态，并算出「当前该做第几步」与哪些步骤被前置挡住。'
      + '**续跑先读这个**：已 done 的步骤不要重做；返回的 currentStep 就是下一件该做的事。' + ID_NOTE,
    parameters: {
      courseId: { type: 'string', required: true, description: '课程 ID' },
      sectionId: { type: 'string', description: '可选:只看某一节' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          tasks: { type: 'array', required: true, items: taskSchema },
          sections: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              properties: {
                sectionId: { type: 'string', required: true },
                currentStep: nullableString,
                currentLabel: { type: 'string', required: true },
                completed: { type: 'array', required: true, items: { type: 'string' } },
                blocked: { type: 'array', required: true, items: { type: 'string' } },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const lines = [`生产任务 ${value.tasks.length} 条：`]
        for (const section of value.sections) {
          lines.push(`- ${sanitizeInlineUntrusted(section.sectionId)}：当前该做第 `
            + `${section.currentStep === null ? '—' : String(section.currentStep)} 步 `
            + `（${sanitizeInlineUntrusted(section.currentLabel)}）｜已完成 ${section.completed.length}/9`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { courseId, sectionId } = args as { courseId: string; sectionId?: string }
      try {
        const result = await client.listProductionTasks({
          courseId: String(courseId),
          ...(sectionId === undefined ? {} : { sectionId: String(sectionId) }),
        }, exec.signal)
        const bySection = new Map<string, StepTaskView[]>()
        for (const task of result.tasks) {
          const list = bySection.get(task.sectionId) ?? []
          list.push({ step: task.step, status: task.status })
          bySection.set(task.sectionId, list)
        }
        const sections = [...bySection.entries()].map(([id, tasks]) => {
          const plan = planSectionSteps(tasks)
          return {
            sectionId: id,
            currentStep: plan.currentStep,
            currentLabel: plan.currentLabel,
            completed: plan.completed,
            blocked: plan.blocked,
          }
        })
        return { tasks: result.tasks, sections }
      } catch (error) {
        throw toToolError(error, '读取生产任务')
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cloud_production_board_read',
    description:
      '读生产看板：每节一行——九步状态、正文版本、课件/图示/案例股计数、最近评审结论，'
      + '外加本课程最近的追加素材决策。看整体进度或交接时用它。' + ID_NOTE,
    parameters: {
      courseId: { type: 'string', required: true, description: '课程 ID' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          courseId: { type: 'string', required: true },
          courseTitle: { type: 'string', required: true },
          sections: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              properties: {
                sectionId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                position: { type: 'number', required: true },
                steps: { type: 'array', required: true, items: taskSchema },
                articleVersion: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
                widgetCount: { type: 'number', required: true },
                figureCount: { type: 'number', required: true },
                caseStockCount: { type: 'number', required: true },
                reviewVerdict: nullableString,
              },
              additionalProperties: false,
            },
          },
          materialChoices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              properties: {
                choiceId: { type: 'string', required: true },
                assetId: { type: 'string', required: true },
                sectionId: nullableString,
                choice: { type: 'string', required: true },
                affectedSectionIds: { type: 'array', required: true, items: { type: 'string' } },
                note: nullableString,
                createdAt: { type: 'number', required: true },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const lines = [`生产看板：${sanitizeInlineUntrusted(value.courseTitle)}（${value.sections.length} 节）`]
        for (const section of value.sections) {
          const done = section.steps.filter(step => step.status === 'done').length
          lines.push(`- ${sanitizeInlineUntrusted(section.title)}：步骤 ${done}/${section.steps.length}`
            + `｜正文 ${section.articleVersion === null ? '无' : `v${section.articleVersion}`}`
            + `｜课件 ${section.widgetCount} 图示 ${section.figureCount} 案例股 ${section.caseStockCount}`
            + `｜评审 ${section.reviewVerdict ?? '—'}`)
        }
        for (const choice of value.materialChoices) {
          lines.push(`追加素材决策 ${sanitizeInlineUntrusted(choice.choice)}：影响 ${choice.affectedSectionIds.length} 节`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { courseId } = args as { courseId: string }
      try {
        return await client.readProductionBoard({ courseId: String(courseId) }, exec.signal)
      } catch (error) {
        throw toToolError(error, '读取生产看板')
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cloud_material_impact',
    description:
      '算追加素材的影响面（只读，不落库）：这批新素材按 A/B/C 哪种处理方式，会让哪几节被重跑。'
      + 'A=只补这节（需给 sectionId）／B=重做课程骨架（全课程）／C=只入库先不生产（不影响任何节）。'
      + '**给人做选择前先算这个**，把受影响节名列清楚——人最怕「不知道它会动什么」。' + ID_NOTE,
    parameters: {
      courseId: { type: 'string', required: true, description: '课程 ID' },
      assetId: { type: 'string', required: true, description: '新素材 ID（asset_ 开头）' },
      choice: {
        type: 'string',
        required: true,
        enum: ['A', 'B', 'C'],
        description: 'A 只补这节 / B 重做课程骨架 / C 只入库先不生产',
      },
      sectionId: { type: 'string', description: 'A 场景必填：只补哪一节' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          choice: { type: 'string', required: true },
          affectedSectionIds: { type: 'array', required: true, items: { type: 'string' } },
          affectedTitles: { type: 'array', required: true, items: { type: 'string' } },
          resetStepCount: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `选择 ${sanitizeInlineUntrusted(value.choice)} 的影响面：`
          + `${value.affectedSectionIds.length} 节被重跑（${value.resetStepCount} 个步骤重置为待开始）`
          + (value.affectedTitles.length === 0
            ? ''
            : `：${value.affectedTitles.map(title => sanitizeInlineUntrusted(title)).join('、')}`),
      }],
    },
    async execute(args, exec) {
      const { courseId, assetId, choice, sectionId } = args as {
        courseId: string
        assetId: string
        choice: 'A' | 'B' | 'C'
        sectionId?: string
      }
      try {
        return await client.readMaterialImpact({
          courseId: String(courseId),
          assetId: String(assetId),
          choice,
          ...(sectionId === undefined ? {} : { sectionId: String(sectionId) }),
        }, exec.signal)
      } catch (error) {
        throw toToolError(error, '计算追加素材影响面')
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cloud_material_choice',
    description:
      '落追加素材的处理决定：把人的选择写进生产任务，并把受影响节的九步状态重置为待开始（pending）。'
      + 'A 场景同时把新素材挂进该节的素材清单。'
      + '**只有在人明确选了 A/B/C 之后才调本工具**——不得由你自作主张。' + ID_NOTE,
    parameters: {
      courseId: { type: 'string', required: true, description: '课程 ID' },
      assetId: { type: 'string', required: true, description: '新素材 ID（asset_ 开头）' },
      choice: {
        type: 'string',
        required: true,
        enum: ['A', 'B', 'C'],
        description: 'A 只补这节 / B 重做课程骨架 / C 只入库先不生产',
      },
      sectionId: { type: 'string', description: 'A 场景必填：只补哪一节' },
      note: { type: 'string', description: '可选:人的补充说明（≤2000 字）' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          choiceId: { type: 'string', required: true },
          choice: { type: 'string', required: true },
          affectedSectionIds: { type: 'array', required: true, items: { type: 'string' } },
          note: nullableString,
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已记录追加素材决策 ${sanitizeInlineUntrusted(value.choice)}：`
          + `${value.affectedSectionIds.length} 节的九步已重置为待开始`,
      }],
    },
    async execute(args, exec) {
      const { courseId, assetId, choice, sectionId, note } = args as {
        courseId: string
        assetId: string
        choice: 'A' | 'B' | 'C'
        sectionId?: string
        note?: string
      }
      try {
        const result = await client.recordMaterialChoice({
          courseId: String(courseId),
          assetId: String(assetId),
          choice,
          ...(sectionId === undefined ? {} : { sectionId: String(sectionId) }),
          ...(note === undefined ? {} : { note: String(note) }),
        }, exec.signal)
        return {
          choiceId: result.choice.choiceId,
          choice: result.choice.choice,
          affectedSectionIds: result.choice.affectedSectionIds,
          note: result.choice.note,
        }
      } catch (error) {
        throw toToolError(error, '记录追加素材决策')
      }
    },
  }))
}
