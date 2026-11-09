/**
 * 生产看板视图：每节一行——步骤状态、产出计数、最近评审结论。
 *
 * 步骤中文标签由宿主随载荷下发（stepLabels），浏览器不自带第二份口径。
 */
import type { ReactElement } from 'react'
import type { ProducerPanelBoard, ProducerPanelSection, ProducerPanelStep } from '../shared/panel-contract.js'

/** 步骤状态 → 样式类；未知状态按 pending 呈现，不臆造语义。 */
function stepClass(step: ProducerPanelStep): string {
  switch (step.status) {
    case 'done':
      return 'tp-step tp-step-done'
    case 'running':
      return 'tp-step tp-step-running'
    case 'failed':
    case 'blocked':
      return 'tp-step tp-step-failed'
    default:
      return 'tp-step'
  }
}

function stepLabel(board: ProducerPanelBoard, step: ProducerPanelStep): string {
  return board.stepLabels[step.step] ?? step.step
}

function sectionView(board: ProducerPanelBoard, section: ProducerPanelSection): ReactElement {
  const counts: Array<[string, number]> = [
    ['文章', section.articleVersion ?? 0],
    ['课件', section.widgetCount],
    ['图示', section.figureCount],
    ['案例股', section.caseStockCount],
  ]
  return (
    <div className="tp-section" key={section.sectionId}>
      <p className="tp-section-title">{section.title}</p>
      <ul className="tp-steps">
        {section.steps.map(step => (
          <li className={stepClass(step)} key={step.step} title={step.note ?? undefined}>
            {stepLabel(board, step)}
          </li>
        ))}
      </ul>
      <div className="tp-counts">
        {counts.map(([label, value]) => (
          <span key={label}>{label} {value}</span>
        ))}
        {section.reviewVerdict === 'approve' && <span className="tp-verdict-approve">评审通过</span>}
        {section.reviewVerdict === 'reject' && <span className="tp-verdict-reject">评审驳回</span>}
      </div>
    </div>
  )
}

/** 看板正文：课程标题 + 各节。 */
export function BoardView({ board }: { board: ProducerPanelBoard }): ReactElement {
  if (board.sections.length === 0) {
    return <p className="tp-hint">这门课还没有生产节。选一门有内容的课程看看。</p>
  }
  return (
    <div>
      <p className="tp-muted">{board.courseTitle}</p>
      {board.sections.map(section => sectionView(board, section))}
    </div>
  )
}
