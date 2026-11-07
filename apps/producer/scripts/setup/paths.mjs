/** 装机向导用到的路径真相源：dsh home、profile 目录、凭据文件、仓库内 skills 目录。 */
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/producer 根目录（本文件位于 scripts/setup/ 下）。 */
export const producerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** monorepo 根目录。 */
export const repoRoot = path.resolve(producerDir, '..', '..')

/** 技能包活挂载目录：装到 profile 后 dsh 从这里读 SKILL.md。 */
export const skillsDir = path.join(producerDir, 'skills')

export function dshHome() {
  const fromEnv = process.env.DSH_HOME?.trim()
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : path.join(homedir(), '.dsh')
}

export function profileDir(profile) {
  return path.join(dshHome(), 'profiles', profile)
}

/** dsh 的托管凭据文件（provider-managed：refs + records）。 */
export function credentialsFile() {
  return path.join(dshHome(), '.credentials.yaml')
}
