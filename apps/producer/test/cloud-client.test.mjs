import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TrendCloudClient } from '../lib/host/cloud-client.js'
import { InvalidResponseError, UpstreamError, toToolError } from '../lib/errors.js'

/** fakeAuth：记录请求并按脚本回放响应（对齐学员插件 fakeAuth 测试法）。 */
function fakeAuth(handlers) {
  const calls = []
  return {
    calls,
    async request(path, init) {
      calls.push({ path, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) })
      const match = handlers.find(handler => handler.match(path, init))
      if (match === undefined) throw new Error(`unexpected request: ${init.method} ${path}`)
      const { status, payload } = typeof match.reply === 'function' ? match.reply(path, init) : match.reply
      const body = JSON.stringify(payload)
      return new Response(status === 204 ? null : body, {
        status,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      })
    },
    async requestJson(path, init) {
      const response = await this.request(path, init)
      return await response.json()
    },
  }
}

test('writeSourceUnits：POST 正确路径与载荷，回执经出参校验', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/source-units' && init.method === 'POST',
      reply: {
        status: 200,
        payload: { saved: [{ unitId: 'su_0123456789abcdef', assetId: 'asset_0123456789abcdef', startMs: 0, deduped: false }] },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const unit = { assetId: 'asset_0123456789abcdef', startMs: 0, endMs: 420000, transcriptText: '文', summary: '摘' }
  const result = await client.writeSourceUnits({ units: [unit] })
  assert.equal(result.saved[0].deduped, false)
  assert.equal(auth.calls[0].method, 'POST')
  assert.equal(auth.calls[0].body.units[0].summary, '摘')
})

test('writeSourceUnits：重复写入返回 deduped=true（幂等回执）', async () => {
  const auth = fakeAuth([
    {
      match: path => path === '/v1/admin/content/source-units',
      reply: {
        status: 200,
        payload: { saved: [{ unitId: 'su_0123456789abcdef', assetId: 'asset_0123456789abcdef', startMs: 0, deduped: true }] },
      },
    },
  ])
  const result = await new TrendCloudClient(auth).writeSourceUnits({
    units: [{ assetId: 'asset_0123456789abcdef', startMs: 0, endMs: 1000, transcriptText: '文', summary: '摘' }],
  })
  assert.equal(result.saved[0].deduped, true)
})

test('课件断言证明失败：409 附业务码与 failed 数组，工具错误可回灌', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/widgets'),
      reply: {
        status: 409,
        payload: { error: { code: 'assertion_unproven', message: 'widget assertions failed server-side proof', failed: ['noBreakBelow'] } },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const error = await client.writeWidget({
    sectionId: 'sec_0123456789abcdef',
    type: 'kline-annotator',
    specVersion: 1,
    spec: {},
    assertions: {},
    citations: ['su_0123456789abcdef'],
  }).then(() => null, error => error)
  assert.ok(error instanceof UpstreamError)
  assert.equal(error.status, 409)
  assert.equal(error.businessCode, 'assertion_unproven')
  assert.deepEqual(error.detail.failed, ['noBreakBelow'])
  const toolError = toToolError(error, '提交课件 spec')
  assert.match(toolError.message, /\[conflict\]/)
  assert.match(toolError.message, /noBreakBelow/)
})

test('非 2xx 无错误体：状态码映射稳定码', async () => {
  const auth = fakeAuth([
    { match: path => path.includes('/pipeline/jobs'), reply: { status: 503, payload: { error: 'pipeline disabled' } } },
  ])
  const error = await new TrendCloudClient(auth)
    .pipelineStatus({ assetId: 'asset_0123456789abcdef' })
    .then(() => null, error => error)
  assert.ok(error instanceof UpstreamError)
  assert.equal(error.status, 503)
  const toolError = toToolError(error, '查询管线状态')
  assert.match(toolError.message, /^\[unavailable\]/)
})

