/** Flow 编辑器（v0.17）：时间线（按块缩进）、逻辑 / 变量 / 类 / AI 视觉节点、类编辑、实时校验、每步耗时。 */
import { useEffect, useMemo, useState } from 'react'
import { GlassIcon, Icon } from './icons'
import { streamChat, type Settings } from './api'
import { riffVars, tint, useAppLook } from './appicon'
import { blockDepths, checkFlow, findClass, loadFlows, paramsIn, runFlow, runSummary, saveFlows, stepLabel, tidy, upsertFlow,
  type CondOp, type Flow, type FlowClass, type FlowCond, type FlowMethod, type FlowStep, type RunResult, type TraceItem } from './flow'

export function useFlows() {
  const [flows, setFlows] = useState<Flow[]>(loadFlows)
  useEffect(() => { const on = () => setFlows(loadFlows()); window.addEventListener('lumi-flows', on); return () => window.removeEventListener('lumi-flows', on) }, [])
  return flows
}

export function AppIcon({ app, pkg, s = 48 }: { app: string; pkg?: string; s?: number }) {
  const look = useAppLook(app, pkg)
  if (look.src) return <img className="app-ic" src={look.src} alt="" style={{ width: s, height: s }} />
  return <span className="app-ic ph" style={{ width: s, height: s, background: tint(look).icon, fontSize: s * 0.42 }}>{app.slice(0, 1)}</span>
}

/* ---------- 节点分类：图标与颜色 */
type Cat = 'act' | 'logic' | 'var' | 'cls' | 'ai'
const CAT_OF: Partial<Record<FlowStep['kind'], Cat>> = {
  if: 'logic', else: 'logic', endif: 'logic', while: 'logic', endwhile: 'logic', do: 'logic', dowhile: 'logic', for: 'logic', endfor: 'logic',
  break: 'logic', continue: 'logic', call: 'logic', set: 'var', new: 'cls', method: 'cls', bind: 'cls', unbind: 'cls', ai: 'ai',
}
const catOf = (k: FlowStep['kind']): Cat => CAT_OF[k] || 'act'
const CAT_COLOR: Record<Exclude<Cat, 'act'>, { solid: string; soft: string }> = {
  logic: { solid: '#5B47C9', soft: '#ECE8FF' },
  var: { solid: '#2563C9', soft: '#E3EEFF' },
  cls: { solid: '#0E7A66', soft: '#DDF3EE' },
  ai: { solid: '#A2550A', soft: '#FFF0D6' },
}
const kindIcon: Record<string, string> = {
  tap: 'tap', input: 'keyboard', enter: 'enter', scroll: 'scroll', swipe: 'scroll', key: 'left', wait: 'clock', sleep: 'hourglass', ai: 'eye',
  if: 'branch', else: 'branch', endif: 'check', while: 'repeat', endwhile: 'check', do: 'repeat', dowhile: 'repeat', for: 'repeat', endfor: 'check',
  set: 'braces', call: 'bolt', break: 'exit', continue: 'right', new: 'cube', method: 'method',
}
const isPointSet = (s: FlowStep) => s.kind === 'set' && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(s.value || '')
const stepIcon = (s: FlowStep) => isPointSet(s) ? 'target' : kindIcon[s.kind] || 'bolt'

