import { baseCaseStocks, baseFigure, baseUnit, SECTION_ID, type SectionFixture } from './types.js'

/** 缺引用：正文引用的 figureId 不在本节 figures 清单内。 */
export const sectionMissingFigure: SectionFixture = {
  name: 'section-missing-figure',
  description: 'figure 块引用 fig_ffffffffffffffff，不在本节 figures → figure_ref_unknown',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: [
      ':::figure figureId=fig_ffffffffffffffff caption="不存在的配图" unitId=su_0123456789abcdef',
      ':::',
    ].join('\n'),
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'figure_ref_unknown' },
}

/** 跨节引用：unitId 形状合法但不属于本节 units。 */
export const sectionCrossUnit: SectionFixture = {
  name: 'section-cross-unit',
  description: 'board 块 unitId=su_ffffffffffffffff（他节 unit）→ unit_ref_unknown',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: [
      ':::board unitId=su_ffffffffffffffff',
      '引用了别的节的 source unit。',
      ':::',
    ].join('\n'),
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'unit_ref_unknown' },
}

/** 段落级锚指向课程外 unit：unit_anchor_unknown。 */
export const sectionUnitAnchorUnknown: SectionFixture = {
  name: 'section-unit-anchor-unknown',
  description: '锚 [[unit:su_ffffffffffffffff|他课证据]] 不在本课程 source units → unit_anchor_unknown',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: '证据出处是 [[unit:su_ffffffffffffffff|他课证据]]。',
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'unit_anchor_unknown' },
}

/** 个股锚不在本节案例股清单：stock_not_in_list。 */
export const sectionStockNotInList: SectionFixture = {
  name: 'section-stock-not-in-list',
  description: '锚 [[stock:sh600000|浦发银行]]，案例股清单只有 sz000713 → stock_not_in_list',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: '锚 [[stock:sh600000|浦发银行]] 不在清单。',
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'stock_not_in_list' },
}
