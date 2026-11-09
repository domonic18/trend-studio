/**
 * 装机自检：装完当场验，不等到跑到一半才 403。
 * 每项独立采集、独立报告——一项不过不掩盖其他项。
 * 状态四档：pass（✓）/ todo（○，装完后置两步还没做，不算失败）/
 * fail（✗，真问题）/ skip（－，前置缺失无法采集）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CREDENTIALS_MODE, readConsoleGrantRecord, readRef } from './credentials.mjs'
import { health, session } from './cloud.mjs'
import { probeModel } from './model.mjs'
import { readManagedConfig } from './profile.mjs'
import { runDsh } from './dsh.mjs'

/** console 设备码可批准的角色（与云端 approveDeviceCode 的门一致）。 */
const CONSOLE_ROLES = ['operator', 'admin', 'producer']

function skillCount(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .length
}

/** 组合配置里宿主层某一行是否被禁用（只看顶层行，不看 preset 组内的行）。 */
function hostRowDisabled(dump, id) {
  const lines = dump.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== `- id: ${id}`) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]
      if (line.startsWith('- id:')) break
      if (line.startsWith('  disabled:')) return line.includes('true')
    }
    return false
  }
  return null
}

/** dsh 组合后的配置树；起不来时返回 null。 */
function dumpConfig(profile) {
  const dump = runDsh(['--profile', profile, '--dump-config'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (dump.status !== 0 || typeof dump.stdout !== 'string') return null
  return dump.stdout
}

/** 逐项自检；任何一项失败都返回 fail，其余项照常采集。 */
export async function runDoctor(input) {
  const checks = []
  const managed = existsSync(input.patchFile)
    ? readManagedConfig(input.patchFile)
    : { model: null, cloud: { baseUrl: '', environment: '', tokenRef: '' }, skillsDirs: [] }

  // ⓪ 凭据库权限：dsh 凭据服务拒绝加载「所有者之外可读」的库，权限不对
  // 就等于密钥与令牌都没装——而且启动才报错，必须当场看见。
  if (!existsSync(input.credentialsFile)) {
    checks.push({ id: 'credentials_mode', label: '凭据库权限', status: 'fail', detail: `凭据库不存在：${input.credentialsFile}——重跑 setup install` })
  } else {
    const mode = statSync(input.credentialsFile).mode & 0o777
    const othersReadable = mode & 0o077
    checks.push(othersReadable === 0
      ? { id: 'credentials_mode', label: '凭据库权限', status: 'pass', detail: `${mode.toString(8).padStart(3, '0')}（仅所有者可读写）` }
      : { id: 'credentials_mode', label: '凭据库权限', status: 'fail', detail: `权限是 ${mode.toString(8).padStart(3, '0')}——dsh 拒绝加载，跑：chmod 600 ${input.credentialsFile}` })
  }

  // ① 插件版本：装进 profile 的版本必须等于安装包版本，否则行为与源码不一致
  const installedManifest = path.join(input.profileDir, 'node_modules', input.pluginName, 'package.json')
  const installedVersion = existsSync(installedManifest)
    ? (JSON.parse(readFileSync(installedManifest, 'utf8')).version ?? '')
    : ''
  checks.push(installedVersion === input.expectedVersion
    ? { id: 'plugin_version', label: '插件版本', status: 'pass', detail: `${installedVersion}（与安装包一致）` }
    : { id: 'plugin_version', label: '插件版本', status: 'fail', detail: installedVersion === ''
      ? `profile 里没装 ${input.pluginName}——先跑 setup install`
      : `装的是 ${installedVersion}，安装包是 ${input.expectedVersion}——重跑 setup install` })

  // ② skills 活挂载：目录存在且确实有技能包
  const mounted = managed.skillsDirs.filter(dir => skillCount(dir) > 0)
  checks.push(mounted.length > 0
    ? { id: 'skills_mounted', label: '技能包挂载', status: 'pass', detail: mounted.map(dir => `${dir}（${skillCount(dir)} 个）`).join('、') }
    : { id: 'skills_mounted', label: '技能包挂载', status: 'fail', detail: managed.skillsDirs.length === 0
      ? 'profile 里没有 customSkillDirs——重跑 setup install'
      : `挂载目录里没有技能包：${managed.skillsDirs.join('、')}` })

  // ②' 组合配置里技能链路没被禁：patch 里写了目录不等于 dsh 真加载了它。
  // web 应用面在宿主层禁掉 skill-filesystem 与 tool-skill（改由 agent preset
  // 逐会话挂载），本 profile 的补丁层在最后，会把 skill-filesystem 重新打开并
  // 挂上工艺包目录——所以宿主层这一行必须是启用的。
  // tool-skill 在宿主层禁用是 web 应用面的正常形态（preset 各自挂载），不计失败。
  const dump = dumpConfig(input.profile)
  if (dump === null) {
    checks.push({ id: 'skills_enabled', label: '技能链路启用', status: 'skip', detail: 'dsh 组合配置读不出来（dsh 不在 PATH？），跳过' })
  } else {
    const skillFilesystem = hostRowDisabled(dump, 'skill-filesystem')
    const toolSkill = hostRowDisabled(dump, 'tool-skill')
    checks.push(skillFilesystem === false
      ? {
          id: 'skills_enabled',
          label: '技能链路启用',
          status: 'pass',
          detail: `skill-filesystem 已启用（工艺包目录已挂上）；tool-skill ${toolSkill === true ? '由 agent preset 逐会话挂载' : '在宿主层启用'}`,
        }
      : {
          id: 'skills_enabled',
          label: '技能链路启用',
          status: 'fail',
          detail: skillFilesystem === true
            ? '组合配置里 skill-filesystem 被禁用——工艺包不会加载，重跑 setup install'
            : '组合配置里没有 skill-filesystem 这一行——重跑 setup install',
        })
  }

  // ③ 应用面：必须是 web 应用面。headless 是一次性任务执行器，没有命令分发，
  // 教员既触发不了登录也看不到任何界面——组合配置里没有 web-runtime 行即装错了。
  if (dump === null) {
    checks.push({ id: 'app_surface', label: '应用面', status: 'skip', detail: 'dsh 组合配置读不出来（dsh 不在 PATH？），跳过' })
  } else {
    const webRuntime = hostRowDisabled(dump, 'web-runtime')
    checks.push(webRuntime === false
      ? { id: 'app_surface', label: '应用面', status: 'pass', detail: 'web 应用面（浏览器界面 + 右侧栏生产面板）' }
      : { id: 'app_surface', label: '应用面', status: 'fail', detail: webRuntime === true
        ? '组合配置里 web-runtime 被禁用——重跑 setup install'
        : '组合配置里没有 web-runtime 行——profile 还在用 headless 应用面，重跑 setup install' })
  }

  // ④ 模型位唯一：agent 与理解阶段共用一个 provider + 一个 model
  const model = managed.model
  const single = model !== null && model.id !== ''
  const understandingApi = managed.understanding?.api ?? ''
  const providerApi = model?.api ?? ''
  // 协议不一致 = 理解阶段会拿 OpenAI 的报文去打 Anthropic 端点，直接 404。
  // 缺 api 视作插件默认值 openai-completions。
  const effectiveUnderstandingApi = understandingApi === '' ? 'openai-completions' : understandingApi
  const protocolMismatch = single && providerApi !== '' && effectiveUnderstandingApi !== providerApi
  checks.push(!single
    ? { id: 'model_slot', label: '模型位', status: 'fail', detail: 'profile 里没有配 llm-pi-ai provider——重跑 setup install' }
    : protocolMismatch
      ? { id: 'model_slot', label: '模型位', status: 'fail', detail: `理解阶段协议是 ${understandingApi === '' ? 'openai-completions（未写）' : understandingApi}，生产模型是 ${providerApi}——必须同一个协议，重跑 setup install` }
      : { id: 'model_slot', label: '模型位', status: 'pass', detail: `${model.provider}/${model.id}（agent 与理解阶段共用，协议 ${providerApi}）` })

  // ⑤ 模型可达
  if (model === null || model.id === '') {
    checks.push({ id: 'model_reachable', label: '模型可达', status: 'skip', detail: '模型位缺失，跳过' })
  } else {
    const key = readRef(input.credentialsFile, model.keyRef)
    if (key === null) {
      // 密钥后置到 dsh 设置页粘贴——装机时刻缺它是预期状态，不是失败。
      checks.push({ id: 'model_reachable', label: '模型可达', status: 'todo', detail: `还没粘模型密钥——dsh 设置 → 模型，粘贴到 ${model.keyRef}` })
    } else {
      try {
        const result = await probeModel({ api: model.api, baseUrl: model.baseUrl, model: model.id, key })
        checks.push({ id: 'model_reachable', label: '模型可达', status: 'pass', detail: `${model.id} 响应 ${result.latencyMs}ms` })
      } catch (error) {
        checks.push({ id: 'model_reachable', label: '模型可达', status: 'fail', detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  // ⑥ 云端可达
  if (managed.cloud.baseUrl === '') {
    checks.push({ id: 'cloud_reachable', label: '云端可达', status: 'skip', detail: 'profile 里没有配云端地址——重跑 setup install' })
  } else {
    try {
      await health(managed.cloud.baseUrl)
      checks.push({ id: 'cloud_reachable', label: '云端可达', status: 'pass', detail: managed.cloud.baseUrl })
    } catch (error) {
      checks.push({ id: 'cloud_reachable', label: '云端可达', status: 'fail', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  // ⑦ 登录态：console 凭据记录（面板登录写入）优先，老装机的 ref 兜底
  const grant = readConsoleGrantRecord(input.credentialsFile)
  const tokenRef = managed.cloud.tokenRef
  const legacyToken = tokenRef === '' ? null : readRef(input.credentialsFile, tokenRef)
  if (grant === null && legacyToken === null) {
    // 登录后置到 dsh 的生产面板——装机时刻未登录是预期状态，不是失败。
    checks.push(tokenRef === ''
      ? { id: 'token_valid', label: '登录态', status: 'fail', detail: 'profile 里没有配 consoleTokenRef——重跑 setup install' }
      : { id: 'token_valid', label: '登录态', status: 'todo', detail: '未登录——打开 dsh，右侧栏「趋势生产」面板点「登录」' })
  } else if (grant !== null && grant.expiresAt <= Date.now()) {
    checks.push({ id: 'token_valid', label: '登录态', status: 'fail', detail: `会话已过期（${grant.user.username}）——在 dsh 面板点「登录」重新授权` })
  } else {
    const token = grant?.token ?? legacyToken
    const source = grant !== null ? '凭据记录' : `ref ${tokenRef}（旧装机）`
    try {
      const user = await session(managed.cloud.baseUrl, token)
      const roleOk = CONSOLE_ROLES.includes(user.role)
      checks.push({
        id: 'token_valid',
        label: '登录态',
        status: roleOk ? 'pass' : 'fail',
        detail: roleOk
          ? `${user.username}（${user.role}，来自${source}）`
          : `角色是 ${user.role}，教员端需要 operator / admin / producer——换一个教员账号登录`,
      })
    } catch (error) {
      checks.push({ id: 'token_valid', label: '登录态', status: 'fail', detail: `${error instanceof Error ? error.message : String(error)}——在 dsh 面板点「登录」重新授权` })
    }
  }

  return checks
}
