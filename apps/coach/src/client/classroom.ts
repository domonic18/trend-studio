import * as React from 'react'
import type { CatalogChapterArticle, ChapterQuiz } from '../shared/contracts.js'
import type { RemoteCatalogChapterResult } from './dsh.js'
import {
  buildLessonScript,
  createBrowserSpeechEngine,
  LessonPlayer,
  type LessonSegment,
  type LessonSnapshot,
} from './classroom-lesson.js'
import { gradeQuiz, type QuizGrade } from './classroom-quiz.js'

const DISCLAIMER = '课程内容仅供学习，不构成投资建议。'

interface ClassroomTabInfoHook {
  (): {
    tab: {
      navigation: {
        address: string
        params?: Record<string, unknown>
        revision: number
      }
    }
  }
}

export interface ClassroomPanelProps {
  useTabInfo?: ClassroomTabInfoHook
  catalogChapter: (courseId: string, chapterId: string) => Promise<RemoteCatalogChapterResult>
}

const buttonStyle = (active: boolean): React.CSSProperties => ({
  border: '1px solid #d0d7de',
  background: active ? '#2a6ebb' : '#fff',
  color: active ? '#fff' : '#333',
  borderRadius: 4,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 12,
})

const controlStyle = (disabled: boolean): React.CSSProperties => ({
  ...buttonStyle(false),
  opacity: disabled ? 0.45 : 1,
  cursor: disabled ? 'default' : 'pointer',
})

function LessonTranscript({
  segments,
  index,
  currentRef,
  onSelect,
}: {
  segments: LessonSegment[]
  index: number
  currentRef: React.RefObject<HTMLDivElement | null>
  onSelect: (index: number) => void
}): React.ReactElement {
  return React.createElement(
    'div',
    { style: { flex: 1, minHeight: 160, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4, padding: 4 } },
    ...segments.map((segment, position) => {
      const active = position === index
      const heading = segment.kind === 'heading' && segment.continued !== true
      return React.createElement(
        'div',
        {
          key: segment.id,
          ref: active ? currentRef : undefined,
          role: 'button',
          tabIndex: 0,
          onClick: () => onSelect(position),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(position)
            }
          },
          style: {
            padding: '5px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            background: active ? '#eaf2fd' : 'transparent',
            borderLeft: active ? '3px solid #2a6ebb' : '3px solid transparent',
            marginBottom: 2,
          },
        },
        React.createElement(
          'span',
          { style: { color: '#999', fontSize: 11, marginRight: 6 } },
          heading ? '标题' : segment.kind === 'list' ? '要点' : String(position + 1),
        ),
        React.createElement(
          'span',
          {
            style: heading
              ? { fontWeight: 600, fontSize: (segment.level ?? 3) <= 2 ? 15 : 14 }
              : { fontSize: 13, lineHeight: 1.55 },
          },
          segment.text,
        ),
      )
    }),
  )
}

