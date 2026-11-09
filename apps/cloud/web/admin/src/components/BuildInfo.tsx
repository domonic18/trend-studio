import { Typography } from 'antd'
import { useEffect, useState } from 'react'

interface HealthInfo {
  ok: boolean
  commit?: string
  buildTime?: string
}

/** 页脚构建标识：commit 与构建时间随镜像注入（CI --build-arg），经 /health 返回。 */
export function BuildInfo() {
  const [info, setInfo] = useState<HealthInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/health')
      .then(response => (response.ok ? (response.json() as Promise<HealthInfo>) : null))
      .then(data => {
        if (!cancelled && data !== null) setInfo(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (info === null || info.commit === undefined) return null
  const short = info.commit.length > 7 ? info.commit.slice(0, 7) : info.commit
  const time = info.buildTime === undefined || info.buildTime === 'unknown' ? '' : ` · ${info.buildTime}`
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      构建 {short}{time}
    </Typography.Text>
  )
}
