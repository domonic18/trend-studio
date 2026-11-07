#!/usr/bin/env node
/**
 * 生产端装机向导（A9）：一个 profile、一个模型位、交互式换发令牌、装完自检。
 *
 *   node scripts/setup.mjs            # 全流程：装 profile → 换发令牌 → 自检
 *   node scripts/setup.mjs install    # 只装（写 profile + 装依赖 + 写模型密钥）
 *   node scripts/setup.mjs login      # 只换发云端会话令牌
 *   node scripts/setup.mjs doctor     # 只自检
 *
 * 机密只落 dsh 托管凭据库（~/.dsh/.credentials.yaml 的 refs），profile 里只留引用名。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ask, askSecret } from './setup/prompt.mjs'
import { writeRef } from './setup/credentials.mjs'
import { buildManagedEntries, mergePatchEntries, readManagedConfig, readPatch, writePatch, writeProfilePackage } from './setup/profile.mjs'
import { credentialsFile, dshHome, profileDir, producerDir, skillsDir } from './setup/paths.mjs'
import { login as cloudLogin } from './setup/cloud.mjs'
import { runDoctor } from './setup/doctor.mjs'

const DEFAULT_PROFILE = 'trend-producer'
const DEFAULT_CLOUD = 'http://127.0.0.1:3939'
const DEFAULT_MODEL_KEY_REF = 'TREND_PRODUCER_MODEL_KEY'
const DEFAULT_TOKEN_REF = 'TREND_PRODUCER_CONSOLE_TOKEN'

function parseArgs(argv) {
  const options = { profile: DEFAULT_PROFILE, nonInteractive: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [flag, inline] = arg.slice(2).split('=', 2)
    const value = inline ?? argv[++i] ?? ''
    if (flag === 'profile') options.profile = value
    else if (flag === 'non-interactive') options.nonInteractive = true
    else options[flag] = value
  }
  return options
}

function pluginManifest() {
  return JSON.parse(readFileSync(path.join(producerDir, 'package.json'), 'utf8'))
}

function pluginVersion() {
  return pluginManifest().version
}

function pluginName() {
  return pluginManifest().name
}

/** 打包生产插件：构建 + 产出可安装的 tarball。 */
function packPlugin() {
  const version = pluginVersion()
  const tarball = path.join(producerDir, `dsh-plugin-trend-producer-${version}.tgz`)
  process.stdout.write(`▸ 打包生产插件（${version}）…\n`)
  const pack = spawnSync(process.execPath, [path.join(producerDir, 'scripts', 'pack.mjs')], { cwd: producerDir, stdio: 'inherit' })
  if (pack.status !== 0) throw new Error('插件打包失败')
  if (!existsSync(tarball)) throw new Error(`打包产物不存在：${tarball}`)
  return tarball
}

/** 把 profile 的依赖装上（dsh plugin 转发 pnpm）。 */
function installDependencies(profile) {
  process.stdout.write(`▸ 装进 profile ${profile}…\n`)
  const add = spawnSync('dsh', ['plugin', '--profile', profile, 'install'], { stdio: 'inherit' })
  if (add.status !== 0) throw new Error('profile 依赖安装失败（网络或 registry 不可达？）')
}

/** 装机参数：命令行 > 已有 profile > 交互提问。 */
async function planSlots(options, patchFile) {
  const current = existsSync(patchFile) ? readManagedConfig(patchFile) : null
  const fallback = {
    cloudBaseUrl: current?.cloud.baseUrl !== '' && current?.cloud.baseUrl !== undefined ? current.cloud.baseUrl : DEFAULT_CLOUD,
    environment: current?.cloud.environment !== '' && current?.cloud.environment !== undefined ? current.cloud.environment : 'local',
    provider: current?.model?.provider ?? 'trend',
    modelId: current?.model?.id ?? 'MiniMax-M3.1-Flash',
    modelName: current?.model?.id ?? 'MiniMax M3.1 Flash',
    modelApi: current?.model?.api ?? 'openai-completions',
    modelBaseUrl: current?.model?.baseUrl ?? 'https://api.minimaxi.com/v1',
    modelKeyRef: DEFAULT_MODEL_KEY_REF,
    tokenRef: DEFAULT_TOKEN_REF,
  }
  const pick = (flag, key) => {
    const value = options[flag]
    return typeof value === 'string' && value !== '' ? value : fallback[key]
  }
  const plan = {
    cloudBaseUrl: pick('cloud', 'cloudBaseUrl'),
    environment: pick('environment', 'environment'),
    provider: pick('model-provider', 'provider'),
    modelId: pick('model-id', 'modelId'),
    modelName: pick('model-name', 'modelName'),
    modelApi: pick('model-api', 'modelApi'),
    modelBaseUrl: pick('model-base-url', 'modelBaseUrl'),
    modelKeyRef: pick('model-key-ref', 'modelKeyRef'),
    tokenRef: pick('token-ref', 'tokenRef'),
  }
  if (options.nonInteractive) return plan

  plan.cloudBaseUrl = await ask('云端地址', { defaultValue: plan.cloudBaseUrl })
  plan.modelId = await ask('模型 id', { defaultValue: plan.modelId })
  plan.modelBaseUrl = await ask('模型 base url', { defaultValue: plan.modelBaseUrl })
  plan.modelApi = await ask('模型协议（openai-completions / anthropic-messages）', { defaultValue: plan.modelApi })
  return plan
}

