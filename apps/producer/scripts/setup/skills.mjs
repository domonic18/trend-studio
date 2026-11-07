/**
 * 工艺包（skills）的列举与安装。
 *
 * 只有含 SKILL.md 的子目录才算工艺包——附属文件跟着整目录一起复制，
 * 目录里没有 SKILL.md 的（临时目录、编辑器产物）不带过去。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

/** 列出目录下的工艺包名（含 SKILL.md 的子目录名）。 */
export function listSkills(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort()
}

/**
 * 把工艺包复制到目标目录；返回复制过去的包名。
 *
 * 目标目录是装机器自己的地盘——上一次装留下的、这次不存在的工艺包要清掉，
 * 否则自检数出来的个数会虚高。
 */
export function installSkills(source, target) {
  const names = listSkills(source)
  if (names.length === 0) {
    throw new Error(`安装包里没有工艺包（${source}）——重新下载完整的安装包`)
  }
  mkdirSync(target, { recursive: true })
  const keep = new Set(names)
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue
    if (existsSync(path.join(target, entry.name, 'SKILL.md'))) {
      rmSync(path.join(target, entry.name), { recursive: true, force: true })
    }
  }
  for (const name of names) {
    cpSync(path.join(source, name), path.join(target, name), { recursive: true })
  }
  return names
}
