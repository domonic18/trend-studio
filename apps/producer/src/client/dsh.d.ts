import type { Context } from '@deepseek-ai/cordis'

/**
 * 浏览器半用到的 dsh 服务面。
 *
 * 这里只声明面板真正用到的那一小块——槽注册与右侧栏 tab 注册表——与宿主侧
 * `host/panel.ts` 对连接服务的做法一致：真实包不声明 Context 增强，插件
 * 自述用到的那部分，避免把整条客户端类型图拖进构建。
 */
interface SlotsService {
  inject(name: string, callback: () => void | (() => void)): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface SidebarRightTabsService {
  register(definition: {
    id: string
    kind: string
    priority?: 'extension' | 'builtin' | 'fallback'
    title: (address: string) => string
    guide?: Array<{
      id: string
      order: number
      title: () => string
      description?: () => string
    }>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService
    sidebarRightTabs: SidebarRightTabsService
  }
}
