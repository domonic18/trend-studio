import type { BarReplayDecisionSpec as ReplayDecision } from '../spec-types.js'
import { formatPosition } from './format.js'

export interface DecisionPanelProps {
  decision: ReplayDecision
  /** 已作答记录；undefined 表示尚未作答。 */
  answer: { selected: number; correct: boolean } | undefined
  onAnswer: (optionIndex: number) => void
  onUnitClick: (unitId: string, atMs?: number) => void
  /** 作答后显式继续回放；缺省则不渲染继续按钮。 */
  onContinue?: () => void
}

/** 判断面板：位于图表下方，判断时不被图表遮挡；作答后揭晓老师原话并等用户继续。 */
export function DecisionPanel({ decision, answer, onAnswer, onUnitClick, onContinue }: DecisionPanelProps) {
  const locked = answer !== undefined
  return (
    <div className="wg-replay-decision">
      <div className="wg-replay-decision-label">判断点</div>
      <div className="wg-replay-decision-question">{decision.question}</div>
      <div className="wg-replay-decision-options">
        {decision.options.map((opt, i) => {
          const isSelected = answer?.selected === i
          const isCorrect = i === decision.correct
          let stateClass = ''
          if (locked && isCorrect) stateClass = 'wg-replay-option-correct'
          else if (locked && isSelected) stateClass = 'wg-replay-option-wrong'
          return (
            <button
              key={i}
              type="button"
              className={`wg-replay-option ${stateClass}`}
              disabled={locked}
              onClick={() => onAnswer(i)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {locked ? (
        <div className="wg-replay-reveal">
          <div className="wg-replay-reveal-head">揭晓</div>
          <p className="wg-replay-reveal-text">{decision.revealText}</p>
          <div className="wg-replay-reveal-foot">
            <button
              type="button"
              className="wg-replay-unit-link"
              onClick={() => onUnitClick(decision.unitId, decision.atMs)}
            >
              老师原话 · {formatPosition(decision.atMs)}
            </button>
            {onContinue !== undefined ? (
              <button type="button" className="wg-replay-btn wg-replay-btn-primary" onClick={onContinue}>
                继续回放
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
