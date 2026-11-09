/**
 * 发布包的内容契约：教员免仓库装机时靠这份包拿到插件、工艺包与浏览器半。
 *
 * 少装一样就是静默故障——工艺包缺了 dsh 挂载不到任何技能，浏览器半缺了
 * 右侧栏「趋势生产」tab 根本不会出现（宿主扫不到 client.js 就是启动失败）。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const producerDir = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', producerDir), 'utf8'))

/** 装出来就能用的东西：一个不少。 */
const REQUIRED_FILES = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'lib/index.js',
  'lib/index.d.ts',
  'lib/client.js',
  'lib/host/panel.js',
  'lib/shared/panel-contract.js',
  'scripts/setup.mjs',
  'scripts/setup/doctor.mjs',
  'skills/transcript-understanding/SKILL.md',
  'skills/quality-rubric/SKILL.md',
]

test('浏览器半有独立入口，供 dsh 客户端模块系统装载', () => {
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
})

test('发布包含插件、浏览器半、九个工艺包与装机脚本', () => {
  const output = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: producerDir, encoding: 'utf8' },
  )
  const files = JSON.parse(output)[0].files.map(file => file.path)

  for (const required of REQUIRED_FILES) {
    assert.equal(files.includes(required), true, `缺少 ${required}`)
  }

  const skills = files.filter(file => file.endsWith('/SKILL.md'))
  assert.equal(skills.length, 9, `工艺包应为九个，实际 ${skills.length}`)

  assert.equal(files.some(file => /\.(env|pem|key|p12)$/i.test(file)), false)
})

test('打包脚本进包清单与 package.json 的 files 字段一致', () => {
  const packScript = readFileSync(new URL('scripts/pack.mjs', producerDir), 'utf8')
  const declared = [...packScript.match(/PACKED_FILES = \[(.*?)\]/s)[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  // npm pack 无条件收这几个，files 字段不必列。
  const alwaysIncluded = new Set(['package.json', 'README.md', 'LICENSE'])
  for (const entry of declared) {
    if (alwaysIncluded.has(entry)) continue
    assert.equal(pkg.files.includes(entry), true, `files 字段缺 ${entry}——pack 会拷它但 npm pack 不收`)
  }
})
