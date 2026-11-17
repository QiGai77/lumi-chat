/** Flow：按应用保存的一串手机操作，原生无障碍服务负责录制和运行。
 * v0.16：线性步骤之外支持逻辑节点（if/else/while/do-while/for/break/continue/set/call），
 * 变量、point/struct 值、快速模式。旧 Flow JSON（只有线性步骤）原样可跑。 */
import { Phone, isNative } from './phone'

export interface Sel { id?: string; text?: string; desc?: string; cls?: string }
export type StepKind = 'launch' | 'tap' | 'input' | 'enter' | 'scroll' | 'swipe' | 'key' | 'wait' | 'sleep'
  | 'if' | 'else' | 'endif' | 'while' | 'endwhile' | 'do' | 'dowhile' | 'for' | 'endfor' | 'break' | 'continue' | 'set' | 'call'
export type CondOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'
export interface FlowCond {
  kind: 'exists' | 'not_exists' | 'text' | 'var'
  sel?: Sel; text?: string; var?: string; op?: CondOp; value?: string
}
export type VarValue = string | number | boolean | { x: number; y: number } | Record<string, unknown>
export interface FlowStep {
  kind: StepKind; sel?: Sel; x?: number; y?: number; x2?: number; y2?: number
  text?: string; pkg?: string; app?: string; key?: string; forward?: boolean; ms?: number; long?: boolean
  optional?: boolean; confirm?: boolean; note?: string; timeout?: number
  // v0.16 逻辑节点
  cond?: FlowCond; var?: string; value?: string; from?: number; to?: number; step?: number
  max?: number; flowId?: string; pointVar?: string
}
export interface Flow {
  id: string; app: string; pkg?: string; name: string; desc: string; params: string[]; steps: FlowStep[]; updated: number; runs: number; lastOk?: boolean
  vars?: Record<string, VarValue>; fast?: boolean
}

export const MAX_LOOP_DEPTH = 8
export const DEFAULT_LOOP_MAX = 20
export const MAX_CALL_DEPTH = 3
export const MAX_EXEC_STEPS = 500

const K = 'lumi.flows'
export const loadFlows = (): Flow[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export const saveFlows = (f: Flow[]) => {
  localStorage.setItem(K, JSON.stringify(f))
  window.dispatchEvent(new Event('lumi-flows'))
  if (isNative) Phone.folderStatus().then(st => { if (st.linked) Phone.writeText({ path: 'Flow/flows.json', text: JSON.stringify(f, null, 1) }).catch(() => {}) }).catch(() => {})
}
export const upsertFlow = (fl: Flow) => { const a = loadFlows(); const i = a.findIndex(x => x.id === fl.id); if (i >= 0) a[i] = fl; else a.unshift(fl); saveFlows(a); return fl }

/* ---------- 变量求值（TS 侧供校验/测试用；真机求值在 LumiFlow.java 里有一份对等实现） */
export const varToString = (v: VarValue | undefined): string => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('x' in v && 'y' in v && Object.keys(v).length === 2) return `${(v as { x: number; y: number }).x},${(v as { x: number; y: number }).y}`
    return JSON.stringify(v)
  }
  return String(v)
}
const interp = (t: string, vars: Record<string, VarValue>): string =>
  t.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, k) => varToString(vars[k]))

