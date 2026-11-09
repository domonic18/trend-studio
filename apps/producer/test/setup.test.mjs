/** 装机向导的纯函数单测：模型位唯一、patch 合并不吞用户条目、凭据库读写保形。 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { buildManagedEntries, mergePatchEntries, PLATFORM_BUNDLES, readManagedConfig, readPatch, renderPatch, writeProfilePackage } from '../scripts/setup/profile.mjs'
import { readConsoleGrantRecord, readRef, writeRef } from '../scripts/setup/credentials.mjs'
import { resolveInstallContext } from '../scripts/setup/context.mjs'
import { parseArgs } from '../scripts/setup/args.mjs'
import { installSkills, listSkills } from '../scripts/setup/skills.mjs'

const producerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CONFIG = {
  model: {
    provider: 'trend',
    id: 'MiniMax-M3.1-Flash',
    name: 'MiniMax M3.1 Flash',
    api: 'openai-completions',
    baseUrl: 'https://api.minimaxi.com/v1',
    keyRef: 'TREND_PRODUCER_MODEL_KEY',
    contextWindow: 131072,
    maxTokens: 32768,
    frameEveryNth: 2,
  },
  cloud: { baseUrl: 'http://127.0.0.1:3939', environment: 'local' },
  tokenRef: 'TREND_PRODUCER_CONSOLE_TOKEN',
  skillsDir: '/repo/apps/producer/skills',
}

test('装机：模型位唯一——agent 与理解阶段共用同一个 provider 与 model', () => {
  const entries = buildManagedEntries(CONFIG)
  const llm = entries.find(entry => entry.id === 'llm-pi-ai')
  const providers = llm.config.providers
  assert.equal(Object.keys(providers).length, 1, '只允许一个 provider')
  assert.deepEqual(Object.keys(providers), ['trend'])
  assert.equal(providers.trend.models.length, 1, '一个 provider 只允许一个 model')
  assert.equal(providers.trend.models[0].id, 'MiniMax-M3.1-Flash')
  assert.equal(providers.trend.apiKeyEnv, 'TREND_PRODUCER_MODEL_KEY', '密钥只留引用名')

  const agent = entries.find(entry => entry.id === 'agent-default-model')
  assert.equal(agent.config.provider, 'trend')
  assert.equal(agent.config.model, 'MiniMax-M3.1-Flash')

  const producer = entries.find(entry => entry.id === 'trend-producer')
  assert.equal(producer.config.understanding.model, 'MiniMax-M3.1-Flash')
  assert.equal(producer.config.understanding.apiKeyEnv, 'TREND_PRODUCER_MODEL_KEY')
  assert.equal(producer.config.consoleTokenRef, 'TREND_PRODUCER_CONSOLE_TOKEN')
  assert.equal(producer.config.baseUrl, 'http://127.0.0.1:3939')
})

test('装机：skills 活挂载与凭据开关写进 patch', () => {
  const entries = buildManagedEntries(CONFIG)
  const skills = entries.find(entry => entry.id === 'skill-filesystem')
  assert.deepEqual(skills.config.customSkillDirs, ['/repo/apps/producer/skills'])
  assert.equal(skills.disabled, false, '宿主层这一行被禁时工艺包不会加载，必须显式启用')
  const credentials = entries.find(entry => entry.id === 'credentials')
  assert.equal(credentials.disabled, false)
})

test('装机：平台 bundle 用 web 应用面（教员要有界面，不是命令）', () => {
  assert.deepEqual(PLATFORM_BUNDLES, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.ok(!PLATFORM_BUNDLES.includes('@deepseek-ai/dsh-headless'), 'headless 没有命令分发与界面，教员用不了')
})

test('装机：profile 的 bundle 列表是并集——已有的平台 bundle 不丢', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trend-profile-'))
  const file = path.join(dir, 'package.json')
  writeFileSync(file, JSON.stringify({
    name: 'dsh-profile-existing',
    dependencies: { other: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@custom/keep-me', '@deepseek-ai/dsh-headless'] } },
  }), 'utf8')

  writeProfilePackage(dir, 'dsh-plugin-trend-producer', '/tmp/plugin.tgz')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@custom/keep-me',
    '@deepseek-ai/dsh-web-app',
    'dsh-plugin-trend-producer',
  ])
  assert.equal(manifest.dependencies.other, '1.0.0', '别的依赖不能丢')
  assert.equal(manifest.dependencies['dsh-plugin-trend-producer'], 'file:/tmp/plugin.tgz')
})

test('patch：托管条目替换同名旧条目，用户条目原样保留', () => {
  const existing = [
    { id: 'llm-pi-ai', config: { providers: { old: { apiKeyEnv: 'OLD' } } } },
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
  ]
  const merged = mergePatchEntries(existing, buildManagedEntries(CONFIG))
  const ids = merged.map(entry => entry.id)
  assert.equal(ids.filter(id => id === 'llm-pi-ai').length, 1, '旧模型位不能残留')
  assert.ok(ids.includes('ui-settings-general'), '用户条目不能被吞')
  const llm = merged.find(entry => entry.id === 'llm-pi-ai')
  assert.deepEqual(Object.keys(llm.config.providers), ['trend'])
})

test('patch：渲染出的 YAML 能被解析回托管配置', () => {
  const text = renderPatch(mergePatchEntries([], buildManagedEntries(CONFIG)))
  const parsed = YAML.parse(text)
  assert.ok(Array.isArray(parsed))
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'trend-patch-')), 'cordis.patch.yml')
  writeFileSync(file, text, 'utf8')
  assert.deepEqual(readPatch(file).map(entry => entry.id), parsed.map(entry => entry.id))

  const managed = readManagedConfig(file)
  assert.equal(managed.model.provider, 'trend')
  assert.equal(managed.model.id, 'MiniMax-M3.1-Flash')
  assert.equal(managed.model.keyRef, 'TREND_PRODUCER_MODEL_KEY')
  assert.equal(managed.cloud.baseUrl, 'http://127.0.0.1:3939')
  assert.equal(managed.cloud.tokenRef, 'TREND_PRODUCER_CONSOLE_TOKEN')
  assert.deepEqual(managed.skillsDirs, ['/repo/apps/producer/skills'])
})

test('凭据库：写 ref 不动其他条目，值原样往返', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'trend-cred-')), '.credentials.yaml')
  writeFileSync(file, 'version: 1\nrefs:\n  KIMI_API_KEY: sk-existing\nrecords:\n  some/device:\n    kind: grant\n    payload:\n      token: abc\n', 'utf8')

  writeRef(file, 'TREND_PRODUCER_CONSOLE_TOKEN', 'tok-123')
  assert.equal(readRef(file, 'TREND_PRODUCER_CONSOLE_TOKEN'), 'tok-123')
  assert.equal(readRef(file, 'KIMI_API_KEY'), 'sk-existing', '别的 ref 不能丢')

  const text = readFileSync(file, 'utf8')
  const parsed = YAML.parse(text)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.refs.KIMI_API_KEY, 'sk-existing')
  assert.equal(parsed.records['some/device'].payload.token, 'abc', 'records 不能动')
})

test('凭据库：文件不存在时建一份 version 1 的新库', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'trend-cred-')), '.credentials.yaml')
  writeRef(file, 'TREND_PRODUCER_MODEL_KEY', 'sk-new')
  assert.equal(readRef(file, 'TREND_PRODUCER_MODEL_KEY'), 'sk-new')
  assert.equal(YAML.parse(readFileSync(file, 'utf8')).version, 1)
})

test('凭据库：写完权限收紧到 600——dsh 拒绝加载他人可读的凭据库', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'trend-cred-')), '.credentials.yaml')
  writeRef(file, 'TREND_PRODUCER_MODEL_KEY', 'sk-new')
  assert.equal(statSync(file).mode & 0o777, 0o600, '新建的库不能是 644')

  // 已有文件权限不会被 writeFileSync 改掉——显式收紧必须覆盖到。
  chmodSync(file, 0o644)
  writeRef(file, 'TREND_PRODUCER_CONSOLE_TOKEN', 'tok-123')
  assert.equal(statSync(file).mode & 0o777, 0o600, '旧库的宽松权限要收紧')
})

/** 造一个解包后的安装包目录：只有 package.json 与 skills，没有仓库里的 pack.mjs。 */
function fakeUnpackedPackage(root, version = '0.1.4') {
  const dir = path.join(root, 'package')
  mkdirSync(path.join(dir, 'skills'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-plugin-trend-producer',
    version,
  }), 'utf8')
  return dir
}

