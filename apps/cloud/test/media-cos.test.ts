import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import Fastify from 'fastify'
import { loadConfig, type AppConfig } from '../src/config.js'
import { createCosStore, type CosStore } from '../src/media/cos-store.js'
import { joinObjectKey, objectKeyResolver, rewritePlaylist, tokenResolver } from '../src/media/playlist.js'
import { registerMediaRoutes } from '../src/media/routes.js'
import { signPlaybackToken } from '../src/playback/sign.js'

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-KEY:METHOD=AES-128,URI="enc.key"',
  '#EXTINF:4.000,',
  'seg_0001.ts',
  '#EXTINF:4.000,',
  'seg_0002.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

test('播放列表改写（本地模式）：分片与密钥引用都追加播放令牌', async () => {
  const rewritten = await rewritePlaylist(PLAYLIST, tokenResolver('tok123'))
  assert.match(rewritten, /URI="enc\.key\?token=tok123"/)
  assert.match(rewritten, /^seg_0001\.ts\?token=tok123$/m)
  assert.match(rewritten, /^seg_0002\.ts\?token=tok123$/m)
  assert.match(rewritten, /#EXT-X-ENDLIST/)
})

test('播放列表改写（对象存储模式）：引用解析成预签名绝对地址', async () => {
  const rewritten = await rewritePlaylist(
    PLAYLIST,
    objectKeyResolver('hls/asset-1', async key => `https://bucket.cos.ap-shanghai.myqcloud.com/${key}?sig=x`),
  )
  assert.match(rewritten, /URI="https:\/\/bucket\.cos\.ap-shanghai\.myqcloud\.com\/hls\/asset-1\/enc\.key\?sig=x"/)
  assert.match(rewritten, /^https:\/\/bucket\.cos\.ap-shanghai\.myqcloud\.com\/hls\/asset-1\/seg_0001\.ts\?sig=x$/m)
})

test('播放列表改写：注释行与标签原样保留', async () => {
  const rewritten = await rewritePlaylist('#EXTM3U\n#EXTINF:4.000,\n', async ref => ref)
  assert.equal(rewritten, '#EXTM3U\n#EXTINF:4.000,\n')
})

test('对象键解析：只允许播放列表同目录，拒绝上级目录', () => {
  assert.equal(joinObjectKey('hls/a', 'seg.ts'), 'hls/a/seg.ts')
  assert.equal(joinObjectKey('', 'hls/a/seg.ts'), 'hls/a/seg.ts')
  assert.throws(() => joinObjectKey('hls/a', '../b/seg.ts'), /invalid playlist reference/)
  assert.throws(() => joinObjectKey('hls/a', ''), /invalid playlist reference/)
})

test('配置：MEDIA_STORAGE=cos 时必填项缺失即拒绝启动', () => {
  const base = { APP_ENV: 'local', DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  assert.throws(() => loadConfig({ ...base, MEDIA_STORAGE: 'cos' }), /COS_REGION 必填/)
  assert.throws(
    () => loadConfig({ ...base, MEDIA_STORAGE: 'cos', COS_REGION: 'ap-shanghai' }),
    /COS_BUCKET 必填/,
  )
  assert.throws(
    () => loadConfig({
      ...base,
      MEDIA_STORAGE: 'cos',
      COS_REGION: 'ap-shanghai',
      COS_BUCKET: 'trend-coach-media',
      COS_SECRET_ID: 'id',
    }),
    /COS_SECRET_KEY 必填/,
  )
})

test('配置：cos 模式补齐默认值，且与本地目录/视频管线互斥', () => {
  const base = {
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    MEDIA_STORAGE: 'cos',
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'trend-coach-media',
    COS_SECRET_ID: 'id',
    COS_SECRET_KEY: 'key',
  }
  const config = loadConfig(base)
  assert.equal(config.mediaStorage, 'cos')
  assert.equal(config.cos?.endpoint, 'cos.ap-shanghai.myqcloud.com')
  assert.equal(config.cos?.virtualHost, true)
  assert.equal(config.cos?.secure, true)

  assert.throws(() => loadConfig({ ...base, MEDIA_LOCAL_DIR: '/media' }), /不得设置 MEDIA_LOCAL_DIR/)
  assert.throws(
    () => loadConfig({
      ...base,
      PIPELINE_ENABLED: 'true',
      PIPELINE_STORAGE_DIR: '/data/pipeline',
      PIPELINE_HLS_DIR: '/data/hls',
    }),
    /不得启用视频管线/,
  )
})

test('配置：默认仍是本地存储', () => {
  const config = loadConfig({ APP_ENV: 'local', DATABASE_URL: 'postgres://u:p@localhost:5432/db' })
  assert.equal(config.mediaStorage, 'local')
  assert.equal(config.cos, undefined)
})

/** 假的对象存储：只按 key 返回预置内容。 */
function fakeCos(objects: Record<string, string>): CosStore {
  return {
    bucket: 'test-bucket',
    async presignedGet(key) {
      return `https://bucket.cos.ap-shanghai.myqcloud.com/${key}?sig=stub`
    },
    async stat(key) {
      const body = objects[key]
      if (body === undefined) return undefined
      return { size: Buffer.byteLength(body), contentType: 'application/octet-stream' }
    },
    async getBuffer(key) {
      const body = objects[key]
      return body === undefined ? undefined : Buffer.from(body)
    },
    async getStream(key, range) {
      const body = objects[key]
      if (body === undefined) return undefined
      const buffer = Buffer.from(body)
      if (range === undefined) return Readable.from(buffer)
      return Readable.from(buffer.subarray(range.start, range.end + 1))
    },
    async put() {},
    async remove() {},
  }
}

test('对象存储模式：播放列表由应用改写成预签名分片地址', async () => {
  const config = loadConfig({
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    MEDIA_STORAGE: 'cos',
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'trend-coach-media',
    COS_SECRET_ID: 'id',
    COS_SECRET_KEY: 'key',
    MEDIA_SIGNING_SECRET: 'test-media-signing-secret',
  }) as AppConfig
  const pool = { query: async () => ({ rowCount: 1 }) } as never
  const app = Fastify()
  registerMediaRoutes(app, {
    config,
    pool,
    cos: fakeCos({ 'hls/asset-1/index.m3u8': PLAYLIST, 'hls/asset-1/seg_0001.ts': 'segment-bytes' }),
  })
  const token = signPlaybackToken(config.mediaSigningSecret, {
    v: 1,
    p: 'hls/asset-1',
    e: Date.now() + 60_000,
    s: 'session-1',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/media/hls/asset-1/index.m3u8',
    query: { token },
  })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] as string, /mpegurl/)
  assert.match(response.body, /https:\/\/bucket\.cos\.ap-shanghai\.myqcloud\.com\/hls\/asset-1\/seg_0001\.ts\?sig=stub/)
  await app.close()
})

