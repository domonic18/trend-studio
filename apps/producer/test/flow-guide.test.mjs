import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PRODUCTION_STEP_GUIDE } from '@trend/contracts/production-flow'
import { renderFlowGuide, spliceFlowGuide } from '../scripts/render-flow-guide.mjs'

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'section-production', 'SKILL.md')

test('SKILL.md 的流程向导段与契约一致（漂移守卫）', async () => {
  const skill = await readFile(SKILL_PATH, 'utf8')
  const expected = spliceFlowGuide(skill)
  assert.equal(skill, expected, 'SKILL.md 的流程向导段与契约不一致——跑 node scripts/render-flow-guide.mjs 重渲染')
})

test('渲染结果覆盖九步且每步都带目标与常见坑', () => {
  const rendered = renderFlowGuide()
  for (const guide of PRODUCTION_STEP_GUIDE) {
    assert.ok(rendered.includes(guide.goal), `缺 ${guide.step} 的目标说明`)
    assert.ok(rendered.includes(guide.tools[0]), `缺 ${guide.step} 的工具`)
  }
  assert.equal(rendered.split('\n').length, PRODUCTION_STEP_GUIDE.length + 2)
})
