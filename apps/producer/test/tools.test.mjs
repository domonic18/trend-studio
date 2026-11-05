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
  registerCloudTools(ctx, {}, {})
  const names = registered.map(tool => tool.name)
  assert.ok(names.length >= 14, `工具数偏少: ${names.length}`)
  for (const expected of [
    'cloud_section_preview',
    'cloud_section_article_write',
    'cloud_widget_write',
    'cloud_provenance',
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
})