/** 小型四则运算求值（+ - * / % 与括号），只接受数字与已替换的变量；非法返回 null。 */
function evalArith(expr: string): number | null {
  let i = 0
  const s = expr
  const peek = () => s[i]
  const skip = () => { while (/\s/.test(s[i] || '')) i++ }
  const parseNum = (): number | null => {
    skip()
    if (peek() === '(') { i++; const v = parseAdd(); skip(); if (peek() === ')') { i++; return v } return null }
    const m = /^-?\d+(\.\d+)?/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  const parseMul = (): number | null => {
    let v = parseNum(); if (v == null) return null
    for (;;) { skip(); const op = peek(); if (op !== '*' && op !== '/' && op !== '%') return v; i++; const r = parseNum(); if (r == null) return null; if (op === '*') v *= r; else if (op === '/') { if (r === 0) return null; v /= r } else v %= r }
  }
  const parseAdd = (): number | null => {
    let v = parseMul(); if (v == null) return null
    for (;;) { skip(); const op = peek(); if (op !== '+' && op !== '-') return v; i++; const r = parseMul(); if (r == null) return null; v = op === '+' ? v + r : v - r }
  }
  const v = parseAdd()
  skip()
  return i === s.length && v != null && Number.isFinite(v) ? v : null
}

/** set 步的 value 求值：${变量} 插值 → struct JSON → point 字面量 "0.5,0.3" → 数字/四则/字符串拼接 → 原字符串。 */
export function evalValue(raw: string, vars: Record<string, VarValue> = {}): VarValue {
  const t = interp(raw, vars).trim()
  if (!t) return ''
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) as Record<string, unknown> } catch { /* 不是合法 JSON，当字符串处理 */ }
  }
  const pt = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(t)
  if (pt) return { x: Number(pt[1]), y: Number(pt[2]) }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  // 字符串拼接：含引号或非数字变量的 + 连接
  if (t.includes('+')) {
    const parts = t.split('+').map(p => p.trim())
    const evalPart = (p: string): string | null => {
      const q = /^["'](.*)["']$/.exec(p)
      if (q) return q[1]
      if (/^-?\d+(\.\d+)?$/.test(p)) return p
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) && p in vars) return varToString(vars[p])
      return null
    }
    const vals = parts.map(evalPart)
    if (vals.every(v => v != null) && vals.some(v => !/^-?\d+(\.\d+)?$/.test(v as string))) return vals.join('')
  }
  // 四则：把裸变量名换成数字（非数字变量则不走这条路）
  if (/[+\-*/%()]/.test(t)) {
    let replaced = t
    let ok = true
    for (const name of [...new Set(t.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])]) {
      const v = vars[name]
      if (v == null || typeof v === 'object' || (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v))) { ok = false; break }
      replaced = replaced.replace(new RegExp(`\\b${name}\\b`, 'g'), String(v))
    }
    if (ok && /^[\d\s+\-*/%().]+$/.test(replaced)) {
      const n = evalArith(replaced)
      if (n != null) return n
    }
  }
  return t
}

/** 条件文字（供 stepLabel / 报错用；真机求值在 Java 侧）。 */
export const condLabel = (c?: FlowCond): string => {
  if (!c) return ''
  if (c.kind === 'exists') return `出现「${c.sel?.text || c.sel?.desc || c.sel?.id || ''}」`
  if (c.kind === 'not_exists') return `没有「${c.sel?.text || c.sel?.desc || c.sel?.id || ''}」`
  if (c.kind === 'text') return `屏幕包含「${c.text || ''}」`
  return `${c.var || ''} ${c.op || '=='} ${c.value ?? ''}`
}

/** 只比较 var 条件（不依赖原生屏幕），供校验/单测用；exists/text 条件返回 null（需真机判断）。 */
export function evalVarCond(c: FlowCond, vars: Record<string, VarValue>): boolean | null {
  if (c.kind !== 'var') return null
  const v = vars[c.var || '']
  if (v == null) return false
  const op = c.op || '=='
  const rhs = c.value ?? ''
  if (op === 'contains') return varToString(v).includes(rhs)
  const vn = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null)
  const rn = /^-?\d+(\.\d+)?$/.test(rhs) ? Number(rhs) : null
  if (vn != null && rn != null) {
    if (op === '==') return vn === rn
    if (op === '!=') return vn !== rn
    if (op === '>') return vn > rn
    if (op === '<') return vn < rn
    if (op === '>=') return vn >= rn
    if (op === '<=') return vn <= rn
  }
  const vs = varToString(v)
  if (op === '==') return vs === rhs
  if (op === '!=') return vs !== rhs
  if (op === '>') return vs > rhs
  if (op === '<') return vs < rhs
  if (op === '>=') return vs >= rhs
  if (op === '<=') return vs <= rhs
  return false
}