test('凭据缺失：AuthError → [forbidden]', async () => {
  const auth = {
    async request() {
      throw Object.assign(new Error('云端后台会话凭据缺失'), { name: 'AuthError' })
    },
    async requestJson() {
      throw Object.assign(new Error('云端后台会话凭据缺失'), { name: 'AuthError' })
    },
  }
  const error = await new TrendCloudClient(auth)
    .listSections({ courseId: 'T-M9' })
    .then(() => null, error => error)
  assert.match(toToolError(error, '查询节').message, /^\[internal\]|^\[forbidden\]/)
})

test('出参契约不符：整体失败不静默', async () => {
  const auth = fakeAuth([
    {
      match: path => path === '/v1/admin/content/source-units',
      reply: { status: 200, payload: { saved: [{ unitId: 'bad-id' }] } },
    },
  ])
  const error = await new TrendCloudClient(auth)
    .writeSourceUnits({ units: [{ assetId: 'asset_0123456789abcdef', startMs: 0, endMs: 1000, transcriptText: '文', summary: '摘' }] })
    .then(() => null, error => error)
  assert.ok(error instanceof InvalidResponseError)
  assert.match(error.message, /响应与契约不符/)
})

test('GET 检索：query 参数带 assetId 与 q（URLSearchParams 编码）', async () => {
  const auth = fakeAuth([
    {
      match: path => path.startsWith('/v1/admin/content/source-units?'),
      reply(path) {
        assert.match(path, /assetId=asset_0123456789abcdef/)
        assert.match(path, /q=%E8%B5%B7%E9%A3%9E/)
        return { status: 200, payload: { units: [], nextCursor: null } }
      },
    },
  ])
  const result = await new TrendCloudClient(auth).searchSourceUnits({ assetId: 'asset_0123456789abcdef', q: '起飞' })
  assert.deepEqual(result.units, [])
  assert.equal(result.nextCursor, null)
})

test('readSourceUnits：POST 路径与载荷正确，回执含完整证据体', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/source-units/read' && init.method === 'POST',
      reply: {
        status: 200,
        payload: {
          units: [{
            unitId: 'su_0123456789abcdef',
            assetId: 'asset_0123456789abcdef',
            startMs: 0,
            endMs: 420000,
            transcriptText: '均线方向向上',
            visual: { description: 'K线图' },
            keyframes: [{ sec: 12, url: 'https://media.example.com/kf.jpg?sig=1', width: 1280, height: 720 }],
            playback: {
              playlistUrl: 'https://media.example.com/hls/index.m3u8?sig=1',
              fromSec: 0,
              toSec: 420,
              expiresAt: 1_761_000_000_000,
            },
          }],
        },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const result = await client.readSourceUnits({ unitIds: ['su_0123456789abcdef'] })
  assert.equal(result.units[0].transcriptText, '均线方向向上')
  assert.equal(result.units[0].keyframes[0].url, 'https://media.example.com/kf.jpg?sig=1')
  assert.equal(result.units[0].playback.fromSec, 0)
  assert.deepEqual(auth.calls[0].body, { unitIds: ['su_0123456789abcdef'] })
})

test('readSourceUnits：409 unit_not_readable 附业务码，工具错误可回灌', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/source-units/read'),
      reply: {
        status: 409,
        payload: {
          error: {
            code: 'unit_not_readable',
            message: 'one or more source units are not readable',
            unitIds: ['su_0123456789abcdef'],
          },
        },
      },
    },
  ])
  const error = await new TrendCloudClient(auth)
    .readSourceUnits({ unitIds: ['su_0123456789abcdef'] })
    .then(() => null, error => error)
  assert.ok(error instanceof UpstreamError)
  assert.equal(error.status, 409)
  assert.equal(error.businessCode, 'unit_not_readable')
  assert.match(toToolError(error, '读取理解产物证据').message, /\[conflict\]/)
})

