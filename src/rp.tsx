/**
 * 角色扮演专用渲染（酒馆角色卡输出的特殊内容）：
 * - HTML 状态栏 / 美化面板：放进无脚本的沙箱 iframe 里真正渲染
 * - <stats> 之类的自定义标签、「键: 值」代码块：玻璃状态卡（数组变标签，0/100 变进度条）
 * - <think> / <inner> / 心声：折叠
 * - 行内 <span style> / <font> 等：白名单净化后渲染
 * - 台词引号高亮（交给 Markdown 的 rp 模式）
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './md/Markdown'
import { Icon } from './icons'

type Seg =
  | { k: 'md'; t: string }
  | { k: 'lite'; t: string }
  | { k: 'html'; t: string; done: boolean }
  | { k: 'status'; title: string; rows: [string, string][]; rest: string }
  | { k: 'fold'; title: string; t: string; done: boolean }
  | { k: 'box'; title: string; t: string }

const BLOCK = new Set('div details summary table thead tbody tr td th section article aside header footer nav center figure figcaption style ul ol li blockquote h1 h2 h3 h4 h5 h6 hr pre svg progress meter dl dt dd fieldset legend p'.split(' '))
const INLINE = new Set('span font b i u s em strong small big sub sup ruby rt rp br mark del ins q abbr img a code kbd'.split(' '))
const FOLD: Record<string, string> = { think: '思考', thinking: '思考', thought: '思考', thoughts: '思考', inner: '心声', 'inner_thoughts': '心声', monologue: '心声', 内心: '心声', 心声: '心声', 思考: '思考', 心理: '心理', analysis: '分析', plan: '构思', 构思: '构思' }
const TITLE: Record<string, string> = { stats: '状态', status: '状态', statusblock: '状态', status_block: '状态', 状态: '状态', 状态栏: '状态', info: '信息', inventory: '背包', summary: '摘要', 摘要: '摘要', scene: '场景', options: '选项', choices: '选项', 选项: '选项', time: '时间', location: '地点' }

/* ---------- 键值 */
const KV = /^\s*(?:[-*•]\s*)?([^:：\n]{1,28}?)\s*[:：]\s*(.*)$/
export function kv(text: string): [string, string][] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const rows: [string, string][] = []
  for (const l of lines) { const m = l.match(KV); if (m && !/^https?$/i.test(m[1])) rows.push([m[1].replace(/^\*\*|\*\*$/g, ''), m[2]]) }
  return rows.length >= 2 && rows.length / lines.length >= 0.6 ? rows : null
}

/* ---------- 切分 */
function findClose(src: string, name: string, from: number) {
  const re = new RegExp(`<(/?)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s>/])[^>]*?(/?)>`, 'gi')
  re.lastIndex = from
  let depth = 1, m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[2]) continue
    depth += m[1] ? -1 : 1
    if (depth === 0) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

export function segment(src: string, depth = 0): Seg[] {
  const out: Seg[] = []
  let buf = ''
  const flush = () => {
    if (!buf.trim()) { buf = ''; return }
    out.push(/<\/?([a-z]+)[\s>/]/i.test(buf) && [...buf.matchAll(/<\/?([a-z]+)/gi)].some(m => INLINE.has(m[1].toLowerCase())) ? { k: 'lite', t: buf } : { k: 'md', t: buf })
    buf = ''
  }
  const tagRe = /<([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff:-]*)(\s[^<>]*)?>|```([\w-]*)[^\n]*\n/g
  let i = 0, m: RegExpExecArray | null
  while ((m = tagRe.exec(src))) {
    const at = m.index
    if (m[0].startsWith('```')) { // 代码块
      const lang = (m[3] || '').toLowerCase()
      const endIdx = src.indexOf('\n```', tagRe.lastIndex)
      const body = src.slice(tagRe.lastIndex, endIdx < 0 ? undefined : endIdx)
      const next = endIdx < 0 ? src.length : endIdx + 4
      const rows = /^(|text|txt|yaml|yml|ini|status|stats|plain)$/.test(lang) ? kv(body) : null
      if (lang === 'html' || rows) {
        buf += src.slice(i, at); flush()
        out.push(lang === 'html' ? { k: 'html', t: body, done: endIdx >= 0 } : { k: 'status', title: TITLE[lang] || '状态', rows: rows!, rest: '' })
        i = next; tagRe.lastIndex = next; continue
      }
      // 普通代码块原样交给 Markdown
      tagRe.lastIndex = next; continue
    }
    const name = m[1], low = name.toLowerCase()
    if (INLINE.has(low)) continue
    const close = findClose(src, name, tagRe.lastIndex)
    const inner = src.slice(tagRe.lastIndex, close ? close.start : undefined)
    const next = close ? close.end : src.length
    buf += src.slice(i, at); flush()
    if (BLOCK.has(low)) out.push({ k: 'html', t: src.slice(at, next), done: !!close })
    else if (FOLD[low] || FOLD[name]) out.push({ k: 'fold', title: FOLD[low] || FOLD[name], t: inner.trim(), done: !!close })
    else {
      const body = inner.replace(/^\s*```[\w-]*\n?|\n?```\s*$/g, '').trim()
      const rows = kv(body)
      if (rows) out.push({ k: 'status', title: TITLE[low] || name, rows, rest: '' })
      else if (depth < 2 && /<[a-z]/i.test(body)) { out.push({ k: 'box', title: TITLE[low] || name, t: body }) }
      else out.push({ k: 'box', title: TITLE[low] || name, t: body })
    }
    i = next; tagRe.lastIndex = next
  }
  buf += src.slice(i); flush()
  return out
}

