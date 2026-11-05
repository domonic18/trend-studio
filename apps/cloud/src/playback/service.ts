import type { Pool } from 'pg'
import type { AppConfig } from '../config.js'
import type { AuthService, Principal } from '../auth/service.js'
import type { SessionPrincipal } from '../accounts/service.js'
import { randomToken } from '../auth/tokens.js'
import { badRequest, HttpError, tooManyRequests } from '../errors.js'
import { parseSegmentId } from '../kb/service.js'
import { signPlaybackToken } from './sign.js'

export interface PlaybackSessionOut {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark: { label: string }
}

export interface AssetPlaybackWindow {
  fromSec?: number
  toSec?: number
}

export interface AssetPlaybackSessionOut {
  sessionId: string
  playlistUrl: string
  fromSec: number | null
  toSec: number | null
  expiresAt: number
}

export class PlaybackService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  async createSession(principal: Principal, rawSegmentId: string): Promise<PlaybackSessionOut> {
    const segmentId = parseSegmentId(rawSegmentId)
    const segment = await this.pool.query<{ course_id: string }>(
      `SELECT s.course_id
       FROM segments s JOIN courses c ON c.course_id = s.course_id
       WHERE s.segment_id = $1 AND s.status = 'published' AND c.status = 'published'`,
      [segmentId],
    )
    const courseId = segment.rows[0]?.course_id
    if (courseId === undefined) throw new HttpError(404, 'segment not found')

    const asset = await this.pool.query<{ hls_path: string }>(
      `SELECT hls_path FROM media_assets
       WHERE course_id = $1 AND status = 'ready' AND hls_path IS NOT NULL
       ORDER BY created_at DESC, asset_id DESC LIMIT 1`,
      [courseId],
    )
    const hlsPath = asset.rows[0]?.hls_path
    if (hlsPath === undefined) throw new HttpError(503, 'media asset unavailable')

    const active = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM playback_sessions
       WHERE device_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [principal.deviceId],
    )
    if ((active.rows[0]?.count ?? 0) >= this.config.playbackMaxConcurrent) throw tooManyRequests()

    const sessionId = `ps_${randomToken(8)}`
    const expiresAt = Date.now() + this.config.playbackSessionTtlSec * 1000
    await this.pool.query(
      `INSERT INTO playback_sessions (session_id, user_id, device_id, segment_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, principal.userId, principal.deviceId, segmentId, new Date(expiresAt)],
    )

    const label = await this.auth.watermarkLabel(principal.userId)
    return {
      sessionId,
      playlistUrl: this.sessionPlaylistUrl(sessionId, hlsPath, expiresAt),
      expiresAt,
      watermark: { label },
    }
  }

  /** admin 预览通道：按 asset + 可选时间窗签发会话；不做 published/course 归属约束（草稿预览用），TTL 兜底回收。 */
  async createAssetSession(
    principal: SessionPrincipal,
    assetId: string,
    window: AssetPlaybackWindow,
  ): Promise<AssetPlaybackSessionOut> {
    const { fromSec, toSec } = window
    if ((fromSec === undefined) !== (toSec === undefined)) {
      throw badRequest('fromSec and toSec must be provided together')
    }
    if (fromSec !== undefined && toSec !== undefined) {
      if (!Number.isInteger(fromSec) || !Number.isInteger(toSec) || fromSec < 0 || toSec <= fromSec || toSec - fromSec > 3_600) {
        throw badRequest('window must satisfy 0 <= fromSec < toSec and span at most 3600 seconds')
      }
    }

    const { rows } = await this.pool.query<{ status: string; hls_path: string | null }>(
      'SELECT status, hls_path FROM media_assets WHERE asset_id = $1',
      [assetId],
    )
    const asset = rows[0]
    if (asset === undefined) throw new HttpError(404, 'media asset not found')
    if (asset.status !== 'ready' || asset.hls_path === null) throw new HttpError(503, 'media asset unavailable')

    const sessionId = `ps_${randomToken(8)}`
    const expiresAt = Date.now() + this.config.playbackSessionTtlSec * 1000
    await this.pool.query(
      `INSERT INTO playback_sessions (session_id, user_id, asset_id, window_from_sec, window_to_sec, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, principal.userId, assetId, fromSec ?? null, toSec ?? null, new Date(expiresAt)],
    )
    return {
      sessionId,
      playlistUrl: this.sessionPlaylistUrl(sessionId, asset.hls_path, expiresAt),
      fromSec: fromSec ?? null,
      toSec: toSec ?? null,
      expiresAt,
    }
  }

  private sessionPlaylistUrl(sessionId: string, hlsPath: string, expiresAt: number): string {
    const slash = hlsPath.lastIndexOf('/')
    const prefix = slash === -1 ? hlsPath : hlsPath.slice(0, slash + 1)
    const token = signPlaybackToken(this.config.mediaSigningSecret, {
      v: 1,
      p: prefix,
      e: expiresAt,
      s: sessionId,
    })
    return `${this.config.mediaBaseUrl}/${hlsPath.replace(/^\/+/, '')}?token=${encodeURIComponent(token)}`
  }
}