function QuizSection({ quiz }: { quiz: ChapterQuiz }): React.ReactElement {
  const [answers, setAnswers] = React.useState<(number | null)[]>(quiz.questions.map(() => null))
  const [grade, setGrade] = React.useState<QuizGrade | undefined>(undefined)

  React.useEffect(() => {
    setAnswers(quiz.questions.map(() => null))
    setGrade(undefined)
  }, [quiz])

  const allAnswered = answers.every(answer => answer !== null)

  const select = (questionIndex: number, optionIndex: number): void => {
    if (grade !== undefined) return
    setAnswers(list => list.map((answer, index) => (index === questionIndex ? optionIndex : answer)))
  }

  const reset = (): void => {
    setAnswers(quiz.questions.map(() => null))
    setGrade(undefined)
  }

  return React.createElement(
    'details',
    { style: { borderTop: '1px solid #eee', paddingTop: 8, flexShrink: 0 } },
    React.createElement(
      'summary',
      { style: { cursor: 'pointer', fontWeight: 600, fontSize: 14 } },
      `随堂测验（${quiz.questions.length} 题 · 题库 v${quiz.version}`
        + `${grade === undefined ? '' : ` · 得分 ${grade.correct}/${grade.total}`}）`,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 } },
      ...quiz.questions.map((question, questionIndex) => {
      const selected = answers[questionIndex]
      const wrong = grade?.wrong.find(item => item.question.questionId === question.questionId)
      const feedback = grade === undefined
        ? null
        : wrong === undefined
          ? React.createElement(
            'div',
            { style: { color: '#1a7f37', fontSize: 12 } },
            `回答正确。${question.explanation}`,
          )
          : React.createElement(
            'div',
            { style: { color: '#b42318', fontSize: 12 } },
            `${wrong.selectedIndex === null ? '未作答' : '回答错误'} · 正确答案 `
              + `${String.fromCharCode(65 + wrong.correctIndex)}。${wrong.explanation}`,
          )
      return React.createElement(
        'div',
        { key: question.questionId, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        React.createElement(
          'div',
          { style: { fontWeight: 600, fontSize: 13 } },
          `${questionIndex + 1}. ${question.prompt}`,
        ),
        ...question.options.map((option, optionIndex) => {
          const active = selected === optionIndex
          const isCorrect = grade !== undefined && optionIndex === question.answerIndex
          const isWrongPick = wrong !== undefined && wrong.selectedIndex === optionIndex
          return React.createElement(
            'button',
            {
              key: optionIndex,
              type: 'button',
              disabled: grade !== undefined,
              onClick: () => select(questionIndex, optionIndex),
              style: {
                textAlign: 'left',
                border: `1px solid ${isCorrect
                  ? '#1a7f37'
                  : isWrongPick
                    ? '#b42318'
                    : active
                      ? '#2a6ebb'
                      : '#d0d7de'}`,
                background: isCorrect
                  ? '#ecfdf3'
                  : isWrongPick
                    ? '#fef3f2'
                    : active
                      ? '#eaf2fd'
                      : '#fff',
                color: '#333',
                borderRadius: 4,
                padding: '4px 8px',
                cursor: grade === undefined ? 'pointer' : 'default',
                fontSize: 12,
              },
            },
            `${String.fromCharCode(65 + optionIndex)}. ${option}`,
          )
        }),
        feedback,
      )
    }),
    grade === undefined
      ? React.createElement(
        'button',
        {
          type: 'button',
          disabled: !allAnswered,
          style: controlStyle(!allAnswered),
          onClick: () => setGrade(gradeQuiz(quiz.questions, answers)),
        },
        allAnswered ? '提交答案' : '请完成全部题目',
      )
      : React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        React.createElement(
          'div',
          { style: { fontWeight: 600, fontSize: 13 } },
          `得分 ${grade.correct} / ${grade.total}`,
        ),
        grade.wrong.length === 0
          ? React.createElement(
            'div',
            { style: { color: '#1a7f37', fontSize: 12 } },
            '全部答对，本章要点已掌握。',
          )
          : React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            React.createElement(
              'div',
              { style: { fontWeight: 600, fontSize: 12 } },
              `复习清单（${grade.wrong.length}）`,
            ),
            ...grade.wrong.map(item => React.createElement(
              'div',
              { key: item.question.questionId, style: { color: '#555', fontSize: 12 } },
              `· ${item.question.prompt} — 正确答案 ${String.fromCharCode(65 + item.correctIndex)}`,
            )),
          ),
        React.createElement('button', { type: 'button', style: buttonStyle(false), onClick: reset }, '重做'),
      ),
    ),
  )
}

