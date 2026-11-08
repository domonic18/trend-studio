import { Readable } from 'node:stream'
import { Client } from 'minio'
import type { CosConfig } from '../config.js'

/** 预签名 URL 的最长有效期（S3 协议上限 7 天）。 */
const MAX_PRESIGN_SEC = 7 * 24 * 60 * 60

export interface CosObjectMeta {
  size: number
  contentType?: string
}

export interface CosStore {
  readonly bucket: string
  /** 短时直连地址；播放器据此绕过应用机直取分片。 */
  presignedGet(key: string, expiresSec: number): Promise<string>
  stat(key: string): Promise<CosObjectMeta | undefined>
  getBuffer(key: string): Promise<Buffer | undefined>
  getStream(key: string, range?: { start: number; end: number }): Promise<Readable | undefined>
  put(key: string, body: Buffer, contentType?: string): Promise<void>
  remove(key: string): Promise<void>
}

export function createCosStore(config: CosConfig, client?: Client): CosStore {
  const sdk = client ?? new Client({
    endPoint: config.endpoint,
    accessKey: config.secretId,
    secretKey: config.secretKey,
    region: config.region,
    useSSL: config.secure,
    // COS 只认 virtual-host 寻址；path-style 会被拒绝
    pathStyle: !config.virtualHost,
  })
  return new MinioCosStore(sdk, config.bucket)
}

class MinioCosStore implements CosStore {
  constructor(
    private readonly client: Client,
    readonly bucket: string,
  ) {}

  async presignedGet(key: string, expiresSec: number): Promise<string> {
    const expires = Math.min(Math.max(Math.floor(expiresSec), 1), MAX_PRESIGN_SEC)
    return this.client.presignedGetObject(this.bucket, key, expires)
  }

  async stat(key: string): Promise<CosObjectMeta | undefined> {
    try {
      const info = await this.client.statObject(this.bucket, key)
      const contentType = info.metaData?.['content-type']
      return {
        size: info.size,
        ...(typeof contentType === 'string' ? { contentType } : {}),
      }
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async getBuffer(key: string): Promise<Buffer | undefined> {
    const stream = await this.getStream(key)
    if (stream === undefined) return undefined
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable | undefined> {
    try {
      if (range === undefined) {
        return await this.client.getObject(this.bucket, key)
      }
      const length = range.end - range.start + 1
      return await this.client.getPartialObject(this.bucket, key, range.start, length)
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.putObject(
      this.bucket,
      key,
      body,
      body.length,
      contentType === undefined ? undefined : { 'Content-Type': contentType },
    )
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code
  return code === 'NoSuchKey' || code === 'NotFound'
}
