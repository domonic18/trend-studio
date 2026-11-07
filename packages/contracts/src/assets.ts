/**
 * 素材入库契约（生产体验线）：建素材 → 签发直传凭据 → 直传字节 → 确认落库 → 入队转写。
 * 素材状态与语言枚举在此定版，云端与生产端共用同一份真相源。
 */

import { z } from 'zod'
import { pipelineJob } from './admin.js'
import { ASSET_ID } from './ids.js'

const assetId = z.string().regex(ASSET_ID, 'assetId 格式不合法')
const SHA256 = /^[0-9a-f]{64}$/

export const ASSET_STATUSES = [
  'awaiting_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'archived',
] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_LANGUAGES = ['zh', 'en', 'auto'] as const
export type AssetLanguage = (typeof ASSET_LANGUAGES)[number]

export const mediaAssetDto = z.object({
  assetId,
  courseId: z.string().min(1).max(64),
  title: z.string().max(200).nullable(),
  status: z.enum(ASSET_STATUSES),
  durationMs: z.number().int().nonnegative().nullable(),
  sourceSizeBytes: z.number().int().nonnegative().nullable(),
  errorCode: z.string().max(64).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

export const mediaAssetCreateInput = z.object({
  courseId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
}).strict()

export const mediaAssetCreateOutput = z.object({ asset: mediaAssetDto }).strict()

export const mediaAssetListInput = z.object({
  courseId: z.string().min(1).max(64),
  status: z.enum(ASSET_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

export const mediaAssetListOutput = z.object({
  assets: z.array(mediaAssetDto),
  total: z.number().int().nonnegative(),
}).strict()

/**
 * 直传凭据：云端把「素材 + 字节数 + 摘要 + 有效期」签进签名，
 * 客户端凭 URL 与 header 直传原始字节，凭据本身即授权（短时效、不可挪用到别的素材）。
 */
export const uploadTicketInput = z.object({
  assetId,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256, 'sha256 必须是 64 位小写 hex'),
}).strict()

export const uploadTicketOutput = z.object({
  assetId,
  uploadUrl: z.string().min(1).max(2000),
  method: z.literal('PUT'),
  headers: z.record(z.string().max(100), z.string().max(512)),
  expiresAt: z.number().int().positive(),
}).strict()

/** 落库确认：核对云端已落字节数与摘要是否与客户端声明一致，不一致即拒。 */
export const uploadConfirmInput = z.object({
  assetId,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256, 'sha256 必须是 64 位小写 hex'),
}).strict()

export const uploadConfirmOutput = z.object({ asset: mediaAssetDto }).strict()

export const assetIngestInput = z.object({
  assetId,
  language: z.enum(ASSET_LANGUAGES).optional(),
}).strict()

export const assetIngestOutput = z.object({ job: pipelineJob }).strict()

export type MediaAssetDto = z.infer<typeof mediaAssetDto>
export type MediaAssetCreateOutput = z.infer<typeof mediaAssetCreateOutput>
export type MediaAssetListOutput = z.infer<typeof mediaAssetListOutput>
export type UploadTicketOutput = z.infer<typeof uploadTicketOutput>
export type UploadConfirmOutput = z.infer<typeof uploadConfirmOutput>
export type AssetIngestOutput = z.infer<typeof assetIngestOutput>
