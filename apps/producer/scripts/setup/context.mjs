/**
 * 装机上下文：仓库模式 vs 免仓库模式。
 *
 * 仓库模式（monorepo 里跑 `pnpm setup`）：工艺包就在仓库里，patch 直接指向仓库
 * 路径——改完 SKILL.md 立刻生效，不用重装。
 *
 * 免仓库模式（官网下载 tgz → 解包 → 跑 `package/scripts/setup.mjs`）：包里带着
 * 工艺包与装机脚本，装机时把工艺包复制进 profile 目录，patch 指向那份副本——
 * 脱离仓库后工艺包不会凭空消失，也不会指向不存在的路径。
 *
 * 判据是 pack.mjs：它是仓库里的打包脚本，本身不进包。有它就是仓库模式。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { profileDir as resolveProfileDir } from './paths.mjs'

/** 仓库模式的判据：pack.mjs 只在仓库里有。 */
export function isRepoPackage(packageDir) {
  return existsSync(path.join(packageDir, 'scripts', 'pack.mjs'))
}

/** 在下载目录里找生产插件的 tgz：同版本优先，其次最新一个。 */
export function findDownloadedTarball(packageDir, version) {
  const parent = path.dirname(packageDir)
  if (!existsSync(parent)) return null
  const prefix = 'dsh-plugin-trend-producer-'
  const candidates = readdirSync(parent)
    .filter(name => name.startsWith(prefix) && name.endsWith('.tgz'))
    .map(name => path.join(parent, name))
  if (candidates.length === 0) return null
  const exact = candidates.find(file => path.basename(file) === `${prefix}${version}.tgz`)
  if (exact !== undefined) return exact
  return candidates
    .map(file => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].file
}

/**
 * 解析装机上下文。
 *
 * @param {{packageDir: string, profile: string, tarballOption?: string, profileDir?: string}} input
 * @returns {{mode: 'repo'|'standalone', pluginName: string, pluginVersion: string,
 *   tarball: string|null, skillsSourceDir: string, skillsTargetDir: string, copySkills: boolean}}
 */
export function resolveInstallContext(input) {
  const { packageDir, profile, tarballOption } = input
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  const pluginName = manifest.name
  const pluginVersion = manifest.version
  const skillsSourceDir = path.join(packageDir, 'skills')

  // 显式指定安装包 → 免仓库模式（教员下载的 tgz）
  if (tarballOption !== undefined && tarballOption !== '') {
    const dir = input.profileDir ?? resolveProfileDir(profile)
    return {
      mode: 'standalone',
      pluginName,
      pluginVersion,
      tarball: path.resolve(tarballOption),
      skillsSourceDir,
      skillsTargetDir: path.join(dir, 'skills'),
      copySkills: true,
    }
  }

  if (isRepoPackage(packageDir)) {
    return {
      mode: 'repo',
      pluginName,
      pluginVersion,
      tarball: null,
      skillsSourceDir,
      skillsTargetDir: skillsSourceDir,
      copySkills: false,
    }
  }

  const dir = input.profileDir ?? resolveProfileDir(profile)
  const tarball = findDownloadedTarball(packageDir, pluginVersion)
  if (tarball === null) {
    throw new Error(
      `找不到生产插件安装包（${path.join(path.dirname(packageDir), 'dsh-plugin-trend-producer-*.tgz')}）——` +
      '用 --tarball 指定路径，或从官网重新下载安装包后解压再跑',
    )
  }
  return {
    mode: 'standalone',
    pluginName,
    pluginVersion,
    tarball,
    skillsSourceDir,
    skillsTargetDir: path.join(dir, 'skills'),
    copySkills: true,
  }
}
