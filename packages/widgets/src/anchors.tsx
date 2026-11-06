import * as React from 'react'
import { splitInlineAnchors } from './dsl.js'
import { useEvidenceIndex } from './evidence.js'

/** DSL 块正文里的内联锚渲染：个股徽章 / 证据徽章，与 markdown 游程视觉一致。 */
export function AnchorText({ text }: { text: string }): React.ReactElement {
  const parts = React.useMemo(() => splitInlineAnchors(text), [text])
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return <React.Fragment key={index}>{part.text}</React.Fragment>
        if (part.kind === 'stock') {
          return <StockAnchor key={index} code={part.code} label={part.label} />
        }
        return <UnitAnchor key={index} unitId={part.unitId} label={part.label} />
      })}
    </>
  )
}

/** R1 仅高亮展示；点击定位随 R2 案例股表。 */
export function StockAnchor({ code, label }: { code: string; label: string }): React.ReactElement {
  return <span className="wg-stock-anchor" data-code={code}>{label}</span>
}

/**
 * 证据锚：讲师原话。正文里以虚线术语样式呈现并带角标序号，
 * 完整出处（编号 / 原话 / 语料 ID）见文末「证据出处」清单。
 */
export function UnitAnchor({ unitId, label }: { unitId: string; label: string }): React.ReactElement {
  const evidence = useEvidenceIndex()
  const entry = evidence?.get(unitId)
  return (
    <span
      className="wg-unit-anchor"
      data-unit-id={unitId}
      title={entry !== undefined ? `证据 ${entry.index} · ${entry.label}` : `证据 ${unitId}`}
    >
      {label}
      {entry !== undefined ? <sup className="wg-evidence-mark">{entry.index}</sup> : null}
    </span>
  )
}
