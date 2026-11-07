/**
 * 素材直传：本地文件 → 摘要 → 签发凭据 → 流式 PUT → 落库确认。
 * 字节以流式 body 直送云端，插件进程不做整份缓冲；摘要与上传分两趟读盘，
 * 因为凭据把摘要绑进了签名——摘要未定就不能签发。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { InputError, UpstreamError } from '../errors.js'
import type { TrendCloudClient } from './cloud-client.js'

/** 直传超时：视频体量大、云端落盘慢，默认 15 分钟。 */
const UPLOAD_TIMEOUT_MS = 15 * 60_000

export interface AssetUploadResult {
  assetId: string
  sizeBytes: number
  sha256: string
  status: string
}

export class AssetUploader {
  constructor(private readonly client: TrendCloudClient) {}

  async upload(input: { assetId: string; path: string }, signal?: AbortSignal): Promise<AssetUploadResult> {
    const sizeBytes = await fileSize(input.path)
    const sha256 = await digestFile(input.path)

    const ticket = await this.client.issueUploadTicket(
      { assetId: input.assetId, sizeBytes, sha256 },
      signal,
    )
    await this.put(ticket.uploadUrl, ticket.headers, sha256, input.path, signal)
    const confirmed = await this.client.confirmUpload(
      { assetId: input.assetId, sizeBytes, sha256 },
      signal,
    )
    return { assetId: input.assetId, sizeBytes, sha256, status: confirmed.asset.status }
  }

  private async put(
    uploadUrl: string,
    ticketHeaders: Record<string, string>,
    sha256: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.client.putStream(
        uploadTarget(uploadUrl),
        { ...ticketHeaders, 'x-file-sha256': sha256 },
        createReadStream(path),
        UPLOAD_TIMEOUT_MS,
        signal,
      )
    } catch (error) {
      // 凭据无效/过期与「会话失效」是两回事，错误文案必须分开，否则模型会去换令牌。
      if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
        throw new UpstreamError(
          error.status,
          'upload_ticket_invalid',
          error.detail,
          '直传凭据无效或已过期，请重新签发后重试',
        )
      }
      throw error
    }
  }
}

/**
 * 直传地址取「路径 + 查询」而非整条 URL：云端签发的 URL 走 publicBaseUrl，
 * 与生产端实际配置的云端地址可能不同（本地/隧道），只取路径才不会打错主机。
 */
function uploadTarget(uploadUrl: string): string {
  let url: URL
  try {
    url = new URL(uploadUrl)
  } catch {
    throw new InputError('云端签发的直传地址不是合法 URL')
  }
  return `${url.pathname}${url.search}`
}

async function fileSize(path: string): Promise<number> {
  let info
  try {
    info = await stat(path)
  } catch (error) {
    throw new InputError(`读取上传文件失败: ${path}（${(error as Error).message}）`)
  }
  if (!info.isFile()) throw new InputError(`上传路径不是普通文件: ${path}`)
  return info.size
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk)
  } catch (error) {
    throw new InputError(`计算上传文件摘要失败: ${path}（${(error as Error).message}）`)
  }
  return hash.digest('hex')
}
