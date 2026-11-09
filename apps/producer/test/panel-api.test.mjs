/**
 * 宿主侧面板 API：四条精确 Fetch 路由的注册与响应形状。
 *
 * 浏览器半只读脱敏结论、只发起登录动作——路由的载荷形状是这条链路的契约，
 * 改了就对不上面板。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerPanelApi } from '../lib/host/panel.js'
import { PRODUCER_PANEL_PATHS } from '../lib/shared/panel-contract.js'

const CONFIG = {
  environment: 'prod',
  baseUrl: 'https://cloud.example',
  understanding: { apiKeyEnv: 'TREND_PRODUCER_MODEL_KEY' },
}

const LOGGER = { info: () => {}, warn: () => {} }

const CLIENT = {
  async readCourses() {
    return {
      courses: [{ courseId: 'TC-101', title: '趋势入门', status: 'published', chapterCount: 3 }],
    }
  },
  async readProductionBoard({ courseId }) {
    return {
      courseId,
      courseTitle: '趋势入门',
      sections: [{
        sectionId: 'S1',
        chapterId: 'C1',
        title: '第一节',
        position: 1,
        steps: [{ step: 'article', status: 'done', note: null }],
        articleVersion: 2,
        widgetCount: 3,
        figureCount: 1,
        caseStockCount: 4,
        reviewVerdict: 'approve',
      }],
      materialChoices: [],
    }
  },
}

/** 假宿主：服务表 + inject 回调，够面板拿到 connection 与 credentials。 */
function fakeHost({ credentials, routes }) {
  const services = new Map()
  if (credentials !== undefined) services.set('credentials', credentials)
  services.set('connection', {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return async () => {}
      },
    },
  })
  return {
    get: name => services.get(name),
    inject(_deps, callback) {
      callback({ get: name => services.get(name) })
    },
  }
}

function mount(credentials) {
  const routes = new Map()
  const host = fakeHost({ credentials, routes })
  registerPanelApi(host, CONFIG, CLIENT, LOGGER)
  return routes
}

async function call(routes, path, init) {
  const route = routes.get(path.split('?')[0])
  assert.ok(route !== undefined, `路由未注册：${path}`)
  const response = await route.fetch(new Request(`https://dsh.local${path}`, init))
  return { status: response.status, body: await response.json() }
}

test('面板 API：四条路由都注册在 /api/trend-producer/* 下', () => {
  const routes = mount(undefined)
  assert.deepEqual([...routes.keys()].sort(), Object.values(PRODUCER_PANEL_PATHS).sort())
  assert.deepEqual(routes.get(PRODUCER_PANEL_PATHS.status).methods, ['GET'])
  assert.deepEqual(routes.get(PRODUCER_PANEL_PATHS.login).methods, ['POST'])
})

test('面板 API：课程清单映射成面板要的形状', async () => {
  const routes = mount(undefined)
  const { status, body } = await call(routes, PRODUCER_PANEL_PATHS.courses)
  assert.equal(status, 200)
  assert.deepEqual(body.courses, [{ courseId: 'TC-101', title: '趋势入门', status: 'published', chapterCount: 3 }])
})

test('面板 API：看板缺 courseId 直接 400，不打云端', async () => {
  const routes = mount(undefined)
  const { status, body } = await call(routes, PRODUCER_PANEL_PATHS.board)
  assert.equal(status, 400)
  assert.match(body.error.message, /courseId/)
})

test('面板 API：看板带回步骤标签与产出计数', async () => {
  const routes = mount(undefined)
  const { status, body } = await call(routes, `${PRODUCER_PANEL_PATHS.board}?courseId=TC-101`)
  assert.equal(status, 200)
  assert.equal(body.courseId, 'TC-101')
  assert.equal(body.sections[0].articleVersion, 2)
  assert.equal(body.sections[0].caseStockCount, 4)
  assert.equal(body.sections[0].reviewVerdict, 'approve')
  assert.equal(typeof body.stepLabels.article, 'string')
})

test('面板 API：登录路由立刻回执，授权在后台跑', async () => {
  const routes = mount(undefined)
  const { status, body } = await call(routes, PRODUCER_PANEL_PATHS.login, { method: 'POST' })
  assert.equal(status, 200)
  assert.equal(body.started, true)
  assert.match(body.message, /授权页/)
})

test('面板 API：登录态从凭据 record 现读，模型位另报', async () => {
  const credentials = {
    async readRecord() {
      return {
        kind: 'grant',
        payload: {
          token: 'tok',
          expiresAt: Date.now() + 3_600_000,
          user: { userId: 'u1', username: 'teacher01', displayName: null, role: 'producer' },
        },
      }
    },
    async describe() {
      return { configured: true }
    },
  }
  const routes = mount(credentials)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('ok', { status: 200 })
  try {
    const { status, body } = await call(routes, PRODUCER_PANEL_PATHS.status)
    assert.equal(status, 200)
    assert.equal(body.login.state, 'active')
    assert.equal(body.login.username, 'teacher01')
    assert.equal(body.modelKey.configured, true)
    assert.equal(body.cloud.reachable, true)
  } finally {
    globalThis.fetch = original
  }
})

test('面板 API：云端探不通只报不可达，不抛错', async () => {
  const routes = mount(undefined)
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try {
    const { status, body } = await call(routes, PRODUCER_PANEL_PATHS.status)
    assert.equal(status, 200)
    assert.equal(body.cloud.reachable, false)
    assert.match(body.cloud.error, /ECONNREFUSED/)
  } finally {
    globalThis.fetch = original
  }
})
