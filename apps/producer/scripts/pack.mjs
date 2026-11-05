#!/usr/bin/env node
// 产出可被 npm/dsh 独立安装的 tarball：workspace:* 依赖在包内不可解析，
// 且 pnpm isolated linker 不支持 bundleDependencies（npm pack 直打会产生
// ../../ 破损路径）。故采用暂存目录：手工把 @trend/contracts 的构建产物
// 摆进 stage/node_modules 再 npm pack。
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const producerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(producerDir, '../..')
const contractsDir = path.join(repoRoot, 'packages/contracts')

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
  for (const f of ['lib', 'cordis.patch.yml', 'README.md']) {
    cpSync(path.join(producerDir, f), path.join(stage, f), { recursive: true })
  }

  const pkg = JSON.parse(readFileSync(path.join(producerDir, 'package.json'), 'utf8'))
  pkg.dependencies['@trend/contracts'] = '*'
  pkg.bundleDependencies = ['@trend/contracts']
  writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  const nested = path.join(stage, 'node_modules/@trend/contracts')
  mkdirSync(nested, { recursive: true })
  cpSync(path.join(contractsDir, 'lib'), path.join(nested, 'lib'), { recursive: true })
  cpSync(path.join(contractsDir, 'package.json'), path.join(nested, 'package.json'))

  // npm pack 以目录为参数时会剥离 node_modules（bundleDependencies 不生效），必须在 stage 内以 cwd 执行
  run('npm', ['pack', '--pack-destination', producerDir], stage)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
