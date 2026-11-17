/*
 * Generated UI (增强): the model answers with a ```lumi-ui``` JSON block and it renders as native cards,
 * in the spirit of ChatGPT's in-chat interactive UI. Unknown types are ignored; bad JSON while streaming
 * shows a skeleton. Buttons send their prompt back as the next user message.
 */
import type { ReactNode } from 'react'

type N = Record<string, any> // model-produced JSON, validated loosely at render time

export const GENUI_PROMPT = `当结构化信息更适合用界面展示时（对比、数据、步骤、清单、日程、天气、行程、选项等），在回答中输出一个代码块，语言标记为 lumi-ui，内容是 JSON，可与普通 Markdown 混排。可用组件：
{"type":"card","title":"","subtitle":"","badge":"","children":[组件...]}
{"type":"stats","items":[{"label":"","value":"","delta":"+3%","tone":"up|down"}]}
{"type":"list","title":"","items":[{"title":"","subtitle":"","trailing":""}]}
{"type":"steps","items":[{"title":"","desc":""}]}
{"type":"kv","items":[{"k":"","v":""}]}
{"type":"progress","label":"","value":0-100}
{"type":"chart","kind":"bar|line","title":"","labels":[""],"values":[0]}
{"type":"callout","tone":"info|warn|ok","text":""}
{"type":"buttons","items":[{"label":"","prompt":"点击后发送给你的话"}]}
顶层可以是单个组件或组件数组。只在确实有帮助时使用，JSON 必须合法，不要使用 emoji。`

function Stats({ n }: { n: N }) {
  return <div className="ui-stats">{(n.items || []).map((s: N, i: number) => (
    <div key={i} className="ui-stat"><div className="ui-lbl">{s.label}</div><div className="ui-val">{s.value}</div>
      {s.delta && <div className={`ui-delta ${s.tone === 'down' ? 'down' : 'up'}`}>{s.delta}</div>}</div>))}</div>
}

function Chart({ n }: { n: N }) {
  const vals: number[] = (n.values || []).map(Number).filter((v: number) => isFinite(v))
  const labels: string[] = n.labels || []
  const max = Math.max(...vals, 1e-9)
  if (n.kind === 'line') {
    const W = 300, H = 110, pts = vals.map((v, i) => [vals.length > 1 ? (i / (vals.length - 1)) * W : W / 2, H - 8 - (v / max) * (H - 20)])
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
    return <div className="ui-chart">{n.title && <div className="ui-h">{n.title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="ui-line"><path d={`${d}L${W},${H}L0,${H}Z`} className="area" /><path d={d} className="stroke" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" />)}</svg>
      <div className="ui-xl">{labels.map((l, i) => <span key={i}>{l}</span>)}</div></div>
  }
  return <div className="ui-chart">{n.title && <div className="ui-h">{n.title}</div>}
    <div className="ui-bars">{vals.map((v, i) => <div key={i} className="ui-barcol"><span className="ui-bv">{v}</span>
      <div className="ui-bar" style={{ height: `${6 + (v / max) * 94}%`, animationDelay: `${i * 40}ms` }} /><span className="ui-bl">{labels[i]}</span></div>)}</div></div>
}

function Node({ n, onAction }: { n: N; onAction?: (s: string) => void }): ReactNode {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n)) return <>{n.map((c, i) => <Node key={i} n={c} onAction={onAction} />)}</>
  switch (n.type) {
    case 'card': return (
      <div className="ui-card">
        {(n.title || n.badge) && <div className="ui-card-h"><div><div className="ui-title">{n.title}</div>{n.subtitle && <div className="ui-sub">{n.subtitle}</div>}</div>
          {n.badge && <span className="ui-badge">{n.badge}</span>}</div>}
        {n.text && <div className="ui-text">{n.text}</div>}
        {(n.children || []).map((c: N, i: number) => <Node key={i} n={c} onAction={onAction} />)}
      </div>)
    case 'stats': return <Stats n={n} />
    case 'list': return <div className="ui-list">{n.title && <div className="ui-h">{n.title}</div>}{(n.items || []).map((it: N, i: number) => (
      <div key={i} className="ui-li"><div className="ui-dot">{i + 1}</div><div className="grow"><div className="ui-lt">{it.title}</div>{it.subtitle && <div className="ui-sub">{it.subtitle}</div>}</div>
        {it.trailing && <div className="ui-trail">{it.trailing}</div>}</div>))}</div>
    case 'steps': return <div className="ui-steps">{(n.items || []).map((it: N, i: number) => (
      <div key={i} className="ui-step"><div className="ui-node">{i + 1}</div><div><div className="ui-lt">{it.title}</div>{it.desc && <div className="ui-sub">{it.desc}</div>}</div></div>))}</div>
    case 'kv': return <div className="ui-kv">{(n.items || []).map((it: N, i: number) => <div key={i}><span>{it.k}</span><b>{it.v}</b></div>)}</div>
    case 'progress': { const v = Math.max(0, Math.min(100, Number(n.value) || 0)); return (
      <div className="ui-prog"><div className="ui-prog-h"><span>{n.label}</span><b>{v}%</b></div><div className="ui-track"><div style={{ width: `${v}%` }} /></div></div>) }
    case 'chart': return <Chart n={n} />
    case 'callout': return <div className={`ui-callout ${n.tone || 'info'}`}>{n.text}</div>
    case 'buttons': return <div className="ui-btns">{(n.items || []).map((b: N, i: number) => (
      <button key={i} className="ui-btn" onClick={() => onAction?.(b.prompt || b.label)}>{b.label}</button>))}</div>
    default: return null
  }
}

export function GenUI({ src, onAction }: { src: string; onAction?: (s: string) => void }) {
  let data: N | null = null
  try { data = JSON.parse(src) } catch { /* still streaming */ }
  if (!data) return <div className="ui-skel"><div /><div /><div /><span>正在生成界面…</span></div>
  return <div className="ui-root fade"><Node n={data} onAction={onAction} /></div>
}
