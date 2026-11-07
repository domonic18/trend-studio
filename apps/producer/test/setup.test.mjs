/** 装机向导的纯函数单测：模型位唯一、patch 合并不吞用户条目、凭据库读写保形。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import YAML from 'yaml'
import { buildManagedEntries, mergePatchEntries, PLATFORM_BUNDLES, readManagedConfig, readPatch, renderPatch, writeProfilePackage } from '../scripts/setup/profile.mjs'
import { readRef, writeRef } from '../scripts/setup/credentials.mjs'

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

test('装机：平台 bundle 不含 dsh-web-app（它会禁掉技能链路）', () => {
  assert.deepEqual(PLATFORM_BUNDLES, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])
  assert.ok(!PLATFORM_BUNDLES.includes('@deepseek-ai/dsh-web-app'))
})

test('装机：profile 的 bundle 列表是并集——已有的平台 bundle 不丢', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trend-profile-'))
  const file = path.join(dir, 'package.json')
  writeFileSync(file, JSON.stringify({
    name: 'dsh-profile-existing',
    dependencies: { other: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@custom/keep-me'] } },
  }), 'utf8')

  writeProfilePackage(dir, 'dsh-plugin-trend-producer', '/tmp/plugin.tgz')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@custom/keep-me',
    '@deepseek-ai/dsh-headless',
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
