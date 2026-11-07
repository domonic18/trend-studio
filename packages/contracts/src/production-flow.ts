/**
 * 生产流程向导：九步顺序 + 中文标签 + 给人看的每步指引（目标 / 工具 / 常见坑）。
 *
 * 本文件**刻意不引 zod**——管理台是浏览器端，直接引这个子路径即可拿到真相源，
 * 不必把 zod 打进前端 bundle（生产任务 DTO 仍在 production-task.ts 里带 zod）。
 *
 * 同一份数据有两个渲染：
 * - 给模型：`apps/producer/skills/section-production/SKILL.md` 的流程向导段落（由
 *   `apps/producer/scripts/render-flow-guide.mjs` 从本文件渲染，有漂移守卫测试）；
 * - 给人：管理台「生产看板」页的流程向导步骤卡（`/admin/courses/:courseId/board`）。
 */

/** 9 步固定顺序（与 skills/section-production 的写入顺序一致）。 */
export const PRODUCTION_STEPS = [
  'case_stocks',
  'quotes_sync',
  'quotes_read',
  'figures',
  'replay_widget',
  'article',
  'widgets',
  'review',
  'provenance',
] as const
export type ProductionStep = (typeof PRODUCTION_STEPS)[number]

/** 步骤中文标签：给人看的步骤卡与看板列名。 */
export const PRODUCTION_STEP_LABELS: Record<ProductionStep, string> = {
  case_stocks: '案例股',
  quotes_sync: '行情同步',
  quotes_read: '行情读回',
  figures: '图示',
  replay_widget: '回放课件',
  article: '正文',
  widgets: '其余课件',
  review: '评审',
  provenance: '溯源',
}

export const PRODUCTION_TASK_STATUSES = ['pending', 'running', 'done', 'blocked', 'failed'] as const
export type ProductionTaskStatus = (typeof PRODUCTION_TASK_STATUSES)[number]

/** 一步的向导卡：做什么、用什么工具、最容易踩的坑。 */
export interface ProductionStepGuide {
  step: ProductionStep
  /** 一句话：这一步要产出什么。 */
  goal: string
  /** 这一步要用的生产端工具（模型侧的工具名，给人侧按同一口径对照）。 */
  tools: string[]
  /** 常见坑与对应错误码——先在这里排查，再去翻日志。 */
  pitfalls: string[]
}

/**
 * 九步的向导卡。顺序与 PRODUCTION_STEPS 一一对应，不多不少。
 * 文案面向「刚接手这门课的人」：说清这一步产出什么、用什么工具、会卡在哪。
 */
export const PRODUCTION_STEP_GUIDE: readonly ProductionStepGuide[] = [
  {
    step: 'case_stocks',
    goal: '落本节案例股清单（含周期口径），供正文股票锚与行情同步取数。',
    tools: ['cloud_case_stocks_write'],
    pitfalls: [
      '清单没落库就写正文 → 400 stock_not_in_list（股票锚校验本节清单）。',
      '每只股票都要定 period（1d 日线 / 1w 周线）：日线源只回溯到 2024-03 前后，讲更早年份必须写 1w。',
    ],
  },
  {
    step: 'quotes_sync',
    goal: '同步课程级行情缓存（按案例股代码取日/周 K），让标注与回放判断点有真实交易日可用。',
    tools: ['cloud_quotes_sync'],
    pitfalls: [
      '案例股没落库就同步不到行情——本步依赖第 1 步。',
      '同步是幂等的，可重跑；跑完不保证有数据，要看第 3 步读回多少根。',
    ],
  },
  {
    step: 'quotes_read',
    goal: '从缓存读回 bar，正文里的价格与成交量只能取自这次读回。',
    tools: ['cloud_quotes_read'],
    pitfalls: [
      '标注日期与判断点日期只能从返回的 tradeDate 里挑——视频里出现的日期未必落在缓存窗口内。',
      '禁止绕道外部行情源取价：渲染层画的就是这份缓存，数字对不上等于正文没 grounded。',
    ],
  },
  {
    step: 'figures',
    goal: '按 diagram-authoring 选型落图示拿到 figureId，供正文 :::figure 引用。',
    tools: ['cloud_figure_write', 'cloud_figure_delete'],
    pitfalls: [
      '图示没落库就写正文 → 400 figure_ref_unknown。',
      '超配额（diagram ≤2、keyframe ≤6）→ 409 figure_quota_exceeded。',
      '写错了要删而不是覆盖：cloud_figure_delete 不可恢复，正文若已引用该 id 要一并改。',
    ],
  },
  {
    step: 'replay_widget',
    goal: '落本节唯一一份回放课件（bar-replay-decision），正文 :::replay 按 code 解析它。',
    tools: ['cloud_widget_write', 'cloud_widget_delete'],
    pitfalls: [
      '课件没落库就写正文 → 400 replay_widget_unknown；同 code 两份 → 400 replay_widget_ambiguous。',
      'spec 的 period 与 overlays（均线位）必须与正文所讲周期、均线口径一致。',
    ],
  },
  {
    step: 'article',
    goal: '写 grounded 正文（Markdown + 富文本 DSL 容器块），段落级证据用 [[unit:]] 锚挂住。',
    tools: ['cloud_section_article_write'],
    pitfalls: [
      '引用未落库的图示 / 回放课件 / 非交易日标注会被拒（400），先补前序步骤。',
      '锚的 unitId 必须属于本课程，否则 400 unit_anchor_unknown；没有依据的具体说法不得落笔。',
    ],
  },
  {
    step: 'widgets',
    goal: '补齐其余白名单课件，并让每份课件的断言全部证明通过。',
    tools: ['cloud_widget_write'],
    pitfalls: [
      '409 assertion_unproven：按返回的 failed 断言改，不要盲改 spec。',
      'image-juxtaposition 可能引用本节 figureId，须等第 4 步图示落库后再写。',
    ],
  },
  {
    step: 'review',
    goal: '读回本节成品（教材 + 课件 + 图示）按 quality-rubric 打分，结论落 approve / reject。',
    tools: ['cloud_section_preview'],
    pitfalls: [
      '不靠记忆评分——先读回成品再打分。',
      'reject 重写后要把重写的那一步重新上报（attempt 自增），不能原地改 note 假装通过；≤3 轮仍不过转人工。',
    ],
  },
  {
    step: 'provenance',
    goal: '上报本节的溯源记录：content.section_draft / content.widget_spec / content.rubric_review。',
    tools: ['cloud_provenance'],
    pitfalls: [
      'token 与 latency 严禁估算——拿不到就留空，只报可核字段。',
      '溯源是发布门禁的一环，漏报会让内容无法正常发布。',
    ],
  },
]

/** 取一步的向导卡；步骤名不在九步内则抛错（调用方拼错步骤名应当立即暴露）。 */
export function productionStepGuide(step: ProductionStep): ProductionStepGuide {
  const guide = PRODUCTION_STEP_GUIDE.find(item => item.step === step)
  if (guide === undefined) {
    throw new Error(`未知生产步骤：${step}`)
  }
  return guide
}
