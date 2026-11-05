import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLessonScript, LessonPlayer } from '../lib/client/classroom-lesson.js'
import { gradeQuiz } from '../lib/client/classroom-quiz.js'

const quizQuestions = [
  { questionId: 'q_1', prompt: '题一', options: ['A', 'B'], answerIndex: 0, explanation: '解析一' },
  { questionId: 'q_2', prompt: '题二', options: ['A', 'B', 'C'], answerIndex: 2, explanation: '解析二' },
  { questionId: 'q_3', prompt: '题三', options: ['A', 'B'], answerIndex: 1, explanation: '解析三' },
]

const segmentsOf = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    kind: 'paragraph',
    text: `第 ${index} 段`,
  }))

function fakeEngine() {
  const calls = { spoken: [], paused: 0, resumed: 0, cancelled: 0, options: [] }
  let current
  return {
    calls,
    speak(text, options) {
      calls.spoken.push(text)
      calls.options.push(options)
      current = options
    },
    pause() {
      calls.paused += 1
    },
    resume() {
      calls.resumed += 1
    },
    cancel() {
      calls.cancelled += 1
    },
    finish() {
      current?.onEnd()
    },
    fail(code) {
      current?.onError(code)
    },
  }
}

test('buildLessonScript 按标题、段落、列表与图示切段并清理 Markdown', () => {
  const markdown = [
    '# 均线系统',
    '',
    '均线是**趋势**的[核心](https://example.com)工具。',
    '它用于观察方向。',
    '',
    '- 短期均线',
    '- 长期均线',
    '',
    '![均线交叉示意](figure:fig_1)',
    '',
    '```js',
    'console.log(1)',
    '```',
  ].join('\n')

  const segments = buildLessonScript(markdown)
  assert.deepEqual(segments.map((segment) => segment.text), [
    '均线系统',
    '均线是趋势的核心工具。 它用于观察方向。',
    '短期均线',
    '长期均线',
    '图示：均线交叉示意',
  ])
  assert.equal(segments[0].kind, 'heading')
  assert.equal(segments[0].level, 1)
  assert.equal(segments[2].kind, 'list')
  assert.equal(segments[4].kind, 'paragraph')
})

test('buildLessonScript 跳过规则线与空内容', () => {
  assert.deepEqual(buildLessonScript(''), [])
  assert.deepEqual(buildLessonScript('  \n\n---\n\n```\ncode\n```\n'), [])
})

test('buildLessonScript 跳过视频片段引用行', () => {
  const markdown = ['均线用于观察方向。', '', '对应视频片段：`seg-tc101-m1-kp1-1`', '', '再看排列关系。'].join('\n')
  assert.deepEqual(buildLessonScript(markdown).map((segment) => segment.text), [
    '均线用于观察方向。',
    '再看排列关系。',
  ])
})

test('buildLessonScript 将超长段落按句切分并标记续段', () => {
  const sentence = '趋势交易需要等待确认信号。'
  const script = buildLessonScript(sentence.repeat(30) + '结束')
  assert.ok(script.length > 1)
  for (const segment of script) assert.ok(segment.text.length <= 240)
  assert.equal(script.map((segment) => segment.text).join(''), sentence.repeat(30) + '结束')
  assert.equal(script[0].continued, undefined)
  assert.equal(script[1].continued, true)
})

test('LessonPlayer 自动顺读并在最后一段结束', () => {
  const engine = fakeEngine()
  const snapshots = []
  const player = new LessonPlayer({
    segments: segmentsOf(2),
    engine,
    onChange: (snapshot) => snapshots.push(snapshot),
  })

  player.toggle()
  assert.equal(player.snapshot().status, 'playing')
  assert.deepEqual(engine.calls.spoken, ['第 0 段'])

  engine.finish()
  assert.equal(player.snapshot().index, 1)
  assert.deepEqual(engine.calls.spoken, ['第 0 段', '第 1 段'])

  engine.finish()
  assert.equal(player.snapshot().status, 'ended')

  player.play()
  assert.equal(player.snapshot().index, 0)
  assert.equal(engine.calls.spoken.at(-1), '第 0 段')
  assert.ok(snapshots.length >= 4)
})

