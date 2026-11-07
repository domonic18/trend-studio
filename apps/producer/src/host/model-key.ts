/**
 * 视觉模型密钥解析：凭据服务优先（托管库 → 环境层），进程环境兜底。
 *
 * 装机向导把模型密钥写进 dsh 托管凭据库的 refs，profile 里只留引用名——
 * 这里按引用名解析，取不到再退到进程环境（老配置仍然能跑）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName, type CredentialProvider } from '@deepseek-ai/dsh-credentials'

export type ModelKeyResolver = (ref: string) => Promise<string | undefined>

export function createModelKeyResolver(ctx: Context): ModelKeyResolver {
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  return async (ref: string): Promise<string | undefined> => {
    if (credentials !== undefined && isCredentialRefName(ref)) {
      const hit = await credentials.resolve(credentialRef(ref))
      if (hit !== undefined && hit.value !== '') return hit.value
    }
    const fromEnv = process.env[ref]
    return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined
  }
}
