import * as React from 'react'
import { splitInlineAnchors } from './dsl.js'

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

/** 证据锚：指向语料 unit。学员端只展示标识，点击由宿主接管。 */
export function UnitAnchor({ unitId, label }: { unitId: string; label: string }): React.ReactElement {
  return (
    <span className="wg-unit-anchor" data-unit-id={unitId} title={`证据 ${unitId}`}>
      {label}
    </span>
  )
}
