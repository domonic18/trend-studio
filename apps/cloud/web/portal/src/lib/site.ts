import { useEffect, useState } from 'react'

/** 构建期写入的站点根地址（PUBLIC_BASE_URL）。 */
const BAKED_ORIGIN = String(import.meta.env.VITE_SITE_ORIGIN ?? '').replace(/\/+$/, '')

/**
 * 站点根地址：挂载后取浏览器实际地址——教员可能从内网 IP 或另一个域名访问，
 * 构建期地址未必对得上。预渲染阶段没有浏览器，退回构建期地址。
 */
export function useSiteOrigin(): string {
  const [origin, setOrigin] = useState(BAKED_ORIGIN)
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  return origin
}
