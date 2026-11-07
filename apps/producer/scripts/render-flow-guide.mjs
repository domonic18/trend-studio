/**
 * 把 @trend/contracts 的生产流程向导渲染成 SKILL.md 的一段（给模型看的那份渲染）。
 *
 * 真相源是 contracts 的 PRODUCTION_STEP_GUIDE；本脚本只负责「渲染」，不改内容。
 * 渲染结果写进 SKILL.md 的 flow-guide 标记块之间；漂移由 test/flow-guide.test.mjs 守卫。
 *
 * 用法：node scripts/render-flow-guide.mjs [--check]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRODUCTION_STEP_GUIDE,
  PRODUCTION_STEP_LABELS,
} from '@trend/contracts/production-flow'

const START = '<!-- flow-guide:start -->'
const END = '<!-- flow-guide:end -->'
const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'section-production', 'SKILL.md')

/** 渲染九步速查表：步 / 步骤 / 目标 / 工具 / 常见坑。 */
export function renderFlowGuide() {
  const rows = PRODUCTION_STEP_GUIDE.map((guide, index) => {
    const tools = guide.tools.map(tool => `\`${tool}\``).join('、')
    const pitfalls = guide.pitfalls.map(item => item.replace(/[。;；]$/, '')).join('；')
    return `| ${index + 1} | ${PRODUCTION_STEP_LABELS[guide.step]} | ${guide.goal} | ${tools} | ${pitfalls} |`
  })
  return [
    '| 步 | 步骤 | 目标 | 工具 | 常见坑 |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

/** 把渲染结果塞进 SKILL.md 的标记块之间（标记缺失或重复都直接报错）。 */
export function spliceFlowGuide(skill) {
  const start = skill.indexOf(START)
  const end = skill.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`SKILL.md 缺少 flow-guide 标记块（${START} / ${END}）`)
  }
  if (skill.indexOf(START, start + 1) !== -1 || skill.indexOf(END, end + 1) !== -1) {
    throw new Error('SKILL.md 的 flow-guide 标记块重复')
  }
  const before = skill.slice(0, start + START.length)
  const after = skill.slice(end)
  return `${before}\n${renderFlowGuide()}\n${after}`
}

async function main() {
  const check = process.argv.includes('--check')
  const current = await readFile(SKILL_PATH, 'utf8')
  const next = spliceFlowGuide(current)
  if (check) {
    if (current !== next) {
      console.error('SKILL.md 的流程向导段与契约不一致——跑 node scripts/render-flow-guide.mjs 重新渲染')
      process.exitCode = 1
    }
    return
  }
  if (current === next) {
    console.log('SKILL.md 流程向导段已是最新')
    return
  }
  await writeFile(SKILL_PATH, next)
  console.log('SKILL.md 流程向导段已更新')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
