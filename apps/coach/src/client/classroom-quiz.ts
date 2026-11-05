import type { QuizQuestion } from '../shared/contracts.js'

export interface QuizWrongAnswer {
  question: QuizQuestion
  selectedIndex: number | null
  correctIndex: number
  explanation: string
}

export interface QuizGrade {
  total: number
  correct: number
  wrong: QuizWrongAnswer[]
}

/** 课堂内本地评分：答案随题目下发，选择与结果不回传云端。 */
export function gradeQuiz(
  questions: readonly QuizQuestion[],
  answers: readonly (number | null | undefined)[],
): QuizGrade {
  const wrong: QuizWrongAnswer[] = []
  let correct = 0
  questions.forEach((question, index) => {
    const selected = answers[index]
    if (selected === question.answerIndex) {
      correct += 1
      return
    }
    wrong.push({
      question,
      selectedIndex: typeof selected === 'number' ? selected : null,
      correctIndex: question.answerIndex,
      explanation: question.explanation,
    })
  })
  return { total: questions.length, correct, wrong }
}
