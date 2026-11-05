import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DslBlockView } from './blocks.js'
import { rewriteStockAnchors, splitArticle } from './dsl.js'
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
  return (
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
    </div>
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

/** R1 仅高亮展示；点击定位随 R2 案例股表。 */
function StockAnchor({ code, label }: { code: string; label: string }) {
  return <span className="wg-stock-anchor" data-code={code}>{label}</span>
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