/* ---------- 净化（行内 HTML） */
const OK_TAG = new Set([...INLINE, 'p', 'br', 'div', 'hr', 'q-rp'])
export function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      const t = c.tagName.toLowerCase()
      if (!OK_TAG.has(t)) { if (t === 'script' || t === 'style' || t === 'iframe' || t === 'object') c.remove(); else { c.replaceWith(...c.childNodes) } continue }
      for (const a of [...c.attributes]) {
        const n = a.name.toLowerCase()
        if (n === 'style') { c.setAttribute('style', a.value.replace(/url\s*\([^)]*\)|expression\s*\(|position\s*:\s*fixed/gi, '')); continue }
        if ((n === 'color' || n === 'size' || n === 'title' || n === 'alt') || (n === 'href' && /^https?:/i.test(a.value)) || (n === 'src' && /^(https?:|data:image\/)/i.test(a.value))) continue
        c.removeAttribute(a.name)
      }
      if (t === 'a') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noreferrer noopener') }
      walk(c)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
const liteMd = (t: string) => t.trim()
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/(“[^”\n]*”|「[^」\n]*」|"[^"\n<>]*")/g, '<q-rp>$1</q-rp>')
  .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

/* ---------- 组件 */
function HtmlFrame({ html, done }: { html: string; done: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(60)
  const doc = useMemo(() => {
    const clean = html.replace(/<script[\s\S]*?(<\/script>|$)/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent;font:15px/1.6 "Anthropic Sans","Hanken Grotesk","Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif;color:#141a26;word-break:break-word;overflow:hidden}img,video{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}*{box-sizing:border-box;max-width:100%}details>summary{cursor:pointer}</style></head><body><div id="lumi-root" style="display:flow-root">${clean}</div></body></html>`
  }, [html])
  useEffect(() => {
    const f = ref.current; if (!f) return
    let ro: ResizeObserver | undefined
    const fit = () => { const r = f.contentDocument?.getElementById('lumi-root'); if (r) setH(Math.max(16, Math.ceil(r.getBoundingClientRect().height))) }
    const onLoad = () => {
      fit()
      const d = f.contentDocument
      const r = d?.getElementById('lumi-root'); if (d && r) { ro = new ResizeObserver(fit); ro.observe(r); d.addEventListener('toggle', fit, true); d.addEventListener('click', () => setTimeout(fit, 30)) }
    }
    f.addEventListener('load', onLoad)
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect() }
  }, [doc])
  if (!done) return <div className="rp-wait"><span className="rp-shim" />面板生成中…</div>
  return <iframe ref={ref} className="rp-frame" title="角色面板" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} />
}

function Val({ v }: { v: string }) {
  const t = v.trim()
  if (/^\[.*\]$/.test(t)) {
    let items: string[] = []
    try { const j = JSON.parse(t); if (Array.isArray(j)) items = j.map(String) } catch { items = t.slice(1, -1).split(/[,，、]/).map(x => x.trim().replace(/^["'「]|["'」]$/g, '')) }
    items = items.filter(Boolean)
    return items.length ? <span className="rp-chips">{items.map((x, i) => <span key={i}>{x}</span>)}</span> : <span className="rp-na">无</span>
  }
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(.*)$/)
  const pct = t.match(/^(\d+(?:\.\d+)?)\s*%(.*)$/)
  if ((frac && Number(frac[2]) > 0) || pct) {
    const p = frac ? Math.max(0, Math.min(1, Number(frac[1]) / Number(frac[2]))) : Math.min(1, Number(pct![1]) / 100)
    return <span className="rp-bar"><span className="rp-track"><span style={{ width: `${p * 100}%` }} /></span><span className="mono">{frac ? `${frac[1]}/${frac[2]}` : `${pct![1]}%`}</span>{(frac?.[3] || pct?.[2] || '').trim() && <span className="rp-na">{(frac?.[3] || pct?.[2] || '').trim()}</span>}</span>
  }
  if (/^[?？]{2,}/.test(t)) return <span className="rp-na">{t}</span>
  return <span>{t}</span>
}

function Status({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rp-status">
      <div className="rp-st-head"><span className="rp-st-dot" />{title}</div>
      <div className="rp-grid">{rows.map(([k, v], i) => <div key={i} className={`rp-kv ${/^\[|\/|%/.test(v.trim()) || v.length > 18 ? 'wide' : ''}`}><span className="rp-k">{k}</span><Val v={v} /></div>)}</div>
    </div>
  )
}

function Fold({ title, t, done }: { title: string; t: string; done: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rp-fold ${open ? 'open' : ''}`}>
      <button onClick={() => setOpen(!open)}><Icon n="spark" s={14} w={2} />{title}{!done && <span className="rp-na">…</span>}<Icon n="down" s={14} w={2.2} /></button>
      {open && <div className="rp-fold-body"><Markdown src={t} /></div>}
    </div>
  )
}

export const RpView = memo(function RpView({ src, streaming }: { src: string; streaming?: boolean }) {
  const segs = useMemo(() => segment(src), [src])
  return <div className="rp-view">{segs.map((s, i) => {
    switch (s.k) {
      case 'md': return <Markdown key={i} src={s.t} streaming={streaming && i === segs.length - 1} rp />
      case 'lite': return <div key={i} className="md rp-lite" dangerouslySetInnerHTML={{ __html: sanitize(liteMd(s.t)) }} />
      case 'html': return <HtmlFrame key={i} html={s.t} done={s.done || !streaming} />
      case 'status': return <Status key={i} title={s.title} rows={s.rows} />
      case 'fold': return <Fold key={i} title={s.title} t={s.t} done={s.done || !streaming} />
      case 'box': return <div key={i} className="rp-box"><div className="rp-st-head"><span className="rp-st-dot" />{s.title}</div><RpView src={s.t} /></div>
    }
  })}</div>
})
