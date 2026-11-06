import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleCourseView, collectSignedFigures } from '../lib/client/course-assemble.js'

const COURSE_ID = 'TC-101'

function section(overrides = {}) {
  return {
    sectionId: 'sec_1',
    courseId: COURSE_ID,
    chapterId: 'M1',
    title: '第一节',
    position: 0,
    article: null,
    widgets: [],
    figures: [],
    caseStocks: [],
    ...overrides,
  }
}

function course(chapters = [{ chapterId: 'M1', title: '第一章', position: 0 }]) {
  return {
    contractVersion: 3,
    courseId: COURSE_ID,
    title: '趋势交易基础',
    chapters,
  }
}

test('课程视图按章归组，节按 position 升序', () => {
  const view = assembleCourseView(
    course([
      { chapterId: 'M1', title: '第一章', position: 0 },
      { chapterId: 'M2', title: '第二章', position: 1 },
    ]),
    [
      section({ sectionId: 'sec_2', chapterId: 'M1', position: 2 }),
      section({ sectionId: 'sec_3', chapterId: 'M2', position: 0 }),
      section({ sectionId: 'sec_1', chapterId: 'M1', position: 1 }),
    ],
  )

  assert.equal(view.course.courseId, COURSE_ID)
  assert.equal(view.chapters.length, 2)
  assert.deepEqual(view.chapters[0].sections.map(s => s.section.sectionId), ['sec_1', 'sec_2'])
  assert.deepEqual(view.chapters[1].sections.map(s => s.section.sectionId), ['sec_3'])
})

test('节载荷透传导语与概念名，缺省字段不落空串', () => {
  const view = assembleCourseView(course(), [
    section({ sectionId: 'sec_1', summary: '从走势结构切入', conceptNames: ['趋势结构'] }),
    section({ sectionId: 'sec_2' }),
  ])

  const [first, second] = view.chapters[0].sections
  assert.equal(first.section.summary, '从走势结构切入')
  assert.deepEqual(first.section.conceptNames, ['趋势结构'])
  assert.equal(second.section.summary, undefined)
  assert.equal(second.section.conceptNames, undefined)
})

test('正文缺失时 article 为 null，课件与图示按节装配', () => {
  const view = assembleCourseView(course(), [
    section({
      sectionId: 'sec_1',
      article: { markdown: '正文', dslVersion: 2, version: 3, publishedAt: 1 },
      widgets: [{ widgetId: 'w1', type: 'bar-replay-decision', specVersion: 2, spec: {}, assertions: {} }],
      figures: [{ figureId: 'f1', kind: 'svg', caption: '图一', assetId: null, sourceSec: null, candidateId: 'c1', url: 'https://x/f1.svg' }],
    }),
  ])

  const only = view.chapters[0].sections[0]
  assert.equal(only.article?.markdown, '正文')
  assert.equal(only.widgets.length, 1)
  assert.equal(only.figures[0].figureId, 'f1')
  assert.equal(only.figures[0].sectionId, 'sec_1')
})

test('案例股事件只收合法三元组，非法项丢弃', () => {
  const view = assembleCourseView(course(), [
    section({
      sectionId: 'sec_1',
      caseStocks: [{
        code: 'sz000001',
        name: '平安银行',
        exchange: 'SZSE',
        windowStart: '2026-01-02',
        windowEnd: '2026-03-31',
        events: [
          { date: '2026-02-10', label: '突破', unitId: 'u1' },
          { date: 20260210, label: '坏类型', unitId: 'u2' },
          null,
        ],
      }],
    }),
  ])

  const stock = view.chapters[0].sections[0].caseStocks[0]
  assert.equal(stock.events.length, 1)
  assert.deepEqual(stock.events[0], { date: '2026-02-10', label: '突破', unitId: 'u1' })
})

test('签名图示按 figureId 汇总，缺地址为 null', () => {
  const figures = collectSignedFigures([
    section({ sectionId: 'sec_1', figures: [{ figureId: 'f1', kind: 'svg', caption: '图一', assetId: null, sourceSec: null, candidateId: 'c1', url: 'https://x/f1.svg' }] }),
    section({ sectionId: 'sec_2', figures: [{ figureId: 'f2', kind: 'photo', caption: '图二', assetId: null, sourceSec: null, candidateId: null, url: null }] }),
  ])

  assert.equal(figures.get('f1')?.url, 'https://x/f1.svg')
  assert.equal(figures.get('f2')?.url, null)
})