/* ---------- 添加步骤 */
interface AddItem { label: string; sub: string; icon: string; cat: Cat; make: (ctx: { classes: FlowClass[]; flows: Flow[] }) => FlowStep[] }
const ex = (text = ''): FlowCond => ({ kind: 'exists', sel: { text } })
const ADD_GROUPS: { title: string; items: AddItem[] }[] = [
  { title: '基础操作', items: [
    { label: '点击文字', sub: '按文字找按钮', icon: 'tap', cat: 'act', make: () => [{ kind: 'tap', sel: { text: '' } }] },
    { label: '输入文字', sub: '可用 {参数} ${变量}', icon: 'keyboard', cat: 'act', make: () => [{ kind: 'input', text: '' }] },
    { label: '回车 / 搜索', sub: '输入法回车', icon: 'enter', cat: 'act', make: () => [{ kind: 'enter' }] },
    { label: '等待出现', sub: '等某个文字出现', icon: 'clock', cat: 'act', make: () => [{ kind: 'wait', sel: { text: '' } }] },
    { label: '等 1 秒', sub: '固定等待', icon: 'hourglass', cat: 'act', make: () => [{ kind: 'sleep', ms: 1000 }] },
    { label: '返回', sub: '系统返回键', icon: 'left', cat: 'act', make: () => [{ kind: 'key', key: 'back' }] },
    { label: '向下滚动', sub: '滚动列表', icon: 'scroll', cat: 'act', make: () => [{ kind: 'scroll', forward: true }] },
  ] },
  { title: 'AI 视觉', items: [
    { label: 'AI 点击', sub: '描述要点什么', icon: 'eye', cat: 'ai', make: () => [{ kind: 'ai', goal: '', act: 'tap' }] },
    { label: 'AI 输入', sub: '找输入框并输入', icon: 'eye', cat: 'ai', make: () => [{ kind: 'ai', goal: '', act: 'input', text: '' }] },
  ] },
  { title: '逻辑', items: [
    { label: '如果…否则', sub: 'if / else', icon: 'branch', cat: 'logic', make: () => [{ kind: 'if', cond: ex() }, { kind: 'else' }, { kind: 'endif' }] },
    { label: '如果', sub: 'if', icon: 'branch', cat: 'logic', make: () => [{ kind: 'if', cond: ex() }, { kind: 'endif' }] },
    { label: '当…时循环', sub: 'while', icon: 'repeat', cat: 'logic', make: () => [{ kind: 'while', cond: ex() }, { kind: 'scroll', forward: true }, { kind: 'endwhile' }] },
    { label: '先做再判断', sub: 'do-while', icon: 'repeat', cat: 'logic', make: () => [{ kind: 'do' }, { kind: 'scroll', forward: true }, { kind: 'dowhile', cond: ex() }] },
    { label: '计次循环', sub: 'for i 从 1 到 3', icon: 'repeat', cat: 'logic', make: () => [{ kind: 'for', var: 'i', from: 1, to: 3 }, { kind: 'sleep', ms: 500 }, { kind: 'endfor' }] },
    { label: '跳出循环', sub: 'break', icon: 'exit', cat: 'logic', make: () => [{ kind: 'break' }] },
    { label: '继续下一轮', sub: 'continue', icon: 'right', cat: 'logic', make: () => [{ kind: 'continue' }] },
  ] },
  { title: '变量', items: [
    { label: '设置变量', sub: '数字、文字、表达式', icon: 'braces', cat: 'var', make: () => [{ kind: 'set', var: 'n', value: '0' }] },
    { label: '坐标点 point', sub: '0-1 屏幕比例', icon: 'target', cat: 'var', make: () => [{ kind: 'set', var: 'p', value: '0.5,0.5' }] },
    { label: '结构体 struct', sub: '多个字段一起存', icon: 'braces', cat: 'var', make: () => [{ kind: 'set', var: 'info', value: '{"name":"","count":0}' }] },
    { label: '改字段', sub: 'obj.field = …', icon: 'braces', cat: 'var', make: () => [{ kind: 'set', var: 'info.count', value: 'info.count + 1' }] },
  ] },
  { title: '类与子流程', items: [
    { label: '新建对象', sub: 'new 类', icon: 'cube', cat: 'cls', make: ({ classes }) => [{ kind: 'new', var: classes[0] ? classes[0].name.toLowerCase().slice(0, 1) + 'obj' : 'obj', cls: classes[0]?.name || '' }] },
    { label: '调用方法', sub: 'obj.method()', icon: 'method', cat: 'cls', make: ({ classes }) => [{ kind: 'method', var: classes[0] ? classes[0].name.toLowerCase().slice(0, 1) + 'obj' : 'obj', method: classes[0]?.methods[0]?.name || '' }] },
    { label: '调用子流程', sub: '跑另一个 Flow', icon: 'bolt', cat: 'logic', make: ({ flows }) => [{ kind: 'call', flowId: flows[0]?.id || '' }] },
  ] },
]
const catStyle = (c: Cat, look: { solid: string; soft: string; ink?: string }) => c === 'act' ? { solid: look.ink || look.solid, soft: look.soft } : CAT_COLOR[c]

function AddSheet({ classes, flows, look, onAdd, onClose }: { classes: FlowClass[]; flows: Flow[]; look: { solid: string; soft: string; ink?: string }; onAdd: (s: FlowStep[]) => void; onClose: () => void }) {
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet fsheet add-sheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <div className="t18 b">添加步骤</div>
        <div className="t13" style={{ marginTop: 2 }}>加在当前展开的步骤后面；块（如果、循环）会成对加入</div>
        {ADD_GROUPS.map(g => <div key={g.title}>
          <div className="add-h">{g.title}</div>
          <div className="add-grid">{g.items.map(it => { const c = catStyle(it.cat, look); const off = (it.label === '新建对象' || it.label === '调用方法') && !classes.length; return (
            <button key={it.label} className="add-it press" disabled={off} onClick={() => onAdd(it.make({ classes, flows }))}>
              <span className="add-ic" style={{ background: c.soft, color: c.solid }}><Icon n={it.icon} s={17} w={2} /></span>
              <span className="add-tx"><b>{it.label}</b><span>{off ? '先在下面建一个类' : it.sub}</span></span>
            </button>) })}</div>
        </div>)}
      </div>
    </div>
  )
}