/** 装 profile：写 package.json + patch（合并托管条目）+ 装依赖 + 写模型密钥。 */
async function install(options) {
  const dir = profileDir(options.profile)
  const patchFile = path.join(dir, 'cordis.patch.yml')
  const plan = await planSlots(options, patchFile)

  const tarball = packPlugin()
  writeProfilePackage(dir, pluginName(), tarball)
  installDependencies(options.profile)

  const managed = buildManagedEntries({
    model: {
      provider: plan.provider,
      id: plan.modelId,
      name: plan.modelName,
      api: plan.modelApi,
      baseUrl: plan.modelBaseUrl,
      keyRef: plan.modelKeyRef,
      contextWindow: 131_072,
      maxTokens: 32_768,
      frameEveryNth: 2,
    },
    cloud: { baseUrl: plan.cloudBaseUrl, environment: plan.environment },
    tokenRef: plan.tokenRef,
    skillsDir,
  })
  writePatch(patchFile, mergePatchEntries(readPatch(patchFile), managed))
  process.stdout.write(`▸ profile 已写入：${dir}\n`)

  const keyFile = credentialsFile()
  const key = options.nonInteractive
    ? process.env[plan.modelKeyRef] ?? ''
    : await askSecret(`模型 API key（写入凭据库 ${plan.modelKeyRef}）：`)
  if (key === '' || key === undefined) {
    process.stdout.write(`⚠ 未提供模型密钥：${plan.modelKeyRef} 未写入——模型位会不通。\n`)
  } else {
    writeRef(keyFile, plan.modelKeyRef, key)
    process.stdout.write(`▸ 模型密钥已写入凭据库：${plan.modelKeyRef}\n`)
  }
}

/** 换发云端会话令牌：账号密码 → POST /v1/auth/session → 凭据库。 */
async function login(options) {
  const dir = profileDir(options.profile)
  const patchFile = path.join(dir, 'cordis.patch.yml')
  const managed = existsSync(patchFile) ? readManagedConfig(patchFile) : null
  const baseUrl = options.cloud ?? managed?.cloud.baseUrl ?? DEFAULT_CLOUD
  const tokenRef = options['token-ref'] ?? managed?.cloud.tokenRef ?? DEFAULT_TOKEN_REF

  const username = options.nonInteractive
    ? process.env.TREND_PRODUCER_USERNAME ?? ''
    : await ask('云端账号')
  const password = options.nonInteractive
    ? process.env.TREND_PRODUCER_PASSWORD ?? ''
    : await askSecret('云端密码：')
  if (username === '' || password === '') throw new Error('账号或密码为空，未换发令牌')

  const session = await cloudLogin(baseUrl, username, password)
  writeRef(credentialsFile(), tokenRef, session.token)
  process.stdout.write(`▸ 会话令牌已写入凭据库：${tokenRef}（角色 ${session.user.role}）\n`)
}

/** 自检。 */
async function doctor(options) {
  const dir = profileDir(options.profile)
  const checks = await runDoctor({
    profile: options.profile,
    profileDir: dir,
    patchFile: path.join(dir, 'cordis.patch.yml'),
    credentialsFile: credentialsFile(),
    repoVersion: pluginVersion(),
    pluginName: pluginName(),
  })
  process.stdout.write(`\n装机自检（profile ${options.profile}，dsh home ${dshHome()}）\n`)
  for (const check of checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'skip' ? '－' : '✗'
    process.stdout.write(`${mark} ${check.label}：${check.detail}\n`)
  }
  const failed = checks.filter(check => check.status === 'fail')
  process.stdout.write(failed.length === 0 ? '\n全部通过。\n' : `\n${failed.length} 项未通过。\n`)
  return failed.length === 0
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : 'all'
  const options = parseArgs(argv)
  switch (command) {
    case 'install':
      await install(options)
      return
    case 'login':
      await login(options)
      return
    case 'doctor':
      process.exit(await doctor(options) ? 0 : 1)
    case 'all': {
      await install(options)
      await login(options)
      process.exit(await doctor(options) ? 0 : 1)
    }
    default:
      throw new Error(`未知子命令：${command}（可用：install / login / doctor / all）`)
  }
}

main().catch((error) => {
  process.stderr.write(`装机向导失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
