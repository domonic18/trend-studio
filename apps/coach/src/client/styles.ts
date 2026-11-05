import { widgetsCss } from '@trend/widgets/styles'

const STYLE_ID = 'trend-coach-widgets-style'

let injected = false

/** 课件样式随包发布，运行时注入一次即可；重复调用不重复挂载。 */
export function ensureWidgetsStyles(): void {
  if (injected) return
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) {
    injected = true
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = widgetsCss
  document.head.appendChild(style)
  injected = true
}
