export { CourseView, ChapterView } from './CourseView.js'
export { SectionView } from './SectionView.js'
// 组件名与视图模型同名，显式导出会遮蔽同名类型；类型另以 Model 后缀出口。
export type {
  ChapterView as ChapterViewModel,
  SectionView as SectionViewModel,
} from './types.js'
export * from './types.js'
