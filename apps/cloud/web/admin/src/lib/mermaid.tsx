import { useEffect, useId, useRef, useState } from 'react'
import { useTheme } from '../theme'

type MermaidApi = (typeof import('mermaid'))['default']

interface RenderState {
  svg: string | null
  bind: ((element: HTMLElement) => void) | null
  error: string | null
}

let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(module => module.default)
  return mermaidPromise
}

export function MermaidBlock({ code }: { code: string }) {
  const { mode } = useTheme()
  const [state, setState] = useState<RenderState>({ svg: null, bind: null, error: null })
  const containerRef = useRef<HTMLDivElement>(null)
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  useEffect(() => {
    let cancelled = false
    setState({ svg: null, bind: null, error: null })
    void (async () => {
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: mode === 'dark' ? 'dark' : 'default',
        })
        const { svg, bindFunctions } = await mermaid.render(renderId, code)
        if (!cancelled) setState({ svg, bind: bindFunctions ?? null, error: null })
      } catch (error) {
        if (!cancelled) {
          setState({ svg: null, bind: null, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, mode, renderId])

  useEffect(() => {
    if (state.bind !== null && containerRef.current !== null) {
      state.bind(containerRef.current)
    }
  }, [state])

  if (state.error !== null) {
    return (
      <div className="mermaid-block mermaid-block-error">
        <div className="mermaid-block-error-title">Mermaid 渲染失败（下方为源码）</div>
        <pre><code>{code}</code></pre>
        <div className="mermaid-block-error-detail">{state.error}</div>
      </div>
    )
  }

  if (state.svg === null) {
    return <div className="mermaid-block mermaid-block-loading">图表渲染中…</div>
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-block"
      // mermaid 以 securityLevel=strict 生成 SVG，标签内容已由 mermaid 自身转义
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
}
