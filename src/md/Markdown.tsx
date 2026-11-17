/*
 * Recursive mdast renderer, structured after deepseek-ai/chat-demo (MIT)
 * components/markdown/MarkdownAstRenderer.tsx, MathFormula.tsx, CodeBlock.tsx, Link.tsx and
 * useThrottleMarkdownRender.ts. Lumi additions (增强): fenced ```lumi-ui``` blocks render as generated UI cards.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Nodes, PhrasingContent, RootContent, TableRow } from 'mdast'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import 'katex/contrib/mhchem'
import Prism from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-css'
import { toMdAst } from './parse'
import { GenUI } from '../genui'
import { Icon } from '../icons'

const ALIAS: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', md: 'markdown', html: 'markup', xml: 'markup', 'c++': 'cpp', rs: 'rust', golang: 'go' }

/** Last good KaTeX output per source, so a half-streamed formula keeps showing the previous render. */
const lastGood = new Map<string, string>()
function Formula({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      const out = katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: false, output: 'html' })
      lastGood.set(String(display), out)
      return out
    } catch {
      return null
    }
  }, [tex, display])
  if (html == null) return display ? <pre className="md-math-raw">{tex}</pre> : <code>{tex}</code>
  return display
    ? <div className="md-math" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="md-imath" dangerouslySetInnerHTML={{ __html: html }} />
}

function sanitizeUrl(u: string) {
  const t = u.trim()
  return /^(https?:|mailto:|data:image\/)/i.test(t) || t.startsWith('/') || t.startsWith('#') ? t : '#'
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const l = (lang || '').toLowerCase()
  const name = ALIAS[l] || l
  const grammar = Prism.languages[name]
  const html = grammar ? Prism.highlight(value, grammar, name) : null
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'text'}</span>
        <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
          <Icon n={copied ? 'check' : 'copy'} s={14} w={2} />{copied ? '已复制' : '复制'}
        </button>
      </div>
      {html != null ? <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre> : <pre><code>{value}</code></pre>}
    </div>
  )
}

type Ctx = { onAction?: (s: string) => void }

function phrasing(nodes: PhrasingContent[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text': return n.value
      case 'strong': return <strong key={i}>{phrasing(n.children, ctx)}</strong>
      case 'emphasis': return <em key={i}>{phrasing(n.children, ctx)}</em>
      case 'delete': return <del key={i}>{phrasing(n.children, ctx)}</del>
      case 'inlineCode': return <code key={i}>{n.value}</code>
      case 'break': return <br key={i} />
      case 'inlineMath': return <Formula key={i} tex={n.value} display={!!(n as { display?: boolean }).display} />
      case 'link': return <a key={i} href={sanitizeUrl(n.url)} target="_blank" rel="noreferrer noopener">{phrasing(n.children, ctx)}</a>
      case 'image': return <img key={i} className="md-img" src={sanitizeUrl(n.url)} alt={n.alt || ''} loading="lazy" />
      case 'html': return n.value
      default: return null
    }
  })
}

function block(nodes: RootContent[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => render(n as Nodes, i, ctx))
}

function render(n: Nodes, key: number, ctx: Ctx): ReactNode {
  switch (n.type) {
    case 'paragraph': {
      const real = n.children.filter(c => !(c.type === 'text' && !c.value.trim()))
      if (real.length === 1 && real[0].type === 'inlineMath' && (real[0] as { display?: boolean }).display) return <Formula key={key} tex={real[0].value} display />
      return <p key={key}>{phrasing(n.children, ctx)}</p>
    }
    case 'heading': { const H = `h${Math.min(n.depth + 1, 6)}` as 'h2'; return <H key={key}>{phrasing(n.children, ctx)}</H> }
    case 'blockquote': return <blockquote key={key}>{block(n.children, ctx)}</blockquote>
    case 'list': {
      const items = n.children.map((li, j) => (
        <li key={j} className={li.checked != null ? 'task' : undefined}>
          {li.checked != null && <input type="checkbox" checked={li.checked} readOnly />}
          {li.spread ? block(li.children, ctx) : li.children.map((c, k) => c.type === 'paragraph' ? <span key={k}>{phrasing(c.children, ctx)}</span> : render(c as Nodes, k, ctx))}
        </li>))
      return n.ordered ? <ol key={key} start={n.start ?? 1}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'code': return /^(lumi-ui|genui|ui)$/i.test(n.lang || '')
      ? <GenUI key={key} src={n.value} onAction={ctx.onAction} />
      : <CodeBlock key={key} lang={n.lang || ''} value={n.value} />
    case 'math': return <Formula key={key} tex={n.value} display />
    case 'thematicBreak': return <hr key={key} />
    case 'table': {
      const [head, ...rows] = n.children as TableRow[]
      const al = n.align || []
      return (
        <div key={key} className="md-table"><table>
          <thead><tr>{head?.children.map((c, j) => <th key={j} style={{ textAlign: al[j] || undefined }}>{phrasing(c.children, ctx)}</th>)}</tr></thead>
          <tbody>{rows.map((r, j) => <tr key={j}>{r.children.map((c, k) => <td key={k} style={{ textAlign: al[k] || undefined }}>{phrasing(c.children, ctx)}</td>)}</tr>)}</tbody>
        </table></div>
      )
    }
    case 'html': return <p key={key}>{n.value}</p>
    default:
      return 'children' in n ? <div key={key}>{block((n as { children: RootContent[] }).children, ctx)}</div> : null
  }
}

/** Throttled parse while streaming: re-parse at most every 2x the last parse time (cap 2s), like chat-demo. */
function useThrottled(src: string, streaming: boolean) {
  const [shown, setShown] = useState(src)
  const last = useRef(0), cost = useRef(8), timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!streaming) { setShown(src); return }
    const wait = Math.min(Math.max(cost.current * 2, 16), 2000)
    const since = performance.now() - last.current
    window.clearTimeout(timer.current)
    if (since >= wait) { last.current = performance.now(); setShown(src) }
    else timer.current = window.setTimeout(() => { last.current = performance.now(); setShown(src) }, wait - since)
    return () => window.clearTimeout(timer.current)
  }, [src, streaming])
  return { shown, cost }
}

export const Markdown = memo(function Markdown({ src, streaming = false, onAction }: { src: string; streaming?: boolean; onAction?: (s: string) => void }) {
  const { shown, cost } = useThrottled(src, streaming)
  const tree = useMemo(() => {
    const t0 = performance.now()
    const ast = toMdAst(shown)
    cost.current = performance.now() - t0
    return ast
  }, [shown, cost])
  return <div className="md">{block(tree.children, { onAction })}</div>
})
