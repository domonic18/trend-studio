#!/usr/bin/env node
/**
 * 生产端装机向导：零交互装机 + 装完自检；登录收敛到 dsh 内的 /trend login。
 *
 *   node scripts/setup.mjs            # 全流程：装 profile → 自检
 *   node scripts/setup.mjs install    # 只装（写 profile + 装依赖）
 *   node scripts/setup.mjs login      # 引导输出（登录在 dsh 会话框里做）
 *   node scripts/setup.mjs doctor     # 只自检
 *
 * 装机不问任何问题：参数走「命令行开关 > 既有 profile > 默认值」。
 * 机密不经过终端：登录走 /trend login（凭据记录），模型密钥在 dsh 设置 → 模型里粘贴。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from './setup/args.mjs'
import { buildManagedEntries, mergePatchEntries, readManagedConfig, readPatch, writePatch, writeProfilePackage } from './setup/profile.mjs'
import { credentialsFile, dshHome, profileDir, producerDir } from './setup/paths.mjs'
import { resolveInstallContext } from './setup/context.mjs'
import { installSkills } from './setup/skills.mjs'
import { runDsh } from './setup/dsh.mjs'
import { runDoctor } from './setup/doctor.mjs'

const DEFAULT_PROFILE = 'trend-producer'
const DEFAULT_CLOUD = 'http://127.0.0.1:3939'
const DEFAULT_MODEL_KEY_REF = 'TREND_PRODUCER_MODEL_KEY'
const DEFAULT_TOKEN_REF = 'TREND_PRODUCER_CONSOLE_TOKEN'

/** 不带值的开关：出现即真，不能把后面的参数吞掉。 */
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
  const add = runDsh(['plugin', '--profile', profile, 'install'])
  if (add.status !== 0) throw new Error('profile 依赖安装失败（网络或 registry 不可达？）')
}

/** 把下载的安装包复制进 profile 的 artifacts 目录——教员清空下载目录后仍能重装。 */
function copyArtifact(tarball, dir) {
  const artifacts = path.join(dir, 'artifacts')
  mkdirSync(artifacts, { recursive: true })
  const target = path.join(artifacts, path.basename(tarball))
  copyFileSync(tarball, target)
  return target
}

/** 装机参数：命令行 > 已有 profile > 默认值；零交互，不提问。 */
function planSlots(options, patchFile) {
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
  return {
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
}

/** 装 profile：写 package.json + patch（合并托管条目）+ 装依赖；不碰任何机密。 */
function install(options) {
  const dir = profileDir(options.profile)
  const patchFile = path.join(dir, 'cordis.patch.yml')
  const plan = planSlots(options, patchFile)

  const context = resolveInstallContext({
    packageDir: producerDir,
    profile: options.profile,
    tarballOption: options.tarball,
    profileDir: dir,
  })

  let tarball
  let skillsTarget
  if (context.mode === 'repo') {
    tarball = packPlugin()
    skillsTarget = context.skillsTargetDir
  } else {
    tarball = copyArtifact(context.tarball, dir)
    process.stdout.write(`▸ 使用下载的安装包：${context.tarball}\n`)
    const names = installSkills(context.skillsSourceDir, context.skillsTargetDir)
    process.stdout.write(`▸ 工艺包已复制到 ${context.skillsTargetDir}（${names.length} 个）\n`)
    skillsTarget = context.skillsTargetDir
  }

  writeProfilePackage(dir, context.pluginName, tarball)
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
    skillsDir: skillsTarget,
  })
  writePatch(patchFile, mergePatchEntries(readPatch(patchFile), managed))
  process.stdout.write(`▸ profile 已写入：${dir}\n`)

  process.stdout.write([
    '',
    '装机完成，接下来两步（都在 dsh 里做）：',
    '  1. 打开 dsh，在会话框输入 /trend login —— 浏览器自动打开云端授权页，用教员账号登录',
    `  2. dsh 设置 → 模型，粘贴视觉模型 API Key（凭据名 ${plan.modelKeyRef}，热生效）`,
    '',
  ].join('\n'))
}

/** 登录引导：终端口子收敛到一处——真正的登录在 dsh 会话框里做。 */
function login(options) {
  const dir = profileDir(options.profile)
  process.stdout.write([
    '登录在 dsh 里做，不在终端做：',
    '',
    `  1. 打开 dsh --profile ${options.profile ?? DEFAULT_PROFILE}`,
    '  2. 会话框输入 /trend login —— 浏览器自动打开云端授权页，用教员账号登录并批准',
    '  3. 令牌自动保存（凭据记录，热生效），无需重启',
    '',
    `装到哪台机器都能用这条链路；本机 profile 目录：${dir}`,
  ].join('\n'))
}

/** 自检。 */
async function doctor(options) {
  const dir = profileDir(options.profile)
  const checks = await runDoctor({
    profile: options.profile,
    profileDir: dir,
    patchFile: path.join(dir, 'cordis.patch.yml'),
    credentialsFile: credentialsFile(),
    expectedVersion: pluginVersion(),
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
  const options = parseArgs(argv, { profile: DEFAULT_PROFILE, nonInteractive: false })
  switch (command) {
    case 'install':
      install(options)
      return
    case 'login':
      login(options)
      return
    case 'doctor':
      process.exit(await doctor(options) ? 0 : 1)
    case 'all': {
      install(options)
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
