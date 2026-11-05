import { baseCaseStocks, baseFigure, baseUnit, SECTION_ID, type SectionFixture } from './types.js'

/** 非法媒体三反例：窗超长、from≥to、窗不落任何 source unit。 */
export const clipSpanTooLong: SectionFixture = {
  name: 'clip-span-too-long',
  description: 'clip from=70 to=200，窗长 130s > 60s → clip_not_grounded',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: [
      ':::clip assetId=asset_0123456789abcdef from=70 to=200 caption="超长片段" unitId=su_0123456789abcdef',
      ':::',
    ].join('\n'),
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'clip_not_grounded' },
}

export const clipFromGteTo: SectionFixture = {
  name: 'clip-from-gte-to',
  description: 'clip from=100 to=100，from ≥ to → clip_not_grounded',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: [
      ':::clip assetId=asset_0123456789abcdef from=100 to=100 caption="零长片段" unitId=su_0123456789abcdef',
      ':::',
    ].join('\n'),
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'clip_not_grounded' },
}

export const clipNotGrounded: SectionFixture = {
  name: 'clip-not-grounded',
  description: 'clip from=30 to=85 窗长合法，但整体落在 unit [60,180] 起点之前 → clip_not_grounded',
  sectionId: SECTION_ID,
  units: [baseUnit()],
  figures: [baseFigure()],
  caseStocks: baseCaseStocks(),
  article: {
    markdown: [
      ':::clip assetId=asset_0123456789abcdef from=30 to=85 caption="越窗片段" unitId=su_0123456789abcdef',
      ':::',
    ].join('\n'),
    citations: ['su_0123456789abcdef'],
  },
  expect: { verdict: 'reject', kind: 'clip_not_grounded' },
}
