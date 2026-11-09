/**
 * dsh profile 的读写：profile package.json（插件依赖 + bundle 列表）与
 * cordis.patch.yml（配置层）。
 *
 * patch 里本向导托管的条目（模型位、agent 默认模型、生产端配置、skills 挂载、
 * 凭据开关）每次装机重写；其余条目原样保留——用户手加的条目不该被装机冲掉。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

/** 本向导托管的 patch 条目 id。 */
export const MANAGED_ENTRY_IDS = ['llm-pi-ai', 'agent-default-model', 'trend-producer', 'skill-filesystem', 'credentials']

/**
 * 平台 bundle：base 打底 + web-app 提供生产应用面。
 *
 * **用 web 应用面而不是 headless**：headless 是一次性任务执行器，没有命令分发，
 * 教员没法触发 `/trend login`，也没有任何操作界面——而教员要的正是装完就有的
 * 图形界面。web 应用面提供浏览器界面、右侧栏与审批 UI，生产端的面板就挂在
 * 右侧栏上（见 §11 面板）。
 *
 * bundle 从 dsh 安装本体解析（安装包已带 dsh-web-app），profile 里不再重复声明
 * 依赖——装机因此不需要额外访问 npm registry。
 */
export const PLATFORM_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/**
 * 换应用面时必须撤下的旧 bundle：headless 与 web-app 各自提供应用行，
 * 两个都留在 profile 里会同时挂出两个应用面，行为取决于加载顺序。
 */
export const RETIRED_BUNDLES = ['@deepseek-ai/dsh-headless']

/**
 * 环境按云端地址推导，不让教员手填。
 *
 * 面板的「云端」卡片直接显示这个值——写死 local 会让指着生产云端的教员看到
 * 「local」，是假信息。回环即本机；非回环且是 https 即生产；非回环但非 https
 * 仍是 local（局域网自建云端没有环境名可归）。
 */
export function environmentFor(baseUrl) {
  try {
    const { hostname, protocol } = new URL(baseUrl)
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    if (loopback) return 'local'
    return protocol === 'https:' ? 'production' : 'local'
  } catch {
    return 'local'
  }
}

const PATCH_HEADER = '# 本文件由 `pnpm setup` 生成：托管条目每次装机重写，其余条目原样保留。\n'

/**
 * 托管条目：单一模型位同时供 agent 与理解阶段使用。
 * @param {{model: object, cloud: object, tokenRef: string, skillsDir: string}} config
 */
export function buildManagedEntries(config) {
  const { model, cloud, tokenRef, skillsDir } = config
  return [
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          [model.provider]: {
            apiKeyEnv: model.keyRef,
            api: model.api,
            baseURL: model.baseUrl,
            models: [{ id: model.id, name: model.name, contextWindow: model.contextWindow }],
          },
        },
      },
    },
    {
      id: 'agent-default-model',
      config: { provider: model.provider, model: model.id },
    },
    {
      id: 'trend-producer',
      config: {
        environment: cloud.environment,
        baseUrl: cloud.baseUrl,
        consoleTokenRef: tokenRef,
        understanding: {
          apiKeyEnv: model.keyRef,
          api: model.api,
          baseUrl: model.baseUrl,
          model: model.id,
          maxTokens: model.maxTokens,
          frameEveryNth: model.frameEveryNth,
        },
      },
    },
    {
      id: 'skill-filesystem',
      // 显式启用：宿主层这一行被禁时，工艺包会静默不加载
      disabled: false,
      config: { customSkillDirs: [skillsDir] },
    },
    {
      id: 'credentials',
      disabled: false,
    },
  ]
}

/** 读 patch 文件；不存在时返回空数组。 */
export function readPatch(file) {
  if (!existsSync(file)) return []
  const parsed = YAML.parse(readFileSync(file, 'utf8'))
  if (parsed === null || parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error(`patch 文件不是条目数组：${file}`)
  return parsed.filter(entry => typeof entry === 'object' && entry !== null)
}

/** 合并：托管条目替换同名旧条目，用户条目原样保留。 */
export function mergePatchEntries(existing, managed) {
  const managedIds = new Set(managed.map(entry => String(entry.id)))
  const kept = existing.filter(entry => !managedIds.has(String(entry.id)))
  return [...managed, ...kept]
}

export function renderPatch(entries) {
  return `${PATCH_HEADER}${YAML.stringify(entries, { lineWidth: 0 })}`
}

/** 写 patch：先备份旧文件，便于回滚手改内容。 */
export function writePatch(file, entries) {
  mkdirSync(path.dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.bak`)
  writeFileSync(file, renderPatch(entries), 'utf8')
}

/**
 * 写 profile 的 package.json：插件依赖 + bundle 列表。
 * bundle 列表是并集——已有的平台 bundle 不丢，装机只补齐缺的；
 * 但换应用面时留下的旧 bundle（RETIRED_BUNDLES）必须撤掉，否则两个应用面同时挂载。
 */
export function writeProfilePackage(dir, pluginName, tarball) {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'package.json')
  let manifest = {}
  if (existsSync(file)) manifest = JSON.parse(readFileSync(file, 'utf8'))
  const dependencies = { ...manifest.dependencies, [pluginName]: `file:${tarball}` }
  const dsh = { ...manifest.dsh }
  const profile = { ...dsh.profile }
  const existing = Array.isArray(profile.bundles) ? profile.bundles : []
  const bundles = existing.filter(bundle => !RETIRED_BUNDLES.includes(bundle))
  for (const bundle of [...PLATFORM_BUNDLES, pluginName]) {
    if (!bundles.includes(bundle)) bundles.push(bundle)
  }
  const next = {
    ...manifest,
    name: manifest.name ?? `dsh-profile-${path.basename(dir)}`,
    private: true,
    dependencies,
    dsh: { ...dsh, profile: { ...profile, bundles } },
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** 从 patch 里读回托管配置（自检用；文件被手改过时读到的就是手改后的值）。 */
export function readManagedConfig(file) {
  const entries = readPatch(file)
  const llm = entries.find(entry => String(entry.id) === 'llm-pi-ai')
  const providers = llm === undefined ? {} : llm.config?.providers ?? {}
  const providerEntry = Object.entries(providers)[0]
  const models = providerEntry === undefined ? [] : providerEntry[1].models ?? []
  const producer = entries.find(entry => String(entry.id) === 'trend-producer')
  const producerConfig = producer?.config ?? {}
  const skills = entries.find(entry => String(entry.id) === 'skill-filesystem')
  return {
    model: providerEntry === undefined
      ? null
      : {
          provider: providerEntry[0],
          id: String(models[0]?.id ?? ''),
          api: String(providerEntry[1].api ?? ''),
          baseUrl: String(providerEntry[1].baseURL ?? ''),
          keyRef: String(providerEntry[1].apiKeyEnv ?? ''),
        },
    cloud: {
      baseUrl: String(producerConfig.baseUrl ?? ''),
      environment: String(producerConfig.environment ?? ''),
      tokenRef: String(producerConfig.consoleTokenRef ?? ''),
    },
    understanding: {
      api: String(producerConfig.understanding?.api ?? ''),
      baseUrl: String(producerConfig.understanding?.baseUrl ?? ''),
    },
    skillsDirs: skills?.config?.customSkillDirs ?? [],
  }
}