test('对象存储模式：分片兜底走应用时透传 Range', async () => {
  const config = loadConfig({
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    MEDIA_STORAGE: 'cos',
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'trend-coach-media',
    COS_SECRET_ID: 'id',
    COS_SECRET_KEY: 'key',
    MEDIA_SIGNING_SECRET: 'test-media-signing-secret',
  }) as AppConfig
  const pool = { query: async () => ({ rowCount: 1 }) } as never
  const app = Fastify()
  registerMediaRoutes(app, {
    config,
    pool,
    cos: fakeCos({ 'hls/asset-1/seg_0001.ts': 'segment-bytes' }),
  })
  const token = signPlaybackToken(config.mediaSigningSecret, {
    v: 1,
    p: 'hls/asset-1',
    e: Date.now() + 60_000,
    s: 'session-1',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/media/hls/asset-1/seg_0001.ts',
    query: { token },
    headers: { range: 'bytes=0-6' },
  })
  assert.equal(response.statusCode, 206)
  assert.equal(response.headers['content-range'], 'bytes 0-6/13')
  assert.equal(response.body, 'segment')
  await app.close()
})

test('对象存储后端：SDK 缺失对象映射为 undefined', async () => {
  const store = createCosStore(
    {
      region: 'ap-shanghai',
      bucket: 'trend-coach-media',
      endpoint: 'cos.ap-shanghai.myqcloud.com',
      secretId: 'id',
      secretKey: 'key',
      virtualHost: true,
      secure: true,
    },
    {
      statObject: async () => { throw Object.assign(new Error('missing'), { code: 'NoSuchKey' }) },
      getObject: async () => { throw Object.assign(new Error('missing'), { code: 'NoSuchKey' }) },
      getPartialObject: async () => { throw Object.assign(new Error('missing'), { code: 'NoSuchKey' }) },
      presignedGetObject: async () => 'https://example.com/x',
      putObject: async () => undefined,
      removeObject: async () => undefined,
    } as never,
  )
  assert.equal(await store.stat('hls/a/index.m3u8'), undefined)
  assert.equal(await store.getBuffer('hls/a/index.m3u8'), undefined)
  assert.equal(await store.getStream('hls/a/seg.ts'), undefined)
})
