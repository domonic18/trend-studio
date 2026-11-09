/**
 * dsh 托管凭据库（~/.dsh/.credentials.yaml）的读写。
 *
 * 插件按 credential-ref 引用机密（模型密钥、云端会话令牌），值只落这里——
 * 装机向导负责写，用户不碰配置文件。写入用 YAML 文档 API，保留文件里
 * 其他条目（其他 profile 的密钥、records）的原样排布。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

/** dsh 凭据服务拒绝加载「所有者之外可读」的凭据库——权限不对等于没装。 */
export const CREDENTIALS_MODE = 0o600

export function readRef(file, ref) {
  if (!existsSync(file)) return null
  const parsed = YAML.parse(readFileSync(file, 'utf8'))
  const value = parsed?.refs?.[ref]
  return typeof value === 'string' && value !== '' ? value : null
}

/** 写入一个 ref；文件不存在时建一份 version 1 的新库。 */
export function writeRef(file, ref, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const text = existsSync(file) ? readFileSync(file, 'utf8') : 'version: 1\n'
  const doc = YAML.parseDocument(text)
  doc.set('version', 1)
  doc.setIn(['refs', ref], value)
  writeFileSync(file, doc.toString(), { encoding: 'utf8', mode: CREDENTIALS_MODE })
  // 已有文件的权限不会被 writeFileSync 改掉，得显式收紧。
  chmodSync(file, CREDENTIALS_MODE)
}

/** 只看 ref 名是否已配置（不取值，避免值进日志）。 */
export function hasRef(file, ref) {
  return readRef(file, ref) !== null
}

/**
 * 读教员端 console 凭据记录（records['trend-producer/console']）。
 * 与 dsh-credentials-local 的落盘形状一致；损坏或缺失返回 null。
 */
export function readConsoleGrantRecord(file) {
  if (!existsSync(file)) return null
  const parsed = YAML.parse(readFileSync(file, 'utf8'))
  const record = parsed?.records?.['trend-producer/console']
  if (record?.kind !== 'grant') return null
  const payload = record.payload
  if (typeof payload?.token !== 'string' || payload.token === '') return null
  if (typeof payload?.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt)) return null
  const user = payload?.user
  if (typeof user?.userId !== 'string' || typeof user?.username !== 'string' || typeof user?.role !== 'string') return null
  return {
    token: payload.token,
    expiresAt: payload.expiresAt,
    user: { userId: user.userId, username: user.username, role: user.role },
  }
}