export const stepLabel = (s: FlowStep): string => {
  if (s.note) return s.note
  const w = s.sel?.text || s.sel?.desc || ''
  switch (s.kind) {
    case 'launch': return `打开 ${s.app || s.pkg || '应用'}`
    case 'tap': return `${s.long ? '长按' : '点击'}${s.pointVar ? `变量点 ${s.pointVar}` : w ? `「${w}」` : s.x != null ? `（${Math.round(s.x * 100)}%, ${Math.round((s.y || 0) * 100)}%）` : ''}`
    case 'input': return `输入「${s.text || ''}」`
    case 'enter': return '回车 / 搜索'
    case 'scroll': return s.forward === false ? '向上滚动' : '向下滚动'
    case 'swipe': return '滑动'
    case 'key': return ({ back: '返回', home: '回主屏', recents: '最近任务' } as Record<string, string>)[s.key || ''] || '按键'
    case 'wait': return `等待「${w}」出现`
    case 'sleep': return `等 ${(s.ms || 1000) / 1000} 秒`
    case 'if': return `如果 ${condLabel(s.cond)}`
    case 'else': return '否则'
    case 'endif': return '条件结束'
    case 'while': return `循环：当 ${condLabel(s.cond)}`
    case 'endwhile': return '循环结束'
    case 'do': return '先执行一次'
    case 'dowhile': return `重复执行，直到不满足 ${condLabel(s.cond)}`
    case 'for': return `循环 ${s.var || '?'} 从 ${s.from ?? '?'} 到 ${s.to ?? '?'}${s.step != null ? `，步长 ${s.step}` : ''}`
    case 'endfor': return '循环结束'
    case 'break': return '跳出循环'
    case 'continue': return '继续下一轮'
    case 'set': return `设置 ${s.var || '?'} = ${s.value ?? ''}`
    case 'call': return `调用子流程 ${s.flowId || ''}`
  }
}

const CONTROL_OPEN: Record<string, string> = { if: 'endif', while: 'endwhile', do: 'dowhile', for: 'endfor' }
const CONTROL_CLOSE: Record<string, string> = { endif: 'if', endwhile: 'while', dowhile: 'do', endfor: 'for' }

/**
 * 校验 Flow 步骤。返回字符串数组：`错误：…` 会阻止运行，`警告：…`（如变量未定义）不阻止运行。
 * all（可选）用于校验 call 目标是否存在；initialVars（可选）为 Flow.vars 里的初始变量。
 */
