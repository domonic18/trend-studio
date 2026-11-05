import { useQuery } from '@tanstack/react-query'
import { isValidElement, useEffect, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Spin } from 'antd'
import { getFigureCandidateBlob } from '../api'
import { MermaidBlock } from './mermaid'

export interface MarkdownFigure {
  figureId: string
  selectedCandidateId: string | null
}

export function MarkdownPreview({
  value,
  figures,
}: {
  value: string
  figures?: MarkdownFigure[]
}) {
  if (value.trim() === '') {
    return <div className="markdown-empty">左侧输入 Markdown，右侧实时预览。</div>
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['script', 'iframe', 'object', 'embed', 'style', 'form', 'input']}
        unwrapDisallowed
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          img: ({ node: _node, src, alt }) => (
            <FigureImage src={typeof src === 'string' ? src : undefined} alt={alt} figures={figures} />
          ),
          pre: ({ node: _node, children }) => {
            const mermaid = extractMermaid(children)
            if (mermaid !== null) return <MermaidBlock code={mermaid} />
            return <pre>{children}</pre>
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

function extractMermaid(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const props = child.props as { className?: string; children?: ReactNode }
  if (!/language-mermaid/.test(props.className ?? '')) return null
  const code = String(props.children ?? '').replace(/\n$/, '')
  return code.trim() === '' ? null : code
}

function FigureImage({
  src,
  alt,
  figures,
}: {
  src?: string
  alt?: string
  figures?: MarkdownFigure[]
}) {
  const isFigureRef = src !== undefined && src.startsWith('figure:')
  const figureId = isFigureRef ? src.slice('figure:'.length) : null
  const selectedCandidateId = isFigureRef && figures !== undefined
    ? (figures.find(f => f.figureId === figureId)?.selectedCandidateId ?? null)
    : null

  const blob = useQuery({
    queryKey: ['content', 'markdown-figure', figureId, selectedCandidateId],
    queryFn: () => getFigureCandidateBlob(selectedCandidateId as string),
    enabled: isFigureRef && selectedCandidateId !== null,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })

  useEffect(() => {
    const url = blob.data
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [blob.data])

  if (!isFigureRef) {
    return <img src={src} alt={alt} />
  }
  if (selectedCandidateId === null) {
    return <span className="markdown-figure-missing">🖼 {alt ?? figureId}（无候选图）</span>
  }
  if (blob.isLoading) {
    return <Spin size="small" />
  }
  const dataUrl = blob.data ?? undefined
  if (dataUrl === undefined) {
    return <span className="markdown-figure-missing">🖼 {alt ?? figureId}（图加载失败）</span>
  }
  return <img src={dataUrl} alt={alt ?? figureId ?? undefined} className="markdown-figure" />
}