test('装机上下文：仓库模式指向仓库里的工艺包，不复制', () => {
  const context = resolveInstallContext({
    packageDir: producerDir,
    profile: 'trend-producer',
    profileDir: '/tmp/profiles/trend-producer',
  })
  assert.equal(context.mode, 'repo')
  assert.equal(context.copySkills, false, '仓库模式不复制——工艺包改了要立刻生效')
  assert.equal(context.skillsSourceDir, path.join(producerDir, 'skills'))
  assert.equal(context.skillsTargetDir, path.join(producerDir, 'skills'))
  assert.equal(context.tarball, null, '仓库模式现打 tarball')
  assert.equal(context.pluginName, 'dsh-plugin-trend-producer')
})

test('装机上下文：免仓库模式把工艺包落进 profile 目录', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'trend-unpacked-'))
  const packageDir = fakeUnpackedPackage(root)
  const tarball = path.join(root, 'dsh-plugin-trend-producer-0.1.4.tgz')
  writeFileSync(tarball, 'fake', 'utf8')

  const context = resolveInstallContext({
    packageDir,
    profile: 'trend-producer',
    profileDir: '/tmp/profiles/trend-producer',
  })
  assert.equal(context.mode, 'standalone')
  assert.equal(context.copySkills, true)
  assert.equal(context.skillsTargetDir, path.join('/tmp/profiles/trend-producer', 'skills'))
  assert.equal(context.tarball, tarball, '自动认下载目录里同版本的安装包')
})