/* ---------- 条件 */
const OPS: CondOp[] = ['==', '!=', '>', '<', '>=', '<=', 'contains']
const OP_LABEL: Record<CondOp, string> = { '==': '等于', '!=': '不等于', '>': '大于', '<': '小于', '>=': '≥', '<=': '≤', contains: '包含' }
function CondEditor({ c, set }: { c: FlowCond; set: (c: FlowCond) => void }) {
  const kinds: [FlowCond['kind'], string][] = [['exists', '出现文字'], ['not_exists', '没有文字'], ['text', '屏幕包含'], ['var', '变量比较']]
  return <div className="cond-ed">
    <div className="seg-s">{kinds.map(([k, l]) => <button key={k} className={c.kind === k ? 'on' : ''} onClick={() => set(k === 'var' ? { kind: 'var', var: c.var || 'n', op: c.op || '==', value: c.value ?? '0' } : k === 'text' ? { kind: 'text', text: c.text || c.sel?.text || '' } : { kind: k, sel: { text: c.sel?.text || c.text || '' } })}>{l}</button>)}</div>
    {(c.kind === 'exists' || c.kind === 'not_exists') && <input className="inp" value={c.sel?.text || ''} placeholder="按钮或页面上的文字" onChange={e => set({ ...c, sel: { ...c.sel, text: e.target.value } })} />}
    {c.kind === 'text' && <input className="inp" value={c.text || ''} placeholder="屏幕上任意位置出现的文字" onChange={e => set({ ...c, text: e.target.value })} />}
    {c.kind === 'var' && <div className="row3">
      <input className="inp mono" value={c.var || ''} placeholder="变量 / obj.field" onChange={e => set({ ...c, var: e.target.value.trim() })} />
      <select className="inp sel" value={c.op || '=='} onChange={e => set({ ...c, op: e.target.value as CondOp })}>{OPS.map(o => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
      <input className="inp mono" value={c.value ?? ''} placeholder="值" onChange={e => set({ ...c, value: e.target.value })} />
    </div>}
  </div>
}

/* ---------- 单步编辑 */
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="fld"><span>{label}</span>{children}</label> }
function ArgsEditor({ names, args, set }: { names: string[]; args?: Record<string, string>; set: (a: Record<string, string> | undefined) => void }) {
  if (!names.length) return null
  return <div className="args">{names.map(k => <div key={k} className="arg"><span className="mono">{k}</span>
    <input className="inp mono" value={args?.[k] ?? ''} placeholder="默认" onChange={e => { const n = { ...(args || {}) }; if (e.target.value) n[k] = e.target.value; else delete n[k]; set(Object.keys(n).length ? n : undefined) }} /></div>)}</div>
}

function StepEditor({ s, set, f, flows, varClass }: { s: FlowStep; set: (s: FlowStep) => void; f: Flow; flows: Flow[]; varClass: Record<string, string> }) {
  const classOf = (v?: string) => findClass(s.cls || (v ? varClass[v] : undefined), flows, f)
  switch (s.kind) {
    case 'tap': return <>
      {s.pointVar != null ? <Field label="坐标变量"><input className="inp mono" value={s.pointVar} onChange={e => set({ ...s, pointVar: e.target.value.trim() })} /></Field>
        : <Field label="按文字找"><input className="inp" value={s.sel?.text || ''} onChange={e => set({ ...s, sel: { ...s.sel, text: e.target.value } })} placeholder="按钮上的文字" /></Field>}
      <div className="dev-acts">
        <button className={`chip-t ${s.vision ? 'on' : ''}`} onClick={() => set({ ...s, vision: !s.vision || undefined })}><Icon n="eye" s={13} w={2.2} />找不到时用 AI 视觉</button>
        <button className={`chip-t ${s.long ? 'on' : ''}`} onClick={() => set({ ...s, long: !s.long || undefined })}>长按</button>
      </div></>
    case 'input': return <Field label="输入"><input className="inp" value={s.text || ''} onChange={e => set({ ...s, text: e.target.value })} placeholder="可用 {参数} 或 ${变量}" /></Field>
    case 'wait': return <Field label="等这个文字"><input className="inp" value={s.sel?.text || ''} onChange={e => set({ ...s, sel: { ...s.sel, text: e.target.value } })} /></Field>
    case 'sleep': return <Field label="毫秒"><input className="inp" inputMode="numeric" value={s.ms ?? 1000} onChange={e => set({ ...s, ms: Number(e.target.value) || 0 })} /></Field>
    case 'key': return <div className="seg-s">{[['back', '返回'], ['home', '主屏'], ['recents', '最近任务']].map(([k, l]) => <button key={k} className={s.key === k ? 'on' : ''} onClick={() => set({ ...s, key: k })}>{l}</button>)}</div>
    case 'scroll': return <div className="seg-s">{[[true, '向下'], [false, '向上']].map(([k, l]) => <button key={String(k)} className={(s.forward !== false) === k ? 'on' : ''} onClick={() => set({ ...s, forward: k as boolean })}>{l as string}</button>)}</div>
    case 'launch': return <Field label="应用"><input className="inp" value={s.app || ''} onChange={e => set({ ...s, app: e.target.value })} /></Field>
    case 'ai': return <>
      <Field label="找什么"><input className="inp" value={s.goal || ''} onChange={e => set({ ...s, goal: e.target.value })} placeholder="比如 顶部的搜索框、第一篇笔记" /></Field>
      <div className="seg-s">{[['tap', '点击'], ['long', '长按'], ['input', '输入']].map(([k, l]) => <button key={k} className={(s.act || 'tap') === k ? 'on' : ''} onClick={() => set({ ...s, act: k as FlowStep['act'] })}>{l}</button>)}</div>
      {s.act === 'input' && <Field label="输入"><input className="inp" value={s.text || ''} onChange={e => set({ ...s, text: e.target.value })} placeholder="可用 {参数} 或 ${变量}" /></Field>}
      {s.sel && Object.keys(s.sel).length > 0
        ? <div className="cache-note"><Icon n="bolt" s={13} w={2.2} /><span className="grow">已缓存位置：{s.sel.text || s.sel.desc || s.sel.id}。下次直接走原生，不调模型</span><button className="chip-t" onClick={() => { const n = { ...s }; delete n.sel; delete n.x; delete n.y; set(n) }}>清除</button></div>
        : <div className="cache-note muted"><Icon n="eye" s={13} w={2.2} /><span>第一次运行要一次模型往返（截图 + 元素列表），找到后自动存下位置，之后走原生</span></div>}
    </>
    case 'if': case 'while': case 'dowhile': return <>
      <CondEditor c={s.cond || ex()} set={c => set({ ...s, cond: c })} />
      {s.kind !== 'if' && <Field label="最多几轮"><input className="inp" inputMode="numeric" value={s.max ?? ''} placeholder="默认 20" onChange={e => set({ ...s, max: Number(e.target.value) || undefined })} /></Field>}
    </>
    case 'for': return <div className="row4">
      <Field label="变量"><input className="inp mono" value={s.var || ''} onChange={e => set({ ...s, var: e.target.value.trim() })} /></Field>
      <Field label="从"><input className="inp mono" value={s.from ?? ''} onChange={e => set({ ...s, from: numOr(e.target.value) })} /></Field>
      <Field label="到"><input className="inp mono" value={s.to ?? ''} onChange={e => set({ ...s, to: numOr(e.target.value) })} /></Field>
      <Field label="步长"><input className="inp mono" value={s.step ?? ''} placeholder="1" onChange={e => set({ ...s, step: e.target.value ? numOr(e.target.value) : undefined })} /></Field>
    </div>
    case 'set': return <>
      <Field label="变量"><input className="inp mono" value={s.var || ''} onChange={e => set({ ...s, var: e.target.value.trim() })} placeholder="n、p.x、this.count" /></Field>
      <Field label="值"><input className="inp mono" value={s.value ?? ''} onChange={e => set({ ...s, value: e.target.value })} placeholder="3、'文字' + n、0.5,0.3、{&quot;k&quot;:1}、p.x + 0.1" /></Field>
      <div className="t12">数字和四则；'文字' + 变量 拼接；0.5,0.3 是坐标点；{'{…}'} 是结构体；a.b 读写字段</div>
    </>
    case 'call': return <Field label="子流程"><select className="inp sel" value={s.flowId || ''} onChange={e => set({ ...s, flowId: e.target.value })}>
      <option value="">选择一个 Flow</option>{flows.filter(x => x.id !== f.id).map(x => <option key={x.id} value={x.id}>{x.app} · {x.name}</option>)}</select></Field>
    case 'new': { const c = classOf(); return <>
      <div className="row2"><Field label="变量"><input className="inp mono" value={s.var || ''} onChange={e => set({ ...s, var: e.target.value.trim() })} /></Field>
        <Field label="类"><select className="inp sel" value={s.cls || ''} onChange={e => set({ ...s, cls: e.target.value, args: undefined })}>
          <option value="">选择类</option>{allClasses(flows, f).map(x => <option key={x} value={x}>{x}</option>)}</select></Field></div>
      {c && <><div className="t12">字段初始值（留空用类里的默认值）</div><ArgsEditor names={Object.keys(c.cls.fields)} args={s.args} set={a => set({ ...s, args: a })} /></>}
    </> }
    case 'method': { const c = classOf(s.var); const ms = c ? c.cls.methods : allMethods(flows, f); const m = ms.find(x => x.name === s.method); return <>
      <div className="row2"><Field label="对象"><input className="inp mono" value={s.var || ''} onChange={e => set({ ...s, var: e.target.value.trim() })} placeholder="obj 或 this.cart" /></Field>
        <Field label="方法"><select className="inp sel" value={s.method || ''} onChange={e => set({ ...s, method: e.target.value, args: undefined })}>
          <option value="">选择方法</option>{ms.map(x => <option key={x.name} value={x.name}>{x.name}()</option>)}</select></Field></div>
      {m?.params?.length ? <><div className="t12">参数</div><ArgsEditor names={m.params} args={s.args} set={a => set({ ...s, args: a })} /></> : null}
    </> }
    default: return null
  }
}
const numOr = (v: string): number | string => { const t = v.trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t }
const allClasses = (flows: Flow[], f: Flow) => [...new Set([...(f.classes || []), ...flows.flatMap(x => x.classes || [])].map(c => c.name))]
const allMethods = (flows: Flow[], f: Flow): FlowMethod[] => { const seen = new Set<string>(); return [...(f.classes || []), ...flows.flatMap(x => x.classes || [])].flatMap(c => c.methods).filter(m => !seen.has(m.name) && !!seen.add(m.name)) }

/* ---------- 类编辑 */
function ClassSheet({ c, flows, self, onSave, onDelete, onClose }: { c: FlowClass; flows: Flow[]; self: Flow; onSave: (c: FlowClass) => void; onDelete?: () => void; onClose: () => void }) {
  const [d, setD] = useState<FlowClass>(() => JSON.parse(JSON.stringify(c)))
  const [fields, setFields] = useState<[string, string][]>(() => Object.entries(c.fields))
  const [bodies, setBodies] = useState<string[]>(() => c.methods.map(m => m.steps ? JSON.stringify(m.steps, null, 1) : ''))
  const [err, setErr] = useState('')
  const save = () => {
    try {
      const methods = d.methods.map((m, i) => m.flowId ? { name: m.name, params: m.params, flowId: m.flowId } : { name: m.name, params: m.params, steps: JSON.parse(bodies[i] || '[]') as FlowStep[] })
      onSave({ name: d.name.trim(), fields: Object.fromEntries(fields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])), methods })
    } catch { setErr('方法体不是合法的步骤 JSON') }
  }
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet fsheet cls-sheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <div className="cls-top"><span className="add-ic" style={{ background: CAT_COLOR.cls.soft, color: CAT_COLOR.cls.solid }}><Icon n="cube" s={18} w={2} /></span>
          <input className="fe-name" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="类名，比如 Cart" /></div>
        <div className="add-h">字段</div>
        {fields.map(([k, v], i) => <div key={i} className="row-f">
          <input className="inp mono" value={k} placeholder="字段名" onChange={e => setFields(fields.map((x, j) => j === i ? [e.target.value, x[1]] : x))} />
          <input className="inp mono" value={v} placeholder="默认值，如 0 或 '美团'" onChange={e => setFields(fields.map((x, j) => j === i ? [x[0], e.target.value] : x))} />
          <button className="x-btn" onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label="删除字段"><Icon n="x" s={14} w={2.4} /></button></div>)}
        <button className="chip-t" onClick={() => setFields([...fields, ['', '']])}><Icon n="plus" s={13} w={2.4} />字段</button>
        <div className="add-h">方法 <span className="t12">方法体是子流程，里面用 this.字段</span></div>
        {d.methods.map((m, i) => <div key={i} className="meth">
          <div className="row-f">
            <input className="inp mono" value={m.name} placeholder="方法名" onChange={e => setD({ ...d, methods: d.methods.map((x, j) => j === i ? { ...x, name: e.target.value.trim() } : x) })} />
            <input className="inp mono" value={(m.params || []).join(', ')} placeholder="参数，逗号分隔" onChange={e => setD({ ...d, methods: d.methods.map((x, j) => j === i ? { ...x, params: e.target.value.split(/[,，\s]+/).filter(Boolean) } : x) })} />
            <button className="x-btn" onClick={() => { setD({ ...d, methods: d.methods.filter((_, j) => j !== i) }); setBodies(bodies.filter((_, j) => j !== i)) }} aria-label="删除方法"><Icon n="x" s={14} w={2.4} /></button>
          </div>
          <select className="inp sel" value={m.flowId || ''} onChange={e => setD({ ...d, methods: d.methods.map((x, j) => j === i ? { ...x, flowId: e.target.value || undefined } : x) })}>
            <option value="">方法体：在这里写步骤</option>{flows.filter(x => x.id !== self.id).map(x => <option key={x.id} value={x.id}>方法体：Flow「{x.app} · {x.name}」</option>)}
          </select>
          {!m.flowId && <textarea className="inp mono code-ta" rows={4} value={bodies[i] || ''} placeholder={'[{"kind":"input","text":"${this.shop}"},\n {"kind":"set","var":"this.count","value":"this.count + 1"}]'} onChange={e => setBodies(bodies.map((x, j) => j === i ? e.target.value : x))} />}
        </div>)}
        <button className="chip-t" onClick={() => { setD({ ...d, methods: [...d.methods, { name: 'run', params: [] }] }); setBodies([...bodies, '']) }}><Icon n="plus" s={13} w={2.4} />方法</button>
        {err && <div className="t13 danger" style={{ marginTop: 8 }}>{err}</div>}
        <div className="dev-acts" style={{ marginTop: 16 }}>
          <button className="btn-ink" onClick={save}>保存类</button>
          {onDelete && <button className="btn-ghost danger" onClick={onDelete}>删除类</button>}
        </div>
      </div>
    </div>
  )
}

