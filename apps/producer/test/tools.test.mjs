import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerCloudTools } from '../lib/host/tools.js'

/**
 * 工具 schema 必须在 dsh 的 schema DSL 里编译得过：defineTool 在构造时就编译，
 * 不合法的 DSL（如 oneOf 分支里写 required）会让整个插件在 dsh 启动时激活失败——
 * 表现为「插件没挂上、所有 cloud_* 工具都不存在」，且只在真机启动时才暴露。
 */
test('全部 cloud_* 工具的 schema 可被 dsh schema DSL 编译（插件能激活）', () => {
  const registered = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
  registerCloudTools(ctx, {}, {}, {})
  const names = registered.map(tool => tool.name)
  assert.ok(names.length >= 20, `工具数偏少: ${names.length}`)
  for (const expected of [
    'cloud_section_preview',
    'cloud_section_article_write',
    'cloud_widget_write',
    'cloud_widget_delete',
    'cloud_figure_write',
    'cloud_figure_delete',
    'cloud_source_units_read',
    'cloud_provenance',
    'cloud_asset_create',
    'cloud_asset_upload',
    'cloud_asset_ingest',
    'cloud_asset_list',
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
})

test('cloud_source_units_read：入参透传到 client，证据原文进 render 输出', async () => {
  const registered = []
  const seen = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
  const client = {
    async readSourceUnits(input) {
      seen.push(input)
      return {
        units: [{
          unitId: 'su_0123456789abcdef',
          assetId: 'asset_0123456789abcdef',
          startMs: 0,
          endMs: 420000,
          transcriptText: '均线方向向上，属于健康上涨',
          visual: { description: 'K 线图' },
          keyframes: [{ sec: 12, url: 'https://media.example.com/kf.jpg?sig=1', width: 1280, height: 720 }],
          playback: {
            playlistUrl: 'https://media.example.com/hls/index.m3u8?sig=1',
            fromSec: 0,
            toSec: 420,
            expiresAt: 1_761_000_000_000,
          },
        }],
      }
    },
  }
  registerCloudTools(ctx, client, {}, {})
  const tool = registered.find(item => item.name === 'cloud_source_units_read')
  const result = await tool.execute({ unitIds: ['su_0123456789abcdef'] }, { signal: undefined })
  assert.deepEqual(seen[0], { unitIds: ['su_0123456789abcdef'] })
  assert.equal(result.units[0].transcriptText, '均线方向向上，属于健康上涨')

  const rendered = tool.output.render({ unitIds: ['su_0123456789abcdef'] }, result)
  assert.match(rendered[0].text, /不可信/)
  assert.match(rendered[0].text, /均线方向向上/)
})

test('cloud_figure_delete：入参透传到 client 并回执 deleted', async () => {
  const registered = []
  const seen = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
  const client = {
    async deleteFigure(input) {
      seen.push(input)
    },
  }
  registerCloudTools(ctx, client, {}, {})
  const tool = registered.find(item => item.name === 'cloud_figure_delete')
  const result = await tool.execute(
    { sectionId: 'sec_0123456789abcdef', figureId: 'fig_0123456789abcdef' },
    { signal: undefined },
  )
  assert.deepEqual(seen[0], { sectionId: 'sec_0123456789abcdef', figureId: 'fig_0123456789abcdef' })
  assert.equal(result.deleted, true)
  assert.match(tool.output.render({}, result)[0].text, /fig_0123456789abcdef/)
})

test('cloud_source_units_read：入参不合法时在 execute 前被拒（不发请求）', async () => {  const registered = []
  let called = 0
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
  const client = {
    async readSourceUnits() {
      called += 1
      return { units: [] }
    },
  }
  registerCloudTools(ctx, client, {}, {})
  const tool = registered.find(item => item.name === 'cloud_source_units_read')
  await assert.rejects(() => tool.execute({ unitIds: 'su_0123456789abcdef' }, { signal: undefined }))
  assert.equal(called, 0)
})