export function ClassroomPanel({
  useTabInfo,
  catalogChapter,
}: ClassroomPanelProps): React.ReactElement {
  const info = useTabInfo === undefined ? undefined : useTabInfo()
  const params = (info?.tab.navigation.params ?? {}) as Record<string, unknown>
  const revision = info?.tab.navigation.revision ?? 0
  const courseId = typeof params.courseId === 'string' && params.courseId.length > 0 ? params.courseId : undefined
  const chapterId = typeof params.chapterId === 'string' && params.chapterId.length > 0 ? params.chapterId : undefined

  const [activeChapterId, setActiveChapterId] = React.useState<string | undefined>(chapterId)
  const [chapter, setChapter] = React.useState<CatalogChapterArticle | undefined>(undefined)
  const [segments, setSegments] = React.useState<LessonSegment[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [snapshot, setSnapshot] = React.useState<LessonSnapshot>({ index: 0, status: 'idle', rate: 1 })

  const engine = React.useMemo(() => createBrowserSpeechEngine(), [])
  const playerRef = React.useRef<LessonPlayer | undefined>(undefined)
  const currentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    setActiveChapterId(chapterId)
  }, [chapterId, revision])

  React.useEffect(() => {
    if (courseId === undefined || activeChapterId === undefined) {
      setChapter(undefined)
      setSegments([])
      setLoading(false)
      setError(undefined)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    setChapter(undefined)
    setSegments([])
    void (async () => {
      try {
        const result = await catalogChapter(courseId, activeChapterId)
        if (cancelled) return
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setChapter(result.value)
        setSegments(result.value.article === null ? [] : buildLessonScript(result.value.article.markdown))
      } catch (failure: unknown) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '章节教材读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [catalogChapter, courseId, activeChapterId])

  React.useEffect(() => {
    if (segments.length === 0) return
    const player = new LessonPlayer({
      segments,
      ...(engine === undefined ? {} : { engine }),
      onChange: setSnapshot,
    })
    playerRef.current = player
    setSnapshot(player.snapshot())
    return () => {
      player.dispose()
      if (playerRef.current === player) playerRef.current = undefined
    }
  }, [segments, engine])

  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [snapshot.index])

  const player = playerRef.current
  const statusText = engine === undefined
    ? '当前环境不支持语音合成，已切换为文字讲解。'
    : snapshot.error !== undefined
      ? '语音播放中断，已切换为文字讲解。'
      : snapshot.status === 'playing'
        ? '讲解中…'
        : snapshot.status === 'paused'
          ? '已暂停'
          : snapshot.status === 'ended'
            ? '本章讲解结束'
            : snapshot.status === 'manual'
              ? '已停止；可选择任意段落逐段讲解。'
              : '准备开始。'

  const playLabel = snapshot.status === 'playing'
    ? '暂停'
    : snapshot.status === 'paused'
      ? '继续'
      : snapshot.status === 'ended'
        ? '重新讲解'
        : '开始讲解'

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        height: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
      },
    },
    React.createElement('h4', { style: { margin: 0 } }, chapter?.title ?? '互动课堂'),
    courseId === undefined || activeChapterId === undefined
      ? React.createElement('p', { style: { color: '#666', margin: 0 } }, '请从「课程体系」的章节页点击「开始课堂」。')
      : loading
        ? React.createElement('p', { style: { color: '#666', margin: 0 } }, '正在加载章节教材…')
        : error !== undefined
          ? React.createElement('p', { style: { color: '#b42318', margin: 0 } }, error)
          : React.createElement(
            React.Fragment,
            null,
            chapter?.article === null
              ? React.createElement('p', { style: { color: '#666', margin: 0 } }, '本章教材暂未发布，暂不能开始课堂。')
              : segments.length === 0
                ? React.createElement('p', { style: { color: '#666', margin: 0 } }, '本章教材没有可讲解的内容。')
                : React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                    React.createElement('button', {
                      type: 'button',
                      style: controlStyle(segments.length === 0),
                      disabled: segments.length === 0,
                      onClick: () => player?.toggle(),
                    }, playLabel),
                    React.createElement('button', {
                      type: 'button',
                      style: controlStyle(snapshot.index === 0),
                      disabled: snapshot.index === 0,
                      onClick: () => player?.previous(),
                    }, '上一段'),
                    React.createElement('button', {
                      type: 'button',
                      style: controlStyle(snapshot.index >= segments.length - 1),
                      disabled: snapshot.index >= segments.length - 1,
                      onClick: () => player?.next(),
                    }, '下一段'),
                    React.createElement('button', {
                      type: 'button',
                      style: controlStyle(snapshot.status === 'idle'),
                      disabled: snapshot.status === 'idle',
                      onClick: () => player?.stop(),
                    }, '停止'),
                    React.createElement(
                      'label',
                      { style: { marginLeft: 'auto', color: '#666', fontSize: 12 } },
                      '语速 ',
                      React.createElement(
                        'select',
                        {
                          value: String(snapshot.rate),
                          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                            player?.setRate(Number(event.target.value)),
                          style: { fontSize: 12 },
                        },
                        ...[0.8, 1, 1.2].map((rate) =>
                          React.createElement('option', { key: rate, value: String(rate) }, `${rate}×`),
                        ),
                      ),
                    ),
                  ),
                  React.createElement('div', { style: { color: '#666', fontSize: 12 } },
                    `${statusText} 第 ${snapshot.index + 1} / ${segments.length} 段`),
                  React.createElement(LessonTranscript, {
                    segments,
                    index: snapshot.index,
                    currentRef,
                    onSelect: (index: number) => playerRef.current?.setIndex(index),
                  }),
                  React.createElement(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                    ...(chapter?.adjacentChapters ?? []).map((adjacent) =>
                      React.createElement('button', {
                        key: adjacent.chapterId,
                        type: 'button',
                        style: buttonStyle(false),
                        onClick: () => setActiveChapterId(adjacent.chapterId),
                      }, `${adjacent.title} · ${adjacent.chapterId}`),
                    ),
                  ),
                ),
            chapter === undefined || chapter.quiz == null
              ? null
              : React.createElement(QuizSection, { quiz: chapter.quiz }),
          ),
    React.createElement('p', { style: { margin: 0, color: '#888', fontSize: 12 } }, DISCLAIMER),
  )
}