/* ---------- 运行明细 */
const SRC_LABEL: Record<TraceItem['src'], string> = { native: '原生', cache: '缓存', vision: '视觉', coord: '坐标', logic: '逻辑', skip: '跳过', fail: '失败' }
export function RunPanel({ r, onPick }: { r: RunResult; onPick?: (i: number) => void }) {
  const t = (r.trace || []).filter(x => x.src !== 'logic')
  const logic = (r.trace || []).length - t.length
  const max = Math.max(1000, ...t.map(x => x.ms))
  const fast = t.filter(x => x.src !== 'vision' && x.src !== 'fail' && x.src !== 'skip')
  const avg = fast.length ? Math.round(fast.reduce((a, x) => a + x.ms, 0) / fast.length) : 0
  return (
    <div className={`run-panel ${r.ok ? 'ok' : 'bad'}`}>
      <div className="rp-head"><span className="rp-dot" /><span className="grow b">{runSummary(r)}</span></div>
      <div className="rp-stats">
        <div><b>{r.ms != null ? (r.ms / 1000).toFixed(1) : '—'}</b><span>总秒数</span></div>
        <div><b>{avg ? avg : '—'}</b><span>原生均值 ms</span></div>
        <div><b>{r.visionCalls || 0}</b><span>视觉调用</span></div>
        <div><b>{r.visionCalls ? Math.round((r.visionMs || 0) / r.visionCalls) : '—'}</b><span>视觉均值 ms</span></div>
      </div>
      <ol className="rp-list">{t.map((x, k) => (
        <li key={k} className={x.src} onClick={() => x.i != null && onPick?.(x.i)}>
          <span className={`rp-src ${x.src}`}>{SRC_LABEL[x.src]}</span>
          <span className="grow ell">{x.label}</span>
          <span className="rp-bar"><i style={{ width: `${Math.min(100, (x.ms / max) * 100)}%` }} /></span>
          <span className="rp-ms">{x.ms}</span>
        </li>))}</ol>
      <div className="t12">{logic ? `另有 ${logic} 个逻辑步（条件、变量、方法进出），几乎不耗时。` : ''}原生 / 缓存步走无障碍，不调模型；视觉步含一次模型往返（截图 + 元素列表），耗时看网络与模型。启动应用与页面加载算在步骤里。</div>
    </div>
  )
}