test('readSourceUnits：出参缺关键帧地址时整体失败不静默', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/source-units/read'),
      reply: {
        status: 200,
        payload: {
          units: [{
            unitId: 'su_0123456789abcdef',
            assetId: 'asset_0123456789abcdef',
            startMs: 0,
            endMs: 420000,
            transcriptText: '均线方向向上',
            visual: {},
            keyframes: [{ sec: 12, width: 1280, height: 720 }],
            playback: {
              playlistUrl: 'https://media.example.com/hls/index.m3u8',
              fromSec: 0,
              toSec: 420,
              expiresAt: 1_761_000_000_000,
            },
          }],
        },
      },
    },
  ])
  const error = await new TrendCloudClient(auth)
    .readSourceUnits({ unitIds: ['su_0123456789abcdef'] })
    .then(() => null, error => error)
  assert.ok(error instanceof InvalidResponseError)
})

test('溯源上报：POST /provenance 回 202 形状', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/provenance' && init.method === 'POST',
      reply: { status: 202, payload: { runId: 'uuid-1', usageId: '123' } },
    },
  ])
  const result = await new TrendCloudClient(auth).reportProvenance({
    taskKey: 'content.chunk_summary',
    model: 'test-model',
    status: 'success',
    inputTokens: 10,
    outputTokens: 20,
  })
  assert.equal(result.runId, 'uuid-1')
})

test('frames：时间窗参数拼 query，nextFrom 透传', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/frames'),
      reply(path) {
        assert.match(path, /from=0&to=600000/)
        return {
          status: 200,
          payload: {
            frames: [{ sec: 12, url: 'https://x/kf.jpg?sig=1', width: 1280, height: 720 }],
            nextFrom: 600000,
          },
        }
      },
    },
  ])
  const result = await new TrendCloudClient(auth).frames({ assetId: 'asset_0123456789abcdef', from: 0, to: 600000 })
  assert.equal(result.nextFrom, 600000)
  assert.equal(result.frames[0].sec, 12)
})

test('listConcepts：GET 带 courseId 查询串，出参经出参校验', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/concepts?courseId=TC-1' && init.method === 'GET',
      reply: {
        status: 200,
        payload: { concepts: [{ conceptId: 'cpt_0123456789abcdef', name: '阻尼运动', aliases: ['收敛'], definition: null }] },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const result = await client.listConcepts({ courseId: 'TC-1' })
  assert.equal(result.concepts.length, 1)
  assert.equal(result.concepts[0].name, '阻尼运动')
  assert.deepEqual(result.concepts[0].aliases, ['收敛'])
  assert.equal(auth.calls[0].method, 'GET')
})

test('sectionPreview：GET 节预览，回读教材正文与课件 spec', async () => {
  const markdown = '## 概念\n\n```mermaid\nflowchart TD\n  n1["大盘环境"] --> n2["个股选择"]\n```\n'
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/sections/sec_0123456789abcdef/preview' && init.method === 'GET',
      reply: {
        status: 200,
        payload: {
          section: {
            sectionId: 'sec_0123456789abcdef',
            courseId: 'TC-ZONGLUN',
            chapterId: 'TC-ZONGLUN',
            title: '总论第一讲',
            position: 1,
            status: 'draft',
            conceptRefs: ['cpt_0123456789abcdef'],
          },
          article: { markdown, citations: ['su_0123456789abcdef'], version: 2, status: 'draft', dslVersion: 1 },
          widgets: [
            {
              widgetId: 'wgt_0123456789abcdef',
              type: 'mcq-quiz',
              specVersion: 1,
              spec: { question: 'M60 是什么？' },
              assertions: { hasAnswer: 'pass' },
              validation: { hasAnswer: 'pass' },
              status: 'draft',
              version: 1,
              createdAt: '2026-11-05T00:00:00.000Z',
            },
          ],
          figures: [],
        },
      },
    },
  ])
  const result = await new TrendCloudClient(auth).sectionPreview({ sectionId: 'sec_0123456789abcdef' })
  assert.equal(result.article.markdown, markdown)
  assert.equal(result.widgets[0].type, 'mcq-quiz')
  assert.equal(result.widgets[0].spec.question, 'M60 是什么？')
  assert.equal(auth.calls[0].method, 'GET')
})

