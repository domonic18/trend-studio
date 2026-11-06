import { courseCss } from '@trend/widgets/course.styles'
import { widgetsCss } from '@trend/widgets/styles'

const STYLE_ID = 'trend-coach-widgets-style'
const COURSE_STYLE_ID = 'trend-coach-course-style'

let injected = false
let courseInjected = false

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

/** 课程页样式与课件样式分开注入：课程作用域（.wg-course）才切原型浅色编辑风。 */
export function ensureCourseStyles(): void {
  // 变量作用域定义在 widgets.css（.wg-course 覆盖块），故先注入课件样式。
  ensureWidgetsStyles()
  if (courseInjected) return
  if (typeof document === 'undefined') return
  if (document.getElementById(COURSE_STYLE_ID) !== null) {
    courseInjected = true
    return
  }
  const style = document.createElement('style')
  style.id = COURSE_STYLE_ID
  style.textContent = courseCss
  document.head.appendChild(style)
  courseInjected = true
}
