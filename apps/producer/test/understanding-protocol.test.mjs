/**
 * 视觉模型请求的协议适配：两种协议的路径、鉴权头、消息体、响应解析都不一样。
 * 拿错协议去打会直接 404（Anthropic 端点不认 `/chat/completions`）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildVlmRequest, parseVlmResponse } from '../lib/host/understanding.js'

const FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const PARTS = [{ text: '转写文本：均线系统' }, { imageDataUrl: FRAME, label: '帧 30s' }]

function config(api) {
  return {
    apiKeyEnv: 'TREND_PRODUCER_MODEL_KEY',
    api,
    baseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32_768,
    frameEveryNth: 2,
  }
}

test('视觉模型：Anthropic 协议走 /v1/messages + x-api-key，system 独立字段', () => {
  const request = buildVlmRequest(config('anthropic-messages'), 'sk-1', PARTS, '系统提示')
  assert.equal(request.url, 'https://api.minimaxi.com/anthropic/v1/messages')
  assert.equal(request.headers['x-api-key'], 'sk-1')
  assert.equal(request.headers['anthropic-version'], '2023-06-01')
  assert.equal(request.body.system, '系统提示')
  assert.equal(request.body.temperature, undefined, 'Anthropic 请求不带 temperature')
  const messages = request.body.messages
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
})

test('视觉模型：Anthropic 的图片是 base64 source 块，标签是独立文本块', () => {
  const request = buildVlmRequest(config('anthropic-messages'), 'sk-1', PARTS, '系统提示')
  const content = request.body.messages[0].content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'text')
  assert.equal(content[1].text, '帧 30s')
  assert.equal(content[2].type, 'image')
  assert.equal(content[2].source.media_type, 'image/jpeg')
  assert.equal(content[2].source.data, '/9j/4AAQSkZJRg==')
})

test('视觉模型：OpenAI 兼容协议走 /chat/completions + Bearer，图片是 image_url 块', () => {
  const request = buildVlmRequest(config('openai-completions'), 'sk-2', PARTS, '系统提示')
  assert.equal(request.url, 'https://api.minimaxi.com/anthropic/chat/completions')
  assert.equal(request.headers.authorization, 'Bearer sk-2')
  assert.equal(request.body.system, undefined)
  const messages = request.body.messages
  assert.equal(messages[0].role, 'system')
  const content = messages[1].content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  assert.equal(content[1].image_url.url, FRAME)
})

test('视觉模型：baseUrl 末尾斜杠不留双斜杠', () => {
  const request = buildVlmRequest(
    { ...config('anthropic-messages'), baseUrl: 'https://api.minimaxi.com/anthropic/' },
    'sk-1',
    PARTS,
    '系统提示',
  )
  assert.equal(request.url, 'https://api.minimaxi.com/anthropic/v1/messages')
})

test('视觉模型：Anthropic 响应先回 thinking 块，只取 text 块', () => {
  const result = parseVlmResponse(config('anthropic-messages'), {
    content: [
      { type: 'thinking', thinking: 'We need answer...' },
      { type: 'text', text: '[{"startMs":0}]' },
    ],
    usage: { input_tokens: 122, output_tokens: 23 },
  })
  assert.equal(result.content, '[{"startMs":0}]')
  assert.equal(result.inTokens, 122)
  assert.equal(result.outTokens, 23)
})

test('视觉模型：Anthropic 只回 thinking 块时报错，不能把思考当答案', () => {
  assert.throws(
    () => parseVlmResponse(config('anthropic-messages'), { content: [{ type: 'thinking', thinking: '...' }] }),
    /空内容/,
  )
})

test('视觉模型：OpenAI 响应取 choices[0].message.content 与 usage', () => {
  const result = parseVlmResponse(config('openai-completions'), {
    choices: [{ message: { content: '[{"startMs":0}]' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })
  assert.equal(result.content, '[{"startMs":0}]')
  assert.equal(result.inTokens, 10)
  assert.equal(result.outTokens, 5)
})
