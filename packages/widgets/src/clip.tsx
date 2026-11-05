import { useEffect, useRef, useState } from 'react'
import type { ArticleHost, PlaybackSessionTicket } from './types.js'

type ClipState = 'idle' | 'loading' | 'playing' | 'ended' | 'error'

/** 片段卡：懒加载 hls.js，窗内起播、到点暂停；会话过期可重试。 */
export function ClipCard({
  assetId,
  fromSec,
  toSec,
  caption,
  host,
}: {
  assetId: string
  fromSec: number
  toSec: number
  caption: string
  host: ArticleHost
}) {
  const [state, setState] = useState<ClipState>('idle')
  const [ticket, setTicket] = useState<PlaybackSessionTicket | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<{ destroy: () => void } | null>(null)

  const start = async (): Promise<void> => {
    setState('loading')
    try {
      const next = await host.createPlaybackSession(assetId, fromSec, toSec)
      setTicket(next)
    } catch {
      setState('error')
    }
  }

  // ticket 落定后 video 元素才随 re-render 挂载，attach 必须放在 effect 里。
  useEffect(() => {
    if (ticket === null) return
    let cancelled = false
    const attach = async (): Promise<void> => {
      const video = videoRef.current
      if (video === null || cancelled) return
      const { default: Hls } = await import('hls.js')
      if (cancelled) return
      if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
        video.src = ticket.playlistUrl
        await video.play()
        return
      }
      if (!Hls.isSupported()) {
        setState('error')
        return
      }
      const hls = new Hls()
      hlsRef.current = hls
      hls.loadSource(ticket.playlistUrl)
      hls.attachMedia(video)
      await video.play()
    }
    void attach().catch(() => {
      if (!cancelled) setState('error')
    })
    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [ticket])

  const onLoadedMetadata = (): void => {
    const video = videoRef.current
    if (video !== null && video.currentTime < fromSec) video.currentTime = fromSec
    setState('playing')
  }

  const onTimeUpdate = (): void => {
    const video = videoRef.current
    if (video !== null && video.currentTime >= toSec && !video.paused) {
      video.pause()
      setState('ended')
    }
  }

  const replay = (): void => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = fromSec
    setState('playing')
    void video.play()
  }

  return (
    <figure className="wg-clip">
      <figcaption className="wg-clip-head">
        <span className="wg-clip-title">{caption}</span>
        <span className="wg-clip-window">{formatSec(fromSec)}–{formatSec(toSec)}</span>
      </figcaption>
      {state === 'idle' ? (
        <button type="button" className="wg-clip-start" onClick={() => void start()}>
          ▶ 播放片段
        </button>
      ) : state === 'error' ? (
        <div className="wg-clip-error">
          片段加载失败
          <button type="button" className="wg-clip-retry" onClick={() => void start()}>重试</button>
        </div>
      ) : (
        <video
          ref={videoRef}
          className="wg-clip-video"
          controls
          playsInline
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
        />
      )}
      {state === 'ended' ? (
        <div className="wg-clip-ended">
          片段结束
          <button type="button" className="wg-clip-retry" onClick={replay}>重看</button>
        </div>
      ) : null}
      {ticket !== null ? <span className="wg-clip-session">会话 {ticket.sessionId}</span> : null}
    </figure>
  )
}

function formatSec(sec: number): string {
  const mm = Math.floor(sec / 60)
  const ss = sec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
