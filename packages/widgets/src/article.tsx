import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DslBlockView } from './blocks.js'
import { StockAnchor, UnitAnchor } from './anchors.js'
import { rewriteStockAnchors, splitArticle } from './dsl.js'
import { EvidenceList, EvidenceProvider, buildEvidenceIndex } from './evidence.js'
import type { ArticleHost } from './types.js'

/** 教材正文渲染器：markdown 游程 + DSL 容器块 + 个股锚徽章 + figure: 遗留图片引用。 */
export function ArticleRenderer({
  markdown,
  host,
}: {
  markdown: string
  host: ArticleHost
}) {
  const segments = splitArticle(markdown)
  const evidence = React.useMemo(() => buildEvidenceIndex(markdown), [markdown])
  return (
    <EvidenceProvider index={evidence}>
      <div className="wg-article">
        {segments.map((segment, index) =>
          segment.kind === 'block' ? (
            <DslBlockView
              key={index}
              directive={segment.directive}
              attrs={segment.attrs}
              bodyLines={segment.bodyLines}
              host={host}
            />
          ) : (
            <MarkdownRun key={index} text={segment.text} host={host} />
          ),
        )}
        <EvidenceList index={evidence} />
      </div>
    </EvidenceProvider>
  )
}

function MarkdownRun({ text, host }: { text: string; host: ArticleHost }) {
  return (
    <div className="wg-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'object', 'embed', 'style', 'form', 'input']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            typeof href === 'string' && href.startsWith('stock-anchor:')
              ? <StockAnchor code={href.slice('stock-anchor:'.length)} label={flatten(children)} />
              : typeof href === 'string' && href.startsWith('unit-anchor:')
                ? <UnitAnchor unitId={href.slice('unit-anchor:'.length)} label={flatten(children)} />
                : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
          img: ({ src, alt }) => (
            typeof src === 'string' && src.startsWith('figure:')
              ? <DslBlockView
                  directive="figure"
                  attrs={{ figureId: src.slice('figure:'.length), caption: alt ?? '' }}
                  bodyLines={[]}
                  host={host}
                />
              : <img src={src} alt={alt} />
          ),
        }}
      >
        {rewriteStockAnchors(text)}
      </ReactMarkdown>
    </div>
  )
}

function flatten(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props
    return flatten(props?.children)
  }
  return ''
}
