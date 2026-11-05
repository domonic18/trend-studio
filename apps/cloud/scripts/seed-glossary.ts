import { AiUsageService } from '../src/ai/usage.js'
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db.js'
import { HttpError } from '../src/errors.js'
import { ProductionService } from '../src/production/service.js'

/** M9 趋势课术语表首批落库范围（不含牛散）。 */
const COURSE_ID = 'TC-ZONGLUN'

const GLOSSARY: { name: string; aliases: string[]; definition: string }[] = [
  {
    name: '国家队',
    aliases: ['汇金', '证金', '中央汇金', '中国证券金融', 'CSF'],
    definition:
      '以维护市场稳定为目的的国有资本，主体包括中央汇金、中国证券金融股份有限公司（证金）等。'
      + '识别口径：十大流通股东或龙虎榜机构席位中出现上述主体，且持股比例与时点随大盘异动而变动。'
      + '实战意义：国家队资金常在指数急跌、个股破位时介入，其重仓标的可作为观察市场底部的参照。'
      + '操作提示：国家队持股不等于抄底信号，只说明维稳资金入场，仍需结合 M60 位置、成交量能'
      + '与板块效应判断趋势是否真正企稳；单一国家队标的不能独立作为交易依据。',
  },
  {
    name: '游资',
    aliases: ['游资席位', '短线游资', '热钱', '短线资金'],
    definition:
      '以短线博弈为主、在涨停板与大成交量中进出的活跃资金，通常以营业部专用席位或自然人账户出现，'
      + '与公募、险资等机构持仓区分明显。'
      + '识别口径：龙虎榜买方席位高度集中、成交额占比大、个股换手率显著高于板块平均。'
      + '实战意义：游资的接力意愿决定题材的生命周期——游资扎堆的题材启动快、退潮也快。'
      + '操作提示：游资接力成立的前提是量能与题材持续发酵同时具备；一旦龙虎榜买方席位反转为卖方，'
      + '或题材内龙头炸板率抬升，通常意味着该题材已进入退潮期，不宜按主线继续加仓。',
  },
  {
    name: '龙虎榜',
    aliases: ['交易所异动榜', '席位榜', '公开信息榜'],
    definition:
      '交易所每个交易日收盘后公开的异动股买卖席位名单，是识别游资与机构席位的一手公开数据。'
      + '常见触发情形：收盘价涨跌幅偏离值达到 ±7%、日价格振幅达到 15%、日换手率达到 20%，'
      + '以及连续三个交易日收盘价涨跌幅偏离值累计达到 ±20%（风险警示股票阈值相应收紧）。'
      + '实战意义：龙虎榜把「谁在买」从猜测变成可核对的事实，是判断题材接力是否延续的实时窗口。'
      + '操作提示：看榜先看三件事——买一席位是谁、卖一席位是谁、买卖席位是否重叠；'
      + '买一与卖一重叠往往意味着对倒而非真实增量资金，榜单本身不等于买点，仍需回到趋势结构判断。',
  },
]

const config = loadConfig()
const pool = createPool(config.databaseUrl)
try {
  const service = new ProductionService({
    pool,
    embedding: { resolve: async () => undefined },
    usage: new AiUsageService(pool),
    searchMinConfidence: config.searchMinConfidence,
    recallWindow: 60,
  })
  for (const item of GLOSSARY) {
    try {
      const { conceptId } = await service.putConcept({
        courseId: COURSE_ID,
        name: item.name,
        aliases: item.aliases,
        definition: item.definition,
      })
      console.log(`created ${item.name} → ${conceptId}`)
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 409) {
        console.log(`skipped ${item.name}（已存在）`)
        continue
      }
      throw error
    }
  }
  const { concepts } = await service.listConcepts(COURSE_ID)
  console.log(`${COURSE_ID} 术语表共 ${concepts.length} 条`)
} finally {
  await pool.end()
}
