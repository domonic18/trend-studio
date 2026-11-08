#!/usr/bin/env node
// 产出可被 npm/dsh 独立安装的 tarball：workspace:* 依赖在包内不可解析，
// 且 pnpm 隔离布局下直接 npm pack 会打成 ../../ 破损路径。故采用暂存目录：
// 改写 package.json 去掉 workspace 依赖、把运行期需要的 zod 提为正式依赖，
// 再在暂存目录内以 cwd 执行 npm pack。
//
// lib/client/ 是 tsc 对 src/client 的逐文件产物，已被 esbuild 打成 lib/client.js
// （那才是包真正暴露的客户端入口，见 package.json 的 exports["./client"]）。
// 逐文件产物仍 import @trend/widgets——包外取不到，装上即崩，且是死代码：
// 不进包。
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const coachDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(coachDir, '../..')

/** 进包的文件（与 package.json 的 files 字段保持一致）。 */
const PACKED_FILES = ['cordis.patch.yml', 'README.md']
/** lib/ 下不进包的子目录（见文件头说明）。 */
const LIB_EXCLUDED = new Set(['client'])

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
  }
}

// 客户端包依赖 @trend/widgets 的类型与产物，widgets 必须先构建。
run('pnpm', ['--filter', '@trend/widgets', 'build'], repoRoot)
run('pnpm', ['--filter', 'dsh-plugin-trend-coach', 'build'], repoRoot)

const stage = mkdtempSync(path.join(tmpdir(), 'trend-coach-pack-'))
try {
  mkdirSync(path.join(stage, 'lib'), { recursive: true })
  for (const entry of readdirSync(path.join(coachDir, 'lib'))) {
    if (LIB_EXCLUDED.has(entry)) continue
    cpSync(path.join(coachDir, 'lib', entry), path.join(stage, 'lib', entry), { recursive: true })
  }
  for (const file of PACKED_FILES) {
    cpSync(path.join(coachDir, file), path.join(stage, file))
  }

  const pkg = JSON.parse(readFileSync(path.join(coachDir, 'package.json'), 'utf8'))
  // zod 是客户端包的运行期依赖（esbuild 把它标成 external，运行时才 require），
  // 原先挂在 devDependencies——包外安装取不到，提为正式依赖。
  pkg.dependencies = { ...pkg.dependencies, zod: pkg.devDependencies.zod }
  // @trend/widgets 是 workspace 包：构建期已被 esbuild 打进 lib/client.js，
  // 运行期不再需要；留着 workspace: 协议会让 npm pack 直接失败。
  delete pkg.devDependencies['@trend/widgets']
  delete pkg.devDependencies.zod
  writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  // npm pack 以目录为参数时会剥离 node_modules，必须在 stage 内以 cwd 执行
  run('npm', ['pack', '--pack-destination', coachDir], stage)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
