#!/usr/bin/env node
/**
 * 发布插件到官网下载区，并把版本与校验写回发布清单。
 *
 *   node scripts/publish-plugin.mjs --plugin coach
 *   node scripts/publish-plugin.mjs --plugin producer --notes "本次改动说明"
 *   node scripts/publish-plugin.mjs --plugin coach --dry-run   # 只算不改
 *
 * 学员插件（coach）与教员生产端插件（producer）是两个制品，发布清单里各占
 * 一个字段、形状相同。本脚本一次只改自己那一个，另一个一字不动。
 *
 * 清单是每次请求现读的，改完无需重启服务。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cloudDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(cloudDir, '..', '..')
const downloadsDir = path.join(cloudDir, 'dist', 'downloads')
const manifestFile = path.join(cloudDir, 'content', 'releases.json')

/** 制品 → 打包脚本所在包 + 清单字段。 */
const PLUGINS = {
  coach: { app: 'coach', key: 'plugin' },
  producer: { app: 'producer', key: 'producerPlugin' },
}

function parseArgs(argv) {
  const options = { plugin: '', dryRun: false, notes: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--plugin') options.plugin = argv[++i] ?? ''
    else if (arg === '--dry-run') options.dryRun = true
    // 可重复给；早先的一次不能被后一次悄悄覆盖。
    else if (arg === '--notes') options.notes.unshift(argv[++i] ?? '')
  }
  return options
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退出码 ${result.status}`)
}

const options = parseArgs(process.argv.slice(2))
const target = PLUGINS[options.plugin]
if (!target) {
  throw new Error(`未知插件：${options.plugin || '(空)'}（可用：${Object.keys(PLUGINS).join(' / ')}）`)
}
const appDir = path.join(repoRoot, 'apps', target.app)

// ① 打包
run('node', [path.join(appDir, 'scripts', 'pack.mjs')], repoRoot)

const appManifest = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'))
const version = appManifest.version
const fileName = `${appManifest.name}-${version}.tgz`
const tarball = path.join(appDir, fileName)
if (!existsSync(tarball)) throw new Error(`打包产物不存在：${tarball}`)

// ② 算校验与体积
const digest = sha256(tarball)
const sizeBytes = statSync(tarball).size

// ③ 落下载区
if (!options.dryRun) {
  mkdirSync(downloadsDir, { recursive: true })
  copyFileSync(tarball, path.join(downloadsDir, fileName))
}

// ④ 改写清单里自己那一个字段
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
// 发布日期按本地日期写（与运营口径一致；UTC 日期在本地傍晚发布会差一天）。
const now = new Date()
const publishedAt = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-')
// 未给 --notes 时沿用旧说明；给了就前置（新说明在前，最新的排最前）。
const previous = manifest[target.key]?.notes ?? []
const notes = (options.notes.length > 0
  ? [...options.notes, ...previous]
  : previous).slice(0, 20)

manifest[target.key] = {
  name: appManifest.name,
  version,
  fileName,
  sha256: digest,
  sizeBytes,
  publishedAt,
  notes,
}
if (!options.dryRun) {
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

// ⑤ 回执
const kb = (sizeBytes / 1024).toFixed(1)
const otherKey = target.key === 'plugin' ? 'producerPlugin' : 'plugin'
process.stdout.write(
  [
    options.dryRun ? '（试跑，未落盘）' : `已发布${target.app}插件`,
    `  版本    ${version}`,
    `  文件    ${fileName}`,
    `  体积    ${kb} kB`,
    `  sha256  ${digest}`,
    `  下载    /downloads/${fileName}`,
    options.dryRun ? '' : `  清单    ${manifestFile}（${target.key} 已更新，${otherKey} 未动）`,
    options.dryRun ? '' : '  提示    清单每次请求现读，无需重启服务',
    '',
  ].filter(line => line !== '').join('\n'),
)
