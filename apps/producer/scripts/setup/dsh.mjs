/**
 * dsh（harness）命令的解析：PATH 里有就用它，否则 npx 拉指定版本。
 *
 * 教员机不必预装 dsh——装机向导自己能把 harness 拉起来。
 * 版本取插件 package.json 的 engines.dsh，与官网发布的 harness 版本一致。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { producerDir } from './paths.mjs'

/** npx 兜底时用的 dsh 版本。 */
export const DSH_VERSION = '0.2.1-rc.5'

/** 插件声明的 dsh 版本。 */
export function dshVersion() {
  const manifest = JSON.parse(readFileSync(path.join(producerDir, 'package.json'), 'utf8'))
  return manifest.engines?.dsh ?? DSH_VERSION
}

/** PATH 里有没有 dsh 可执行文件。 */
export function hasDshOnPath() {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(dir => dir !== '')
  return dirs.some(dir => existsSync(path.join(dir, 'dsh')))
}

/** dsh 命令：PATH 里有就用它，否则 npx 拉指定版本。 */
export function dshCommand() {
  if (hasDshOnPath()) return { command: 'dsh', args: [] }
  return { command: 'npx', args: ['--yes', `@deepseek-ai/dsh@${dshVersion()}`] }
}

/**
 * 跑 dsh。默认继承 stdio；要捕获输出就传 encoding（此时默认 pipe）。
 */
export function runDsh(args, options = {}) {
  const { command, args: prefix } = dshCommand()
  const spawnOptions = { ...options }
  if (spawnOptions.stdio === undefined && spawnOptions.encoding === undefined) {
    spawnOptions.stdio = 'inherit'
  }
  return spawnSync(command, [...prefix, ...args], spawnOptions)
}