export function validateFlow(steps: FlowStep[], all?: Flow[], initialVars?: Record<string, VarValue>): string[] {
  const errs: string[] = []
  const warn: string[] = []
  const defined = new Set<string>(Object.keys(initialVars || {}))
  const checkVarUse = (name: string | undefined, where: string) => {
    if (name && !defined.has(name)) warn.push(`警告：第 ${where} 步用了未定义的变量 ${name}`)
  }
  const checkValueVars = (raw: string | undefined, where: string) => {
    if (!raw) return
    for (const m of raw.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) checkVarUse(m[1], where)
    for (const m of raw.matchAll(/(?<![${"'])\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      // 四则里的裸变量名；跳过 JSON 键与 true/false
      if (m[1] === 'true' || m[1] === 'false') continue
      if (raw.includes(`"${m[1]}"`)) continue
      checkVarUse(m[1], where)
    }
  }
  interface Frame { kind: string; idx: number; elseSeen?: boolean }
  const stack: Frame[] = []
  let loopDepth = 0
  steps.forEach((s, i) => {
    const at = String(i + 1)
    const isLoop = s.kind === 'while' || s.kind === 'do' || s.kind === 'for'
    if (isLoop) {
      loopDepth++
      if (loopDepth > MAX_LOOP_DEPTH) errs.push(`错误：第 ${at} 步循环嵌套超过 ${MAX_LOOP_DEPTH} 层`)
    }
    if (s.kind === 'endwhile' || s.kind === 'dowhile' || s.kind === 'endfor') loopDepth = Math.max(0, loopDepth - 1)
    if (s.max != null && (!Number.isInteger(s.max) || s.max <= 0)) errs.push(`错误：第 ${at} 步 max 必须是正整数`)
    switch (s.kind) {
      case 'if': case 'while': case 'dowhile': {
        if (!s.cond) errs.push(`错误：第 ${at} 步 ${s.kind} 缺少 cond 条件`)
        else {
          if ((s.cond.kind === 'exists' || s.cond.kind === 'not_exists') && !s.cond.sel) errs.push(`错误：第 ${at} 步条件需要 sel 选择器`)
          if (s.cond.kind === 'text' && !s.cond.text) errs.push(`错误：第 ${at} 步 text 条件缺少 text`)
          if (s.cond.kind === 'var') {
            if (!s.cond.var) errs.push(`错误：第 ${at} 步 var 条件缺少 var`)
            else checkVarUse(s.cond.var, at)
            if (!s.cond.op) errs.push(`错误：第 ${at} 步 var 条件缺少 op`)
            if (s.cond.value == null) errs.push(`错误：第 ${at} 步 var 条件缺少 value`)
          }
        }
        if (s.kind !== 'dowhile') stack.push({ kind: s.kind, idx: i })
        break
      }
      case 'do': case 'for': {
        if (s.kind === 'for') {
          if (!s.var) errs.push(`错误：第 ${at} 步 for 缺少 var`)
          if (s.from == null || s.to == null) errs.push(`错误：第 ${at} 步 for 缺少 from/to`)
          if (typeof s.from !== 'number' || typeof s.to !== 'number') errs.push(`错误：第 ${at} 步 for 的 from/to 必须是数字`)
          if (s.step === 0) errs.push(`错误：第 ${at} 步 for 的 step 不能为 0`)
          if (s.var) defined.add(s.var)
        }
        stack.push({ kind: s.kind, idx: i })
        break
      }
      case 'else': {
        const top = stack[stack.length - 1]
        if (!top || top.kind !== 'if') errs.push(`错误：第 ${at} 步 else 没有对应的 if`)
        else if (top.elseSeen) errs.push(`错误：第 ${at} 步 if 已有 else，不能再写一个`)
        else top.elseSeen = true
        break
      }
      case 'endif': case 'endwhile': case 'endfor': {
        const want = CONTROL_CLOSE[s.kind]
        const top = stack[stack.length - 1]
        if (!top || top.kind !== want) errs.push(`错误：第 ${at} 步 ${s.kind} 没有对应的 ${want}`)
        else {
          const open = stack.pop()!
          if ((open.kind === 'while' || open.kind === 'do' || open.kind === 'for') && open.idx === i - 1) errs.push(`错误：第 ${open.idx + 1}–${at} 步循环体为空`)
        }
        break
      }
      case 'break': case 'continue': {
        if (!stack.some(f => f.kind === 'while' || f.kind === 'do' || f.kind === 'for')) errs.push(`错误：第 ${at} 步 ${s.kind} 不在任何循环里`)
        break
      }
      case 'set': {
        if (!s.var) errs.push(`错误：第 ${at} 步 set 缺少 var`)
        else { checkValueVars(s.value, at); defined.add(s.var) }
        break
      }
      case 'call': {
        if (!s.flowId) errs.push(`错误：第 ${at} 步 call 缺少 flowId`)
        else if (all && !all.some(f => f.id === s.flowId || f.name === s.flowId)) errs.push(`错误：第 ${at} 步 call 的目标 Flow「${s.flowId}」不存在`)
        break
      }
      case 'tap': checkVarUse(s.pointVar, at); break
      default: break
    }
  })
  for (const f of stack) errs.push(`错误：第 ${f.idx + 1} 步 ${f.kind} 没有对应的结束步（${CONTROL_OPEN[f.kind]}）`)
  return [...errs, ...warn]
}

/** 内联 call：把子流程步骤展开进主流程，最多展开 MAX_CALL_DEPTH 层；循环调用/超深时保留原 call 步（Java 侧会报错）。 */
export function expandCalls(steps: FlowStep[], all: Flow[], depth = 0, chain: string[] = []): FlowStep[] {
  const out: FlowStep[] = []
  for (const s of steps) {
    if (s.kind !== 'call' || !s.flowId) { out.push(s); continue }
    if (depth >= MAX_CALL_DEPTH || chain.includes(s.flowId)) { out.push(s); continue }
    const target = all.find(f => f.id === s.flowId || f.name === s.flowId)
    if (!target) { out.push(s); continue }
    out.push(...expandCalls(target.steps, all, depth + 1, [...chain, s.flowId]))
  }
  return out
}

/** {参数} → 实际值；${变量} 占位原样保留（真机运行时求值），不被 {参数} 替换吞掉。 */
export const fill = (steps: FlowStep[], vals: Record<string, string>): FlowStep[] =>
  steps.map(s => {
    const r = (t?: string) => t?.replace(/(?<!\$)\{([^{}]{1,20})\}/g, (m, k) => (k in vals ? vals[k] : m))
    const cond = s.cond ? {
      ...s.cond,
      text: r(s.cond.text),
      value: r(s.cond.value),
      sel: s.cond.sel ? { ...s.cond.sel, text: r(s.cond.sel.text), desc: r(s.cond.sel.desc) } : undefined,
    } : undefined
    return { ...s, text: r(s.text), note: r(s.note), value: r(s.value), cond, sel: s.sel ? { ...s.sel, text: r(s.sel.text), desc: r(s.sel.desc) } : undefined }
  })
export const paramsIn = (steps: FlowStep[]) => [...new Set(steps.flatMap(s => [s.text, s.value, s.sel?.text, s.sel?.desc, s.cond?.text, s.cond?.value].join(' ').match(/(?<!\$)\{([^{}]{1,20})\}/g) || []).map(x => x.slice(1, -1)))]

export interface RunResult { ok: boolean; done: number; total: number; failedAt?: number; reason?: string; screen?: string; log?: string[]; ms?: number; stepMs?: number[] }
export async function runFlow(fl: Flow, vals: Record<string, string> = {}): Promise<RunResult> {
  const all = loadFlows()
  const problems = validateFlow(fl.steps, all, fl.vars)
  const errors = problems.filter(p => p.startsWith('错误'))
  if (errors.length) return { ok: false, done: 0, total: fl.steps.length, failedAt: 0, reason: errors.join('；') }
  const steps = expandCalls(fill(fl.steps, vals), all)
  const r = await Phone.flowRun({ name: fl.name, steps, fast: fl.fast ?? true }) as unknown as RunResult
  const i = all.findIndex(x => x.id === fl.id)
  if (i >= 0) { all[i] = { ...all[i], runs: all[i].runs + 1, lastOk: r.ok }; saveFlows(all) }
  return r
}

/** 录制结果清理：合并重复滚动、去掉空输入、补上应用名。 */
export function tidy(steps: FlowStep[], app?: string): FlowStep[] {
  const out: FlowStep[] = []
  for (const s of steps) {
    const prev = out[out.length - 1]
    if (s.kind === 'input' && !s.text) continue
    if (s.kind === 'scroll' && prev?.kind === 'scroll' && prev.forward === s.forward) continue
    if (s.kind === 'launch' && out.some(x => x.kind === 'launch')) continue
    if (s.kind === 'launch' && app && !s.app) s.app = app
    if (s.sel) { const c = { ...s.sel }; if (!c.text) delete c.text; if (!c.desc) delete c.desc; if (!c.id) delete c.id; s.sel = c }
    out.push(s)
  }
  return out
}

export const flowSummary = (f: Flow[]) => f.length
  ? f.map(x => `- id=${x.id} 应用=${x.app} 名称=${x.name}${x.params.length ? ` 参数=${x.params.join('、')}` : ''}${x.desc ? ` 说明=${x.desc}` : ''}（${x.steps.length} 步）`).join('\n')
  : '（还没有保存任何 Flow）'

export const FLOW_TOOLS = [
  { name: 'flow_list', desc: '列出用户保存的 Flow（按应用分组的固定操作流程）。', params: {} },
  { name: 'flow_run', desc: '运行一个 Flow，比运行逐步操作快很多。params 填 Flow 需要的参数。失败会返回卡住的步骤和当时的屏幕，你可以接着手动完成。', params: { id: { type: 'string' }, params: { type: 'object', description: '参数，比如 {"关键词":"露营"}，可省略' } } },
  { name: 'flow_save', desc: '新建或更新一个 Flow。steps 是步骤数组，每步 {kind, sel:{id,text,desc}, x, y, text, app, pkg, key, forward, ms, optional, confirm, note}。kind 可选 launch/tap/input/enter/scroll/swipe/key/wait/sleep/if/else/endif/while/endwhile/do/dowhile/for/endfor/break/continue/set/call。逻辑节点：if/while/dowhile 带 cond{kind:exists|not_exists|text|var, sel, text, var, op(==|!=|>|<|>=|<=|contains), value}；set{var, value}，value 支持 ${变量}、四则、拼接、point "0.5,0.3"、struct JSON；for{var, from, to, step?} 含端点；call{flowId} 调子流程；tap 可用 pointVar 指向 point 变量。循环嵌套最多 8 层，单循环默认最多 20 次（步上用 max 覆盖）。会变的内容写成 {参数名}。付款、提交订单、发送这类步骤要设 confirm:true。', params: { id: { type: 'string', description: '更新已有 Flow 时填，可省略' }, app: { type: 'string' }, name: { type: 'string' }, desc: { type: 'string' }, steps: { type: 'array', items: { type: 'object' } } } },
] as const

const uid = () => Math.random().toString(36).slice(2, 10)
export async function runFlowTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'flow_list') return flowSummary(loadFlows())
    if (name === 'flow_run') {
      const fl = loadFlows().find(f => f.id === args.id || f.name === args.id)
      if (!fl) return '出错了：没有这个 Flow，先用 flow_list 看看'
      const r = await runFlow(fl, (args.params as Record<string, string>) || {})
      const secs = r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)} 秒` : ''
      if (r.ok) return `Flow「${fl.name}」完成，共 ${r.done} 步${secs}。`
      return `Flow「${fl.name}」在第 ${(r.failedAt ?? 0) + 1} 步停下：${r.reason}\n已完成 ${r.done}/${r.total} 步。当前屏幕：\n${r.screen || ''}\n请接着手动完成剩下的事；完成后可以用 flow_save 更新这个 Flow（id=${fl.id}），修好卡住的那一步。`
    }
    if (name === 'flow_save') {
      const steps = tidy((args.steps as FlowStep[]) || [], String(args.app || ''))
      if (!steps.length) return '出错了：steps 不能为空'
      const old = loadFlows().find(f => f.id === args.id)
      const fl: Flow = { id: old?.id || uid(), app: String(args.app || old?.app || steps.find(s => s.app)?.app || '应用'), pkg: steps.find(s => s.pkg)?.pkg || old?.pkg,
        name: String(args.name || old?.name || 'Flow'), desc: String(args.desc || old?.desc || ''), steps, params: paramsIn(steps), updated: Date.now(), runs: old?.runs || 0,
        vars: (args.vars as Record<string, VarValue> | undefined) || old?.vars, fast: (args.fast as boolean | undefined) ?? old?.fast }
      upsertFlow(fl)
      return `已${old ? '更新' : '保存'} Flow「${fl.app} · ${fl.name}」，${steps.length} 步${fl.params.length ? '，参数：' + fl.params.join('、') : ''}。`
    }
    return '未知工具'
  } catch (e) { return '出错了：' + ((e as Error).message || String(e)) }
}