/* ---------- 编辑页 */
export function FlowEdit({ id, settings, done }: { id: string; settings: Settings; done: () => void }) {
  const flows = useFlows()
  const [f, setF] = useState<Flow | undefined>(() => loadFlows().find(x => x.id === id))
  const [open, setOpen] = useState<number | null>(null)
  const [add, setAdd] = useState(false)
  const [cls, setCls] = useState<{ c: FlowClass; i: number } | null>(null)
  const [ai, setAi] = useState(''), [aiBusy, setAiBusy] = useState(false), [draft, setDraft] = useState<Flow | null>(null)
  const [msg, setMsg] = useState('')
  const [res, setRes] = useState<RunResult | null>(null)
  const look = useAppLook(f?.app || '', f?.pkg)
  const t = tint(look)
  const S = draft || f
  const depths = useMemo(() => S ? blockDepths(S.steps) : [], [S])
  const problems = useMemo(() => f ? checkFlow(f, flows) : [], [f, flows])
  const varClass = useMemo(() => Object.fromEntries((f?.steps || []).filter(s => s.kind === 'new' && s.var && s.cls).map(s => [s.var!, s.cls!])), [f])
  if (!f || !S) return <div className="empty">这个 Flow 不存在了</div>
  const put = (n: Flow) => { const x = { ...n, params: paramsIn(n.steps), updated: Date.now() }; setF(x); upsertFlow(x) }
  const setStep = (i: number, s: FlowStep) => put({ ...f, steps: f.steps.map((x, j) => j === i ? s : x) })
  const move = (i: number, d: number) => { const a = [...f.steps]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; put({ ...f, steps: a }); setOpen(j) }
  const insert = (ss: FlowStep[]) => { const at = open != null ? open + 1 : f.steps.length; const a = [...f.steps]; a.splice(at, 0, ...ss); put({ ...f, steps: a }); setAdd(false); setOpen(at) }
  const optimize = async () => {
    setAiBusy(true); setDraft(null); setMsg('')
    let out = ''
    try {
      await streamChat({ settings, tier: 'neon', think: false, signal: new AbortController().signal,
        system: `你是安卓无障碍自动化专家。用户给你一个 Flow（JSON），请优化后只输出一个 JSON 对象 {"name","desc","steps"}，不要别的文字。规则：
- 删掉重复、无意义、误触的步骤；保留 launch 作为第一步
- 选择器优先用稳定的 id 和简短文字；坐标 x/y 是 0-1 的屏幕比例，保留作为兜底
- 会变化的内容（搜索词、地址、商品、联系人）改成 {参数名}，参数名用简短中文
- 输入后需要搜索就加 {"kind":"enter"}；页面切换后加合适的 wait 或 sleep
- 开屏广告、弹窗用 optional:true 的 tap（比如 跳过、我知道了、关闭）
- 付款、提交订单、发送、删除这类步骤加 confirm:true
- 允许用 if/else/while/do-while/for/set/call 等逻辑节点代替重复步骤；循环必须有明确退出条件（cond 或 for 的 from/to），while/do-while 默认最多 20 次
- 选择器明显不稳定（比如只有坐标、文字会变）的点击，可以换成 {"kind":"ai","goal":"简短描述","act":"tap"}，或在 tap 上加 "vision":true；不要把稳定的选择器换成 ai
- 已有的 new / method 类调用保持不变
- 禁止编造不存在的选择器；只用录制/屏幕上真实出现的 id、文字或坐标
- 每步可以写一个简短中文 note 说明`,
        messages: [{ role: 'user', content: `${ai ? '额外要求：' + ai + '\n' : ''}应用：${f.app}\n当前 Flow：${JSON.stringify({ name: f.name, desc: f.desc, steps: f.steps })}` }],
        onDelta: x => { out = x } })
      const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
      if (!Array.isArray(j.steps) || !j.steps.length) throw new Error('模型没有给出步骤')
      setDraft({ ...f, name: j.name || f.name, desc: j.desc || f.desc, steps: tidy(j.steps, f.app) })
    } catch (e) { setMsg('优化失败：' + ((e as Error).message || '')) } finally { setAiBusy(false) }
  }
  const test = async () => {
    const vals: Record<string, string> = {}
    for (const p of f.params) { const v = prompt(`试运行 · ${p}`); if (v == null) return; vals[p] = v }
    setMsg('运行中…'); setRes(null)
    try {
      const r = await runFlow(f, vals)
      setMsg(''); setRes(r)
      const fresh = loadFlows().find(x => x.id === f.id); if (fresh) setF(fresh)
      if (!r.ok && r.failedAt != null) { const tr = r.trace?.find(x => x.pc === r.failedAt); if (tr?.i != null && tr.fid === f.id) setOpen(tr.i) }
    } catch (e) { setMsg((e as Error).message) }
  }
  const errs = problems.filter(p => p.startsWith('错误')), warns = problems.filter(p => p.startsWith('警告'))
  return (
    <section className="fade">
      <div className="fe-head riff" style={riffVars(t)}>
        <span className="fh-ring sm"><AppIcon app={f.app} pkg={f.pkg} s={44} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <input className="fe-app" value={f.app} onChange={e => put({ ...f, app: e.target.value })} placeholder="应用" />
          <input className="fe-name" value={f.name} onChange={e => put({ ...f, name: e.target.value })} placeholder="名称，比如 搜索" />
        </div>
      </div>
      <input className="inp" style={{ marginTop: 10 }} value={f.desc} onChange={e => put({ ...f, desc: e.target.value })} placeholder="说明（模型靠它判断什么时候用）" />
      <div className="fe-meta">
        {f.params.length > 0 && <span className="t13">参数 {f.params.map(p => <span key={p} className="phone-chip">{`{${p}}`}</span>)}</span>}
        <button className={`chip-t ${f.fast !== false ? 'on' : ''}`} onClick={() => put({ ...f, fast: f.fast === false })}><Icon n="bolt" s={13} w={2.2} />快速模式</button>
      </div>

      <div className="dev-card" style={{ marginTop: 14 }}>
        <div className="dev-top"><GlassIcon n="spark" tone="plum" s={40} /><div className="grow"><div className="t16 b">用 AI 优化</div><div className="t13">清理多余步骤、提取参数、加上等待和弹窗处理</div></div></div>
        <input className="inp" value={ai} onChange={e => setAi(e.target.value)} placeholder="额外要求（可选），比如 搜索后点第一篇笔记" />
        <div className="dev-acts"><button className="btn-ink" disabled={aiBusy} onClick={optimize}>{aiBusy ? '优化中…' : '优化'}</button>
          {draft && <><button className="btn-ink" onClick={() => { put(draft); setDraft(null); setMsg('已采用优化结果') }}>采用（{draft.steps.length} 步）</button><button className="btn-ghost" onClick={() => setDraft(null)}>放弃</button></>}</div>
        {draft && <div className="t13">预览：{draft.name}{draft.desc ? ' · ' + draft.desc : ''}</div>}
      </div>

      {(errs.length > 0 || warns.length > 0) && !draft && <div className={`val-box ${errs.length ? 'bad' : ''}`}>
        {[...errs, ...warns].slice(0, 6).map((p, i) => <div key={i}>{p.replace(/^(错误|警告)：/, '')}<span className={`val-tag ${p.startsWith('错误') ? 'bad' : ''}`}>{p.startsWith('错误') ? '错误' : '提示'}</span></div>)}
        {errs.length + warns.length > 6 && <div className="t12">还有 {errs.length + warns.length - 6} 条</div>}
      </div>}

      <div className="sec">{draft ? '优化后的步骤（预览）' : `步骤 · ${f.steps.length}`}</div>
      <ol className="flow-steps tl">{S.steps.map((s, i) => { const c = catStyle(catOf(s.kind), t); const closing = /^end|^dowhile$|^else$/.test(s.kind); return (
        <li key={i} className={`${open === i && !draft ? 'open' : ''} ${draft ? 'ghost' : ''} ${closing ? 'closing' : ''}`} style={{ ['--tc' as string]: c.solid, ['--ts' as string]: c.soft, ['--d' as string]: depths[i] }}>
          <span className="tl-node">{s.kind === 'launch' ? <AppIcon app={f.app} pkg={f.pkg} s={30} /> : <Icon n={stepIcon(s)} s={16} w={2} />}</span>
          <div className="tl-card">
            <button className="fs-head" onClick={() => !draft && setOpen(open === i ? null : i)}>
              <span className="grow ell">{stepLabel(s)}</span>
              {s.kind === 'ai' && <span className={`fs-tag ${s.sel ? 'ok' : 'ai'}`}>{s.sel ? '已缓存' : 'AI'}</span>}
              {s.vision && <span className="fs-tag ai">AI 兜底</span>}
              {s.optional && <span className="fs-tag">可选</span>}{s.confirm && <span className="fs-tag warn">确认</span>}
            </button>
            {open === i && !draft && <div className="fs-body">
              <StepEditor s={s} set={n => setStep(i, n)} f={f} flows={flows} varClass={varClass} />
              <input className="inp" value={s.note || ''} onChange={e => setStep(i, { ...s, note: e.target.value || undefined })} placeholder="备注（显示在悬浮条上）" />
              {s.sel?.id && <div className="t12 ell">控件 id：{s.sel.id}</div>}
              <div className="dev-acts">
                {catOf(s.kind) === 'act' || s.kind === 'ai' ? <>
                  <button className={`chip-t ${s.optional ? 'on' : ''}`} onClick={() => setStep(i, { ...s, optional: !s.optional || undefined })}>可选</button>
                  <button className={`chip-t ${s.confirm ? 'on' : ''}`} onClick={() => setStep(i, { ...s, confirm: !s.confirm || undefined })}>执行前确认</button></> : null}
                <button className="chip-t" onClick={() => move(i, -1)}>上移</button><button className="chip-t" onClick={() => move(i, 1)}>下移</button>
                <button className="chip-t danger" onClick={() => { put({ ...f, steps: f.steps.filter((_, j) => j !== i) }); setOpen(null) }}>删除</button>
              </div></div>}
          </div>
        </li>) })}</ol>
      {!draft && <>
        <button className="add-btn press" onClick={() => setAdd(true)}><Icon n="plus" s={18} w={2} />添加步骤{open != null ? `（第 ${open + 1} 步后）` : ''}</button>

        <div className="sec">类 · {(f.classes || []).length}</div>
        <div className="cls-list">
          {(f.classes || []).map((c, i) => <button key={c.name + i} className="cls-card press" onClick={() => setCls({ c, i })}>
            <span className="add-ic" style={{ background: CAT_COLOR.cls.soft, color: CAT_COLOR.cls.solid }}><Icon n="cube" s={17} w={2} /></span>
            <span className="grow" style={{ minWidth: 0 }}><b className="mono">{c.name}</b>
              <span className="t12 ell">{Object.keys(c.fields).join(', ') || '没有字段'} · {c.methods.map(m => m.name + '()').join(' ') || '没有方法'}</span></span>
            <Icon n="right" s={15} w={2} c="var(--label3)" /></button>)}
          <button className="cls-card add press" onClick={() => setCls({ c: { name: (f.classes || []).length ? `Obj${(f.classes || []).length + 1}` : 'Item', fields: { name: "''", count: '0' }, methods: [] }, i: -1 })}>
            <Icon n="plus" s={16} w={2.2} /><span>新建类</span><span className="t12">字段 + 方法（方法体是子流程）</span></button>
        </div>

        <div className="dev-acts" style={{ marginTop: 16 }}>
          <button className="btn-ink" onClick={test} disabled={errs.length > 0}><Icon n="play" s={14} w={2.4} />试运行</button>
          <button className="btn-ghost danger" onClick={() => { if (confirm(`删除 Flow「${f.name}」？`)) { saveFlows(loadFlows().filter(x => x.id !== f.id)); done() } }}>删除 Flow</button>
        </div></>}
      {msg && <div className="imp-msg ok" style={{ marginTop: 12 }}>{msg}</div>}
      {res && <RunPanel r={res} onPick={i => setOpen(i)} />}
      {add && <AddSheet classes={[...(f.classes || []), ...flows.filter(x => x.id !== f.id).flatMap(x => x.classes || [])]} flows={flows.filter(x => x.id !== f.id)} look={t} onAdd={insert} onClose={() => setAdd(false)} />}
      {cls && <ClassSheet c={cls.c} flows={flows} self={f} onClose={() => setCls(null)}
        onSave={c => { const a = [...(f.classes || [])]; if (cls.i >= 0) a[cls.i] = c; else a.push(c); put({ ...f, classes: a }); setCls(null) }}
        onDelete={cls.i >= 0 ? () => { put({ ...f, classes: (f.classes || []).filter((_, j) => j !== cls.i) }); setCls(null) } : undefined} />}
    </section>
  )
}