test('装机上下文：--tarball 显式指定安装包', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'trend-unpacked-'))
  const packageDir = fakeUnpackedPackage(root)
  const tarball = path.join(root, 'downloaded.tgz')
  writeFileSync(tarball, 'fake', 'utf8')

  const context = resolveInstallContext({
    packageDir,
    profile: 'trend-producer',
    tarballOption: tarball,
    profileDir: '/tmp/profiles/trend-producer',
  })
  assert.equal(context.mode, 'standalone')
  assert.equal(context.tarball, tarball)
  assert.equal(context.skillsTargetDir, path.join('/tmp/profiles/trend-producer', 'skills'))
})

test('装机上下文：免仓库模式找不到安装包时明说怎么办', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'trend-unpacked-'))
  const packageDir = fakeUnpackedPackage(root)
  assert.throws(
    () => resolveInstallContext({ packageDir, profile: 'trend-producer', profileDir: '/tmp/profiles/trend-producer' }),
    /找不到生产插件安装包/,
  )
})

test('工艺包：只认含 SKILL.md 的目录，仓库里是九个', () => {
  const source = path.join(producerDir, 'skills')
  const names = listSkills(source)
  assert.equal(names.length, 9)
  assert.ok(!names.includes('README.md'))
})

test('工艺包：复制进 profile，并清掉上次留下的旧包', () => {
  const source = path.join(producerDir, 'skills')
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'trend-skills-')), 'skills')
  mkdirSync(path.join(target, 'stale-pkg'), { recursive: true })
  writeFileSync(path.join(target, 'stale-pkg', 'SKILL.md'), 'old', 'utf8')
  mkdirSync(path.join(target, 'not-a-skill'), { recursive: true })

  const copied = installSkills(source, target)
  assert.equal(copied.length, 9)
  for (const name of copied) {
    assert.ok(existsSync(path.join(target, name, 'SKILL.md')), `${name} 要复制到位`)
  }
  assert.ok(!existsSync(path.join(target, 'stale-pkg')), '上次留下的旧工艺包要清掉')
  assert.ok(existsSync(path.join(target, 'not-a-skill')), '不是工艺包的目录不动')
})

test('工艺包：源目录没有工艺包时报错', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'trend-empty-'))
  assert.throws(() => installSkills(empty, path.join(empty, 'target')), /没有工艺包/)
})

test('凭据库：读教员端 console 记录——合法、损坏、缺失各有出路', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trend-cred-'))
  const file = path.join(dir, '.credentials.yaml')
  writeFileSync(file, [
    'version: 1',
    'records:',
    '  trend-producer/console:',
    '    kind: grant',
    '    payload:',
    '      token: sess-token',
    `      expiresAt: ${Date.now() + 3_600_000}`,
    '      user:',
    '        userId: u1',
    '        username: teacher01',
    '        role: producer',
    '  other/plugin:',
    '    kind: api-key',
    '    key: k',
    '',
  ].join('\n'), 'utf8')

  const grant = readConsoleGrantRecord(file)
  assert.equal(grant.token, 'sess-token')
  assert.equal(grant.user.username, 'teacher01')
  assert.equal(grant.user.role, 'producer')

  // 损坏的记录按未登录处理
  writeFileSync(file, 'version: 1\nrecords:\n  trend-producer/console:\n    kind: grant\n    payload:\n      token: ""\n', 'utf8')
  assert.equal(readConsoleGrantRecord(file), null)
  // 缺失与文件不存在
  writeFileSync(file, 'version: 1\n', 'utf8')
  assert.equal(readConsoleGrantRecord(file), null)
  assert.equal(readConsoleGrantRecord(path.join(dir, 'nope.yaml')), null)
})

test('命令行：开关不吃掉后面的参数', () => {
  const options = parseArgs(
    ['all', '--profile', 'trend-producer', '--non-interactive', '--model-api', 'anthropic-messages'],
    { profile: 'trend-producer', nonInteractive: false },
  )
  assert.equal(options.nonInteractive, true)
  assert.equal(options['model-api'], 'anthropic-messages', '开关后面紧跟的参数不能被吞')
  assert.equal(options.profile, 'trend-producer')
})

test('命令行：取值参数吃下一个 argv，等号写法也认', () => {
  const options = parseArgs(
    ['all', '--model-base-url', 'https://api.minimaxi.com/anthropic', '--model-id=MiniMax-M3.1-Flash'],
    { profile: 'trend-producer', nonInteractive: false },
  )
  assert.equal(options['model-base-url'], 'https://api.minimaxi.com/anthropic')
  assert.equal(options['model-id'], 'MiniMax-M3.1-Flash')
})
