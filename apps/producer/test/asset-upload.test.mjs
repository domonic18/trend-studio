import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AssetUploader } from '../lib/host/asset-upload.js'
import { TrendCloudClient } from '../lib/host/cloud-client.js'

const ASSET_ID = 'asset_0123456789abcdef'

async function collectBytes(body) {
  if (body === undefined) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** fakeAuth：记录请求并按脚本回放；直传的流式 body 会被收集成字节。 */
function fakeAuth(handlers) {
  const calls = []
  return {
    calls,
    async request(path, init) {
      const bytes = await collectBytes(init.body)
      calls.push({ path, method: init.method, headers: init.headers, bytes })
      const match = handlers.find(handler => handler.match(path, init))
      if (match === undefined) throw new Error(`unexpected request: ${init.method} ${path}`)
      const { status, payload } = typeof match.reply === 'function' ? match.reply(path, init) : match.reply
      const body = payload === undefined ? '' : JSON.stringify(payload)
      return new Response(status === 204 ? null : body, {
        status,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      })
    },
    async requestJson(path, init) {
      return await (await this.request(path, init)).json()
    },
  }
}

function assetPayload(overrides = {}) {
  return {
    assetId: ASSET_ID,
    courseId: 'TC-ZONGLUN',
    title: '第1讲 原片',
    status: 'uploaded',
    durationMs: null,
    sourceSizeBytes: null,
    errorCode: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

test('直传：摘要与字节数本地算，PUT 走路径+查询，凭据里的主机不参与', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trend-upload-'))
  const file = join(dir, 'lesson.mp4')
  const content = Buffer.from('fake-video-bytes')
  await writeFile(file, content)
  const digest = createHash('sha256').update(content).digest('hex')

  const auth = fakeAuth([
    {
      match: (path, init) => init.method === 'POST' && path.endsWith('/upload-ticket'),
      reply: {
        status: 201,
        payload: {
          assetId: ASSET_ID,
          uploadUrl: `https://public.example.com/v1/admin/content/media-assets/${ASSET_ID}/source?expires=9999&size=${content.length}&sig=abc`,
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          expiresAt: 9999,
        },
      },
    },
    {
      match: (path, init) => init.method === 'PUT',
      reply: { status: 200, payload: { asset: assetPayload() } },
    },
    {
      match: (path, init) => init.method === 'POST' && path.endsWith('/upload-confirm'),
      reply: { status: 200, payload: { asset: assetPayload({ sourceSizeBytes: content.length }) } },
    },
  ])

  const result = await new AssetUploader(new TrendCloudClient(auth)).upload({ assetId: ASSET_ID, path: file })

  assert.equal(result.sha256, digest)
  assert.equal(result.sizeBytes, content.length)
  assert.equal(result.status, 'uploaded')

  const ticketCall = auth.calls[0]
  assert.equal(ticketCall.method, 'POST')
  assert.equal(JSON.parse(ticketCall.bytes.toString('utf8')).sha256, digest)
  assert.equal(JSON.parse(ticketCall.bytes.toString('utf8')).sizeBytes, content.length)

  const putCall = auth.calls[1]
  assert.equal(putCall.method, 'PUT')
  assert.equal(putCall.path, `/v1/admin/content/media-assets/${ASSET_ID}/source?expires=9999&size=${content.length}&sig=abc`)
  assert.equal(putCall.headers['x-file-sha256'], digest)
  assert.equal(putCall.headers['content-type'], 'application/octet-stream')
  assert.deepEqual(putCall.bytes, content)

  const confirmCall = auth.calls[2]
  assert.equal(confirmCall.method, 'POST')
  assert.deepEqual(JSON.parse(confirmCall.bytes.toString('utf8')), { assetId: ASSET_ID, sizeBytes: content.length, sha256: digest })
})

test('直传凭据失效：报「重新签发」而不是「会话失效」', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trend-upload-'))
  const file = join(dir, 'lesson.mp4')
  await writeFile(file, Buffer.from('x'))

  const auth = fakeAuth([
    {
      match: (path, init) => init.method === 'POST' && path.endsWith('/upload-ticket'),
      reply: {
        status: 201,
        payload: {
          assetId: ASSET_ID,
          uploadUrl: `https://public.example.com/v1/admin/content/media-assets/${ASSET_ID}/source?expires=9999&size=1&sig=abc`,
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          expiresAt: 9999,
        },
      },
    },
    {
      match: (path, init) => init.method === 'PUT',
      reply: { status: 401, payload: { error: { code: 'unauthorized', message: 'unauthorized' } } },
    },
  ])

  const error = await new AssetUploader(new TrendCloudClient(auth))
    .upload({ assetId: ASSET_ID, path: file })
    .then(() => undefined, e => e)
  assert.equal(error.businessCode, 'upload_ticket_invalid')
  assert.match(error.message, /重新签发/)
})

test('上传路径不存在：报入参错误，不发任何请求', async () => {
  const auth = fakeAuth([])
  const error = await new AssetUploader(new TrendCloudClient(auth))
    .upload({ assetId: ASSET_ID, path: '/tmp/不存在的文件.mp4' })
    .then(() => undefined, e => e)
  assert.equal(error.name, 'InputError')
  assert.equal(auth.calls.length, 0)
})
