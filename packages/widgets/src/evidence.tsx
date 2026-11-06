import * as React from 'react'

/** 一条证据（正文里的 `[[unit:…]]` 锚）与其在本文中的序号。 */
export interface EvidenceEntry {
  index: number
  unitId: string
  label: string
}

export type EvidenceIndex = Map<string, EvidenceEntry>

/**
 * 按正文出现顺序给证据编号；同一 unitId 复用首次编号。
 * 序号与文末「证据出处」清单一一对应，正文只留角标不重复铺陈。
 */
export function buildEvidenceIndex(markdown: string): EvidenceIndex {
  const index: EvidenceIndex = new Map()
  let seq = 0
  for (const match of markdown.matchAll(/\[\[unit:([^|\]]*)(?:\|([^\]]*))?\]\]/g)) {
    const unitId = (match[1] ?? '').trim()
    if (unitId === '' || index.has(unitId)) continue
    seq += 1
    const label = (match[2] ?? '').trim()
    index.set(unitId, { index: seq, unitId, label: label !== '' ? label : unitId.slice(0, 8) })
  }
  return index
}

const EvidenceContext = React.createContext<EvidenceIndex | null>(null)

export function EvidenceProvider({ index, children }: { index: EvidenceIndex; children: React.ReactNode }) {
  return <EvidenceContext.Provider value={index}>{children}</EvidenceContext.Provider>
}

export function useEvidenceIndex(): EvidenceIndex | null {
  return React.useContext(EvidenceContext)
}

/** 文末证据出处清单：折叠展示，列出讲师原话与语料 ID。 */
export function EvidenceList({ index }: { index: EvidenceIndex }): React.ReactElement | null {
  const entries = [...index.values()]
  if (entries.length === 0) return null
  return (
    <details className="wg-evidence-list">
      <summary className="wg-evidence-summary">证据出处 · {entries.length} 条</summary>
      <ul className="wg-evidence-items">
        {entries.map(entry => (
          <li key={entry.unitId} className="wg-evidence-item">
            <span className="wg-evidence-num">{entry.index}</span>
            <span className="wg-evidence-text">{entry.label}</span>
            <code className="wg-evidence-id">{entry.unitId}</code>
          </li>
        ))}
      </ul>
    </details>
  )
}
