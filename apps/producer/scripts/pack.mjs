#!/usr/bin/env node
// 产出可被 npm/dsh 独立安装的 tarball：workspace:* 依赖在包内不可解析，
// 且 pnpm isolated linker 不支持 bundleDependencies（npm pack 直打会产生
// ../../ 破损路径）。故采用暂存目录：手工把 @trend/contracts 的构建产物
// 摆进 stage/node_modules 再 npm pack。
//
// 包内还带两样教员侧免仓库安装要用的东西：
// - skills/：九个工艺包。脱离仓库安装时它们必须跟着包走，否则 dsh 挂载不到任何技能。
// - scripts/setup*.mjs：装机向导，装机脚本要能被教员直接跑。
// yaml（patch 文件的读写依赖）也一并 bundle——它是 devDependency，包外取不到。
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const producerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(producerDir, '../..')
const contractsDir = path.join(repoRoot, 'packages/contracts')

/** 进包的目录与文件（与 package.json 的 files 字段保持一致）。 */
const PACKED_FILES = ['lib', 'cordis.patch.yml', 'README.md', 'skills', 'scripts/setup.mjs', 'scripts/setup']

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
  }
}

run('pnpm', ['--filter', '@trend/contracts', 'build'], repoRoot)
run('pnpm', ['--filter', 'dsh-plugin-trend-producer', 'build'], repoRoot)

const stage = mkdtempSync(path.join(tmpdir(), 'trend-producer-pack-'))
try {
  for (const f of PACKED_FILES) {
    cpSync(path.join(producerDir, f), path.join(stage, f), { recursive: true })
  }

  const pkg = JSON.parse(readFileSync(path.join(producerDir, 'package.json'), 'utf8'))
  pkg.dependencies['@trend/contracts'] = '*'

  // yaml 是装机脚本的运行时依赖（仓库里是 devDependency），随包 bundle 才有。
  const yamlDir = realpathSync(path.join(producerDir, 'node_modules', 'yaml'))
  pkg.dependencies.yaml = JSON.parse(readFileSync(path.join(yamlDir, 'package.json'), 'utf8')).version
  delete pkg.devDependencies.yaml
  pkg.bundleDependencies = ['@trend/contracts', 'yaml']
  writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  const nested = path.join(stage, 'node_modules/@trend/contracts')
  mkdirSync(nested, { recursive: true })
  cpSync(path.join(contractsDir, 'lib'), path.join(nested, 'lib'), { recursive: true })
  cpSync(path.join(contractsDir, 'package.json'), path.join(nested, 'package.json'))

  // pnpm 的 node_modules 是指向 .pnpm 的符号链接，直接打进包会是悬空链接——解引用后再拷。
  cpSync(yamlDir, path.join(stage, 'node_modules/yaml'), { recursive: true, dereference: true })

  // npm pack 以目录为参数时会剥离 node_modules（bundleDependencies 不生效），必须在 stage 内以 cwd 执行
  run('npm', ['pack', '--pack-destination', producerDir], stage)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
