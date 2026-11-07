/**
 * 发布清单契约：门户与管理台对外公布的制品版本与下载地址。
 *
 * 学员插件（plugin）与教员生产端插件（producerPlugin）是两个制品，条目形状相同——
 * 两边从同一份清单拿到自己那一份。
 */

import { z } from 'zod'

/** 清单缺失或该字段坏掉时的 harness 回落版本。 */
export const DEFAULT_DSH_VERSION = '0.2.1-rc.5'

/** 清单缺失或该字段坏掉时的 Web 应用包回落名。 */
export const DEFAULT_WEB_APP_PACKAGE = '@deepseek-ai/dsh-web-app'

/**
 * 制品条目：插件 tarball 的版本、文件名与校验信息。
 *
 * sha256 / sizeBytes 可空——制品还没算校验时允许先挂版本号；
 * 但类型不对（sha256 写成数字、sizeBytes 写成字符串）是坏数据，整份清单作废。
 */
export const releaseArtifactSchema = z.object({
  name: z.string(),
  version: z.string(),
  fileName: z.string(),
  /** 制品 sha256（十六进制）；未统计时为 null。 */
  sha256: z.string().nullish().transform(value => value ?? null),
  /** 制品字节数；未统计时为 null。 */
  sizeBytes: z.number().nullish().transform(value => value ?? null),
  publishedAt: z.string(),
  /** 发布说明；非字符串条目丢弃，最多留 20 条。 */
  notes: z.preprocess(
    value => (Array.isArray(value)
      ? value.filter((note): note is string => typeof note === 'string').slice(0, 20)
      : []),
    z.array(z.string()),
  ),
})

/**
 * 发布清单。
 *
 * 宽容度与手写校验一致：dshVersion / webAppPackage 坏掉回落默认值，
 * plugin 与 producerPlugin 坏掉则整份清单作废（门户 503），不猜。
 */
export const releaseManifestSchema = z.preprocess(
  // 历史上数组也被当成“空清单”放行，这里保持同一宽容度。
  raw => (Array.isArray(raw) ? {} : raw),
  z.object({
    dshVersion: z.string().catch(DEFAULT_DSH_VERSION),
    webAppPackage: z.string().catch(DEFAULT_WEB_APP_PACKAGE),
    plugin: releaseArtifactSchema.nullish().transform(value => value ?? null),
    producerPlugin: releaseArtifactSchema.nullish().transform(value => value ?? null),
  }),
)

export type ReleaseArtifact = z.infer<typeof releaseArtifactSchema>
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>
