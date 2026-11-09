/**
 * 生产面板的浏览器半：右侧栏「趋势生产」tab 的注册入口。
 *
 * 两段式注册与 dsh 内建 tab 类型一致——先在 tab 注册表登记「这一类 tab 是什么」，
 * 再在 `sidebar.right.pane.tab` 槽里按同一个 id 登记「这一类 tab 的正文」。
 *
 * 面板不碰云端令牌与模型密钥：它只读宿主脱敏后的结论，登录动作也只发给宿主。
 */
import type { Context } from '@deepseek-ai/cordis'
import { ProducerPanel } from './panel.js'

export const name = 'trend-producer-client'

/** 浏览器侧等到的服务：槽注册表与右侧栏 tab 注册表。 */
export const inject = ['slots', 'sidebarRightTabs']

/** 本实现的身份：tab 注册表的 id，也是正文在槽里的 key。 */
const TAB_ID = 'dsh-plugin-trend-producer'
/** tab 类型：openTab 用的 kind。 */
const TAB_KIND = 'trend-producer'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => '趋势生产',
    guide: [{
      id: TAB_ID,
      order: 150,
      title: () => '趋势生产',
      description: () => '教员登录、模型密钥与课程生产看板',
    }],
  }), 'trend-producer: tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
  }, ProducerPanel)), 'trend-producer: tab body')
}