test('LessonPlayer 暂停、继续与停止', () => {
  const engine = fakeEngine()
  const player = new LessonPlayer({ segments: segmentsOf(2), engine })

  player.play()
  player.pause()
  assert.equal(player.snapshot().status, 'paused')
  assert.equal(engine.calls.paused, 1)

  player.play()
  assert.equal(player.snapshot().status, 'playing')
  assert.equal(engine.calls.resumed, 1)

  player.stop()
  assert.equal(player.snapshot().status, 'manual')
  assert.equal(engine.calls.cancelled, 1)

  const spokenBefore = engine.calls.spoken.length
  engine.finish()
  assert.equal(engine.calls.spoken.length, spokenBefore)
  assert.equal(player.snapshot().status, 'manual')
})

test('LessonPlayer 上一段、下一段与点选段落', () => {
  const engine = fakeEngine()
  const player = new LessonPlayer({ segments: segmentsOf(3), engine })

  player.play()
  player.next()
  assert.equal(player.snapshot().index, 1)
  assert.equal(engine.calls.spoken.at(-1), '第 1 段')

  player.previous()
  assert.equal(player.snapshot().index, 0)

  player.setIndex(2)
  assert.equal(player.snapshot().index, 2)
  assert.equal(engine.calls.spoken.at(-1), '第 2 段')

  player.setIndex(9)
  assert.equal(player.snapshot().index, 2)
})

test('LessonPlayer 在结束时点选段落可从该段重新开始', () => {
  const engine = fakeEngine()
  const player = new LessonPlayer({ segments: segmentsOf(2), engine })

  player.play()
  engine.finish()
  engine.finish()
  assert.equal(player.snapshot().status, 'ended')

  player.setIndex(0)
  assert.equal(player.snapshot().status, 'idle')
  player.play()
  assert.equal(engine.calls.spoken.at(-1), '第 0 段')
})

test('LessonPlayer 调整语速会重读当前段', () => {
  const engine = fakeEngine()
  const player = new LessonPlayer({ segments: segmentsOf(2), engine })

  player.play()
  player.setRate(1.2)
  assert.equal(player.snapshot().rate, 1.2)
  assert.equal(engine.calls.cancelled, 1)
  assert.equal(engine.calls.spoken.at(-1), '第 0 段')
  assert.equal(engine.calls.options.at(-1).rate, 1.2)
})

test('LessonPlayer 无语音引擎时降级为文字讲解', () => {
  const player = new LessonPlayer({ segments: segmentsOf(2) })

  player.play()
  assert.equal(player.snapshot().status, 'manual')
  player.next()
  assert.equal(player.snapshot().index, 1)
  player.previous()
  assert.equal(player.snapshot().index, 0)
})

test('LessonPlayer 语音错误后降级为文字讲解', () => {
  const engine = fakeEngine()
  const player = new LessonPlayer({ segments: segmentsOf(2), engine })

  player.play()
  engine.fail('not-allowed')
  assert.equal(player.snapshot().status, 'manual')
  assert.equal(player.snapshot().error, 'not-allowed')
})

test('LessonPlayer dispose 后不再回调', () => {
  const engine = fakeEngine()
  let calls = 0
  const player = new LessonPlayer({
    segments: segmentsOf(2),
    engine,
    onChange: () => {
      calls += 1
    },
  })

  player.play()
  player.dispose()
  const before = calls
  engine.finish()
  player.play()
  assert.equal(calls, before)
  assert.equal(engine.calls.cancelled, 1)
})

test('gradeQuiz 计算得分并保留错题解析', () => {
  const grade = gradeQuiz(quizQuestions, [0, 1, 1])
  assert.equal(grade.total, 3)
  assert.equal(grade.correct, 2)
  assert.deepEqual(grade.wrong, [{
    question: quizQuestions[1],
    selectedIndex: 1,
    correctIndex: 2,
    explanation: '解析二',
  }])
})

test('gradeQuiz 全部答对时没有错题', () => {
  const grade = gradeQuiz(quizQuestions, [0, 2, 1])
  assert.equal(grade.correct, 3)
  assert.deepEqual(grade.wrong, [])
})

test('gradeQuiz 将未作答计入错题并标记为空选择', () => {
  const grade = gradeQuiz(quizQuestions, [0, undefined, null])
  assert.equal(grade.correct, 1)
  assert.deepEqual(grade.wrong.map(item => ({
    questionId: item.question.questionId,
    selectedIndex: item.selectedIndex,
    correctIndex: item.correctIndex,
  })), [
    { questionId: 'q_2', selectedIndex: null, correctIndex: 2 },
    { questionId: 'q_3', selectedIndex: null, correctIndex: 1 },
  ])
})

test('gradeQuiz 对空题库返回零分与空复习清单', () => {
  assert.deepEqual(gradeQuiz([], []), { total: 0, correct: 0, wrong: [] })
})
