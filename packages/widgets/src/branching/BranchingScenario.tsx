/**
 * branching-scenario 渲染器：决策树情境练习（架构 §6.6.5）。
 * 学员逐节点作答，选项给出即时反馈；走完全程对照最优路径给出小结。
 * 作答只在本机内存，不落库、不进 validation、不进 provenance。
 */

import { useState } from 'react'
import type { BranchingNode, BranchingScenarioSpec } from '../spec-types.js'

export function BranchingScenario({ spec }: { spec: BranchingScenarioSpec }) {
  const byId = new Map(spec.nodes.map(node => [node.id, node]))
  const [nodeId, setNodeId] = useState(spec.entryId)
  const [feedback, setFeedback] = useState<{ label: string; text: string } | null>(null)
  const [visited, setVisited] = useState<string[]>([spec.entryId])

  const node: BranchingNode | undefined = byId.get(nodeId)
  if (node === undefined) {
    return <div className="wg-branch-error">决策树节点 {nodeId} 不存在。</div>
  }
  const terminal = node.options === undefined || node.options.length === 0
  const onOptimal = terminal && visited.join('>') === spec.optimalPath.join('>')

  const choose = (option: { label: string; next: string; feedback: string }): void => {
    setFeedback({ label: option.label, text: option.feedback })
  }
  const advance = (next: string): void => {
    setNodeId(next)
    setVisited(prev => [...prev, next])
    setFeedback(null)
  }
  const restart = (): void => {
    setNodeId(spec.entryId)
    setVisited([spec.entryId])
    setFeedback(null)
  }

  return (
    <div className="wg-branch">
      <p className="wg-branch-scenario">{spec.scenario}</p>
      <div className="wg-branch-step">
        <span className="wg-branch-step-index">第 {visited.length} 步</span>
        <p className="wg-branch-prompt">{node.prompt}</p>
      </div>
      {feedback !== null ? (
        <div className="wg-branch-feedback">
          <b className="wg-branch-feedback-title">{feedback.label}</b>
          <p className="wg-branch-feedback-text">{feedback.text}</p>
        </div>
      ) : null}
      {!terminal ? (
        <div className="wg-branch-options">
          {node.options!.map(option => (
            <button
              key={option.label}
              type="button"
              className={`wg-branch-option${feedback?.label === option.label ? ' active' : ''}`}
              disabled={feedback !== null}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {feedback !== null && !terminal ? (
        <div className="wg-branch-next">
          <button
            type="button"
            className="wg-branch-btn"
            onClick={() => advance(node.options!.find(option => option.label === feedback.label)?.next ?? nodeId)}
          >
            继续
          </button>
        </div>
      ) : null}
      {terminal ? (
        <div className="wg-branch-summary">
          <p className="wg-branch-summary-text">
            {onOptimal ? '你的路径与最优路径一致：判断链条完整。' : '已走到终点。与最优路径对照，注意哪一步的判据不同。'}
          </p>
          <div className="wg-branch-paths">
            <span className="wg-branch-path">你的路径：{visited.join(' → ')}</span>
            <span className="wg-branch-path">最优路径：{spec.optimalPath.join(' → ')}</span>
          </div>
          <button type="button" className="wg-branch-btn" onClick={restart}>重新走一遍</button>
        </div>
      ) : null}
    </div>
  )
}
