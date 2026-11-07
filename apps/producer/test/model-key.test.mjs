import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelKeyResolver } from '../lib/host/model-key.js'

/** fakeCtx：只提供 credentials 服务；records 为 undefined 表示插件未注入凭据服务。 */
function fakeCtx(records) {
  return {
    get(name) {
      if (name !== 'credentials' || records === undefined) return undefined
      return {
        async resolve(ref) {
          const value = records[ref]
          return value === undefined ? undefined : { value, source: 'file' }
        },
      }
    },
  }
}

test('模型密钥：优先取托管凭据库，进程环境只是兜底', async () => {
  process.env.TREND_PRODUCER_MODEL_KEY = 'from-env'
  try {
    const resolve = createModelKeyResolver(fakeCtx({ TREND_PRODUCER_MODEL_KEY: 'from-store' }))
    assert.equal(await resolve('TREND_PRODUCER_MODEL_KEY'), 'from-store')
  } finally {
    delete process.env.TREND_PRODUCER_MODEL_KEY
  }
})

test('模型密钥：托管库没有时退回进程环境', async () => {
  process.env.TREND_PRODUCER_MODEL_KEY = 'from-env'
  try {
    const resolve = createModelKeyResolver(fakeCtx({}))
    assert.equal(await resolve('TREND_PRODUCER_MODEL_KEY'), 'from-env')
  } finally {
    delete process.env.TREND_PRODUCER_MODEL_KEY
  }
})

test('模型密钥：两处都没有时返回 undefined（不抛错，由调用方给可执行的提示）', async () => {
  const resolve = createModelKeyResolver(fakeCtx({}))
  assert.equal(await resolve('TREND_PRODUCER_MODEL_KEY'), undefined)
})

test('模型密钥：没有凭据服务时仍能退到进程环境', async () => {
  process.env.TREND_PRODUCER_MODEL_KEY = 'from-env'
  try {
    const resolve = createModelKeyResolver(fakeCtx(undefined))
    assert.equal(await resolve('TREND_PRODUCER_MODEL_KEY'), 'from-env')
  } finally {
    delete process.env.TREND_PRODUCER_MODEL_KEY
  }
})
