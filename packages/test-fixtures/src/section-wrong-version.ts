import { SECTION_ID, baseCaseStocks, baseFigure, baseUnit, type SectionFixture } from './types.js'

/** 错误版本：widget specVersion 不在支持的 v1/v2 → schema 拒绝（非 DSL 层）。 */
export const widgetWrongVersion: SectionFixture = {
  name: 'widget-wrong-version',
  description: 'widgetWriteInput specVersion=3（当前只支持 1/2）→ schema 拒绝',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: '正文合法。',
    citations: ['su_0123456789abcdef'],
  },
  widgets: [{
    sectionId: SECTION_ID,
    type: 'mcq-quiz',
    specVersion: 3,
    spec: { prompt: '未来版本的课件' },
    assertions: { hasPrompt: true },
    citations: ['su_0123456789abcdef'],
  }],
  expect: { verdict: 'reject', kind: 'schema' },
}

/** 非法媒体写入形状：keyframe sec 为负 → figureWriteInput schema 拒绝。 */
export const figureInvalidSec: SectionFixture = {
  name: 'figure-invalid-sec',
  description: 'figureWriteInput keyframe sec=-1 → schema 拒绝（媒体时间越界）',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: '正文合法。',
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'schema' },
}

export const figureInvalidSecInput = {
  sectionId: SECTION_ID,
  kind: 'keyframe',
  assetId: 'asset_0123456789abcdef',
  sec: -1,
  caption: '负秒数选帧',
  unitId: 'su_0123456789abcdef',
} as const