test('sectionPreview：节不存在 404 映射稳定码', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/preview'),
      reply: { status: 404, payload: { error: { code: 'not_found', message: 'section not found' } } },
    },
  ])
  const error = await new TrendCloudClient(auth)
    .sectionPreview({ sectionId: 'sec_0123456789abcdef' })
    .then(() => null, error => error)
  assert.ok(error instanceof UpstreamError)
  assert.equal(error.status, 404)
})

test('writeSectionFigure：keyframe 路 POST 路径与载荷', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/sections/sec_0123456789abcdef/figures' && init.method === 'POST',
      reply: {
        status: 201,
        payload: {
          figureId: 'fig_0123456789abcdef',
          kind: 'keyframe',
          caption: '筹码峰画面',
          status: 'ready',
          selectedCandidateId: 'cand_0123456789abcdef',
          assetId: 'asset_0123456789abcdef',
          sourceSec: 70,
          spec: null,
        },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const result = await client.writeSectionFigure({
    sectionId: 'sec_0123456789abcdef',
    kind: 'keyframe',
    assetId: 'asset_0123456789abcdef',
    sec: 70,
    caption: '筹码峰画面',
    unitId: 'su_0123456789abcdef',
  })
  assert.equal(result.kind, 'keyframe')
  assert.equal(result.sourceSec, 70)
  assert.equal(auth.calls[0].body.unitId, 'su_0123456789abcdef')
})

test('writeSectionFigure：diagram 路 POST 模板参数', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path.includes('/figures') && init.method === 'POST',
      reply: {
        status: 201,
        payload: {
          figureId: 'fig_0123456789abcdef',
          kind: 'diagram',
          caption: '阶段推进',
          status: 'ready',
          selectedCandidateId: 'cand_0123456789abcdef',
          assetId: null,
          sourceSec: null,
          spec: { template: 'timeline', params: { events: [{ date: '2019-05-17', title: '峰位确认' }] } },
        },
      },
    },
  ])
  const result = await new TrendCloudClient(auth).writeSectionFigure({
    sectionId: 'sec_0123456789abcdef',
    kind: 'diagram',
    template: 'timeline',
    params: { events: [{ date: '2019-05-17', title: '峰位确认' }] },
    caption: '阶段推进',
  })
  assert.equal(result.spec?.template, 'timeline')
})

test('writeSectionCaseStocks：PUT 路径与覆盖回执', async () => {
  const auth = fakeAuth([
    {
      match: (path, init) => path === '/v1/admin/content/sections/sec_0123456789abcdef/case-stocks' && init.method === 'PUT',
      reply: {
        status: 200,
        payload: {
          saved: [{ stockRefId: 'cst_0123456789abcdef', code: '000713', deduped: true }],
        },
      },
    },
  ])
  const client = new TrendCloudClient(auth)
  const result = await client.writeSectionCaseStocks({
    sectionId: 'sec_0123456789abcdef',
    stocks: [{
      name: '丰乐种业',
      exchange: 'SZSE',
      code: '000713',
      windowStart: '2019-01-02',
      windowEnd: '2020-02-28',
      events: [{ date: '2019-05-17', label: '筹码峰', unitId: 'su_0123456789abcdef' }],
    }],
  })
  assert.equal(result.saved[0].deduped, true)
  assert.equal(auth.calls[0].body.stocks[0].code, '000713')
})

test('writeSectionCaseStocks：出参 code 格式不符整体失败', async () => {
  const auth = fakeAuth([
    {
      match: path => path.includes('/case-stocks'),
      reply: { status: 200, payload: { saved: [{ stockRefId: 'cst_0123456789abcdef', code: 'bad', deduped: false }] } },
    },
  ])
  const error = await new TrendCloudClient(auth).writeSectionCaseStocks({
    sectionId: 'sec_0123456789abcdef',
    stocks: [{ name: 'x', exchange: 'SZSE', code: '000001', windowStart: '2019-01-02', windowEnd: '2020-02-28', events: [] }],
  }).then(() => null, error => error)
  assert.ok(error instanceof InvalidResponseError)
})
