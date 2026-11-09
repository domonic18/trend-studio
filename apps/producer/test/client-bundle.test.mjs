/**
 * 浏览器半的打包产物：装载契约与注册形状。
 *
 * 产物不是普通模块，而是「向装载器登记一个 factory」的脚本——宿主侧按包清单
 * 扫描它，形状不对就是启动失败，不是运行时小毛病。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const producerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = path.join(producerDir, 'lib/client.js')

/** 基座模块表：平台浏览器侧预置的那些，产物只能向它要东西。 */
const SEED_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
}

if (!existsSync(bundlePath)) {
  throw new Error('缺少 lib/client.js——先跑 npm run build')
}
await import(pathToFileURL(bundlePath).href)

function requireStub(id) {
  if (id === 'react') return { useState: () => [], useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn }
  if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
  throw new Error(`产物向基座之外的模块要东西：${id}`)
}

/** 假上下文：只记下两段注册，不做任何真实渲染。 */
function fakeCtx() {
  const tabs = []
  const slots = []
  const injected = []
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    sidebarRightTabs: {
      register(definition) {
        tabs.push(definition)
        return () => {}
      },
    },
    slots: {
      inject(name, callback) {
        injected.push(name)
        callback()
        return () => {}
      },
      register(options, component) {
        slots.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, tabs, slots, injected }
}

test('客户端产物：只向装载器登记一个 factory，id 是包名', () => {
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-plugin-trend-producer')
  assert.equal(typeof loaded[0].factory, 'function')
})

test('客户端产物：只向基座模块表里的模块要东西', () => {
  const source = readFileSync(bundlePath, 'utf8')
  const requested = [...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  for (const id of requested) {
    assert.ok(SEED_MODULES.has(id), `产物请求了基座之外的模块：${id}`)
  }
})

test('客户端产物：导出 apply 与它等的服务', () => {
  const exports = loaded[0].factory(requireStub)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'sidebarRightTabs'])
})

test('客户端产物：登记右侧栏「趋势生产」tab 类型与正文', () => {
  const exports = loaded[0].factory(requireStub)
  const { ctx, tabs, slots, injected } = fakeCtx()
  exports.apply(ctx)

  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-plugin-trend-producer')
  assert.equal(tabs[0].kind, 'trend-producer')
  assert.equal(tabs[0].title('any'), '趋势生产')
  assert.equal(tabs[0].guide[0].id, 'dsh-plugin-trend-producer')

  assert.deepEqual(injected, ['sidebar.right.pane.tab'])
  assert.equal(slots.length, 1)
  assert.equal(slots[0].options.name, 'sidebar.right.pane.tab')
  assert.equal(slots[0].options.key, 'dsh-plugin-trend-producer')
  assert.equal(typeof slots[0].component, 'function')
})
