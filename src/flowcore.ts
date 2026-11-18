/** Flow 的纯逻辑部分（类型、求值、校验、展开、文字），不依赖浏览器和原生插件，可以直接用 node 单测（scripts/flow-test.mts）。
 * 真机执行在 android/.../FlowVm.java，这里的 evalValue / evalVarCond 与它保持同一套规则。
 *
 * v0.16：if/else/while/do-while/for/break/continue/set/call、point/struct 变量。
 * v0.17：class（字段 + 方法，方法体是子流程）、new 实例化、obj.field 读写、obj.method() 调用（运行时 this 绑定）、
 *        ai 步（AI 视觉定位，找到的选择器写回 Flow，下次走原生）。旧 Flow JSON 原样可跑。 */

export interface Sel { id?: string; text?: string; desc?: string; cls?: string }
export type StepKind = 'launch' | 'tap' | 'input' | 'enter' | 'scroll' | 'swipe' | 'key' | 'wait' | 'sleep' | 'ai'
  | 'if' | 'else' | 'endif' | 'while' | 'endwhile' | 'do' | 'dowhile' | 'for' | 'endfor' | 'break' | 'continue' | 'set' | 'call'
  | 'new' | 'method' | 'bind' | 'unbind'
export type CondOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'
export interface FlowCond {
  kind: 'exists' | 'not_exists' | 'text' | 'var'
  sel?: Sel; text?: string; var?: string; op?: CondOp; value?: string; timeout?: number
}
export type VarValue = string | number | boolean | { x: number; y: number } | Record<string, unknown> | unknown[]
export interface FlowStep {
  kind: StepKind; sel?: Sel; x?: number; y?: number; x2?: number; y2?: number
  text?: string; pkg?: string; app?: string; key?: string; forward?: boolean; ms?: number; long?: boolean
  optional?: boolean; confirm?: boolean; note?: string; timeout?: number; after?: number
  // v0.16 逻辑节点
  cond?: FlowCond; var?: string; value?: string; from?: number | string; to?: number | string; step?: number | string
  max?: number; flowId?: string; pointVar?: string
  // v0.17 AI 视觉：ai 步的目标描述与动作；tap 上 vision:true 表示选择器失效时让 AI 找
  goal?: string; act?: 'tap' | 'long' | 'input'; vision?: boolean
  // v0.17 类：new{var, cls, args}；method{var, method, args, cls?}；bind/unbind 由 expandCalls 生成
  cls?: string; method?: string; args?: Record<string, string>; fields?: Record<string, string>
  // 运行时标注：步骤在哪个 Flow（或类方法）的第几步，用来把 AI 学到的选择器写回去
  _i?: number; _fid?: string
}
/** 类方法：方法体是一个子流程，要么内联 steps，要么指向一个已有 Flow（flowId）。 */
export interface FlowMethod { name: string; params?: string[]; steps?: FlowStep[]; flowId?: string }
/** 类：字段（名字 → 默认值表达式，和 set 的 value 同一套写法）+ 方法。 */
export interface FlowClass { name: string; fields: Record<string, string>; methods: FlowMethod[] }
export interface Flow {
  id: string; app: string; pkg?: string; name: string; desc: string; params: string[]; steps: FlowStep[]; updated: number; runs: number; lastOk?: boolean
  vars?: Record<string, VarValue>; fast?: boolean; classes?: FlowClass[]
  lastMs?: number
}

export const MAX_LOOP_DEPTH = 8
export const DEFAULT_LOOP_MAX = 20
export const MAX_CALL_DEPTH = 3
/** v0.22：子 Flow（call 步）最多嵌套 5 层；类方法仍是 MAX_CALL_DEPTH。 */
export const MAX_SUBFLOW_DEPTH = 5
export const MAX_EXEC_STEPS = 500

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const PATH = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*'
const PATH_RE = new RegExp(`^${PATH}$`)
const NUM = /^-?\d+(\.\d+)?$/
export const isIdent = (s?: string) => !!s && IDENT.test(s)
export const isPath = (s?: string) => !!s && PATH_RE.test(s)
export const rootOf = (p: string) => p.split('.')[0]

/* ---------- 变量与路径 */
const numStr = (n: number) => (Number.isInteger(n) && Math.abs(n) < 1e15 ? String(n) : String(n))
export const varToString = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (!Array.isArray(v) && 'x' in o && 'y' in o && Object.keys(o).length === 2) return `${numStr(Number(o.x))},${numStr(Number(o.y))}`
    return JSON.stringify(v)
  }
  if (typeof v === 'number') return numStr(v)
  return String(v)
}
export interface Scope { vars: Record<string, VarValue>; self?: Record<string, unknown> }
/** 读路径：a、a.b.c、this.x；读不到返回 undefined。 */
export function resolvePath(path: string, sc: Scope): unknown {
  const parts = path.split('.')
  let cur: unknown = parts[0] === 'this' ? sc.self : sc.vars[parts[0]]
  for (let i = 1; i < parts.length && cur != null; i++) {
    if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[parts[i]]
    else cur = undefined
  }
  return cur
}
const toNum = (v: unknown): number | null => typeof v === 'number' ? v : typeof v === 'string' && NUM.test(v.trim()) ? Number(v.trim()) : null
const asScope = (v: Record<string, VarValue> | Scope): Scope => ('vars' in v && typeof v.vars === 'object' && v.vars !== null && !Array.isArray(v.vars) ? v as Scope : { vars: v as Record<string, VarValue> })
export const interp = (t: string, sc: Scope): string =>
  t.replace(new RegExp(`\\$\\{(${PATH})\\}`, 'g'), (_m, k) => varToString(resolvePath(k, sc)))

/** 小型四则运算求值（+ - * / % 括号 一元负号），只接受数字；非法返回 null。 */
export function evalArith(expr: string): number | null {
  let i = 0
  const s = expr
  const skip = () => { while (/\s/.test(s[i] || '')) i++ }
  const unary = (): number => {
    skip()
    if (s[i] === '-') { i++; return -unary() }
    if (s[i] === '(') { i++; const v = add(); skip(); if (s[i] !== ')') throw 0; i++; return v }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i)); if (!m) throw 0
    i += m[0].length; return Number(m[0])
  }
  const mul = (): number => {
    let v = unary()
    for (;;) { skip(); const op = s[i]; if (op !== '*' && op !== '/' && op !== '%') return v; i++; const r = unary(); if ((op === '/' || op === '%') && r === 0) throw 0; v = op === '*' ? v * r : op === '/' ? v / r : v % r }
  }
  const add = (): number => {
    let v = mul()
    for (;;) { skip(); const op = s[i]; if (op !== '+' && op !== '-') return v; i++; const r = mul(); v = op === '+' ? v + r : v - r }
  }
  try { const v = add(); skip(); return i === s.length && Number.isFinite(v) ? v : null } catch { return null }
}

/** set / new / 实参求值：${路径} 插值 → struct JSON → point "0.5,0.3" → 数字 → 带点的对象路径 → 字符串拼接 → 四则 → 原文字。 */
export function evalValue(raw: string, scope: Record<string, VarValue> | Scope = {}): VarValue {
  const sc = asScope(scope)
  const t = interp(raw, sc).trim()
  if (!t) return ''
  if (t.startsWith('{') || t.startsWith('[')) { try { return JSON.parse(t) } catch { /* 当文字 */ } }
  const pt = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(t)
  if (pt) return { x: Number(pt[1]), y: Number(pt[2]) }
  if (NUM.test(t)) return Number(t)
  const lit = /^(["'])([^"']*)\1$/.exec(t)
  if (lit) return lit[2] // 单个引号字符串 'abc' → abc
  if (t.includes('.') && isPath(t)) { const v = resolvePath(t, sc); if (v != null) return JSON.parse(JSON.stringify(v)) as VarValue }
  if (t.includes('+')) {
    let any = false, ok = true
    const out = t.split('+').map(p => p.trim()).map(p => {
      const q = /^(["'])(.*)\1$/.exec(p); if (q) { any = true; return q[2] }
      if (isPath(p)) { const v = resolvePath(p, sc); if (v != null) { if (toNum(v) == null) any = true; return varToString(v) } }
      if (NUM.test(p)) return p
      ok = false; return ''
    })
    if (ok && any) return out.join('')
  }
  if (/^[\d\s+\-*/%().A-Za-z_]+$/.test(t) && /[+\-*/%()]/.test(t)) {
    let ok = true
    const replaced = t.replace(new RegExp(PATH, 'g'), m => { const n = toNum(resolvePath(m, sc)); if (n == null) { ok = false; return m } return n < 0 ? `(${numStr(n)})` : numStr(n) })
    if (ok) { const n = evalArith(replaced); if (n != null) return n }
  }
  return t
}

export const condLabel = (c?: FlowCond): string => {
  if (!c) return ''
  const w = c.sel?.text || c.sel?.desc || c.sel?.id || ''
  if (c.kind === 'exists') return `出现「${w}」`
  if (c.kind === 'not_exists') return `没有「${w}」`
  if (c.kind === 'text') return `屏幕包含「${c.text || ''}」`
  return `${c.var || ''} ${c.op || '=='} ${c.value ?? ''}`
}

/** 只求值 var 条件（不需要屏幕）；exists/text 条件返回 null。 */
export function evalVarCond(c: FlowCond, scope: Record<string, VarValue> | Scope): boolean | null {
  if (c.kind !== 'var') return null
  const sc = asScope(scope)
  const v = resolvePath(c.var || '', sc)
  const op = c.op || '=='
  const rhs = interp(c.value ?? '', sc)
  if (v == null) return op === '!=' ? rhs !== '' : op === '==' && rhs === ''
  if (op === 'contains') return varToString(v).includes(rhs)
  const vn = toNum(v), rn = toNum(rhs)
  if (vn != null && rn != null) return op === '==' ? vn === rn : op === '!=' ? vn !== rn : op === '>' ? vn > rn : op === '<' ? vn < rn : op === '>=' ? vn >= rn : vn <= rn
  const vs = varToString(v)
  return op === '==' ? vs === rhs : op === '!=' ? vs !== rhs : op === '>' ? vs > rhs : op === '<' ? vs < rhs : op === '>=' ? vs >= rhs : vs <= rhs
}

const argsText = (a?: Record<string, string>) => Object.entries(a || {}).map(([k, v]) => `${k}=${v}`).join(', ')
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
    case 'ai': return `AI 找「${s.goal || ''}」并${s.act === 'input' ? `输入「${s.text || ''}」` : s.act === 'long' ? '长按' : '点击'}`
    case 'if': return `如果 ${condLabel(s.cond)}`
    case 'else': return '否则'
    case 'endif': return '条件结束'
    case 'while': return `当 ${condLabel(s.cond)} 时循环`
    case 'endwhile': return '循环结束'
    case 'do': return '先执行一次'
    case 'dowhile': return `当 ${condLabel(s.cond)} 时再来一遍`
    case 'for': return `循环 ${s.var || '?'} 从 ${s.from ?? '?'} 到 ${s.to ?? '?'}${s.step != null ? `，步长 ${s.step}` : ''}`
    case 'endfor': return '循环结束'
    case 'break': return '跳出循环'
    case 'continue': return '继续下一轮'
    case 'set': return `设置 ${s.var || '?'} = ${s.value ?? ''}`
    case 'call': return `运行子 Flow ${s.flowId || ''}${s.args && Object.keys(s.args).length ? `（${argsText(s.args)}）` : ''}`
    case 'new': return `新建 ${s.var || '?'} = ${s.cls || '?'}(${argsText(s.args)})`
    case 'method': return `调用 ${s.var || '?'}.${s.method || '?'}(${argsText(s.args)})`
    case 'bind': return `进入 ${s.var || ''}.${s.method || ''}()`
    case 'unbind': return '方法返回'
  }
}

/** 时间线缩进：块内步骤往右缩一级。 */
export function blockDepths(steps: FlowStep[]): number[] {
  let d = 0
  return steps.map(s => {
    if (s.kind === 'endif' || s.kind === 'endwhile' || s.kind === 'endfor' || s.kind === 'dowhile') d = Math.max(0, d - 1)
    const here = s.kind === 'else' ? Math.max(0, d - 1) : d
    if (s.kind === 'if' || s.kind === 'while' || s.kind === 'for' || s.kind === 'do') d++
    return here
  })
}

const CONTROL_OPEN: Record<string, string> = { if: 'endif', while: 'endwhile', do: 'dowhile', for: 'endfor' }
const CONTROL_CLOSE: Record<string, string> = { endif: 'if', endwhile: 'while', dowhile: 'do', endfor: 'for' }

/** 所有 Flow 里定义的类（同名时当前 Flow 优先）。 */
export function findClass(name: string | undefined, all: Flow[] = [], own?: Flow): { cls: FlowClass; owner: Flow } | undefined {
  if (!name) return
  const order = own ? [own, ...all.filter(f => f.id !== own.id)] : all
  for (const f of order) { const c = f.classes?.find(x => x.name === name); if (c) return { cls: c, owner: f } }
}
const classesWithMethod = (m: string, all: Flow[], own?: Flow) => {
  const out: { cls: FlowClass; owner: Flow }[] = []
  const seen = new Set<string>()
  for (const f of own ? [own, ...all] : all) for (const c of f.classes || []) if (!seen.has(c.name) && c.methods.some(x => x.name === m)) { seen.add(c.name); out.push({ cls: c, owner: f }) }
  return out
}

/** 子 Flow 调用图：从 start 往下走 call 步，返回最深层数（start 自己算 1）和第一条循环路径。selfId 是调用方（也算进路径）。 */
export function subflowGraph(start: Flow, all: Flow[], selfId?: string): { depth: number; cycle?: string[] } {
  const name = (id: string) => all.find(f => f.id === id)?.name || id
  let cycle: string[] | undefined
  const walk = (f: Flow, path: string[]): number => {
    if (cycle) return 0
    if (path.includes(f.id)) { cycle = [...path.slice(path.indexOf(f.id)), f.id].map(name); return 0 }
    let d = 0
    for (const s of f.steps) if (s.kind === 'call' && s.flowId) {
      const t = all.find(x => x.id === s.flowId || x.name === s.flowId)
      if (t) d = Math.max(d, walk(t, [...path, f.id]))
      if (path.length > 20) break
    }
    return d + 1
  }
  const depth = walk(start, selfId ? [selfId] : [])
  return { depth, cycle }
}
/** 合并：选中的一段连续步骤能不能单独成为一个子 Flow（块要配对、break/continue 要有循环）。返回错误文字，能合并返回 ''。 */
export function canExtract(steps: FlowStep[], from: number, to: number): string {
  if (from < 0 || to >= steps.length || from > to) return '先选连续的步骤'
  const part = steps.slice(from, to + 1)
  if (part.some(s => s.kind === 'launch') && from > 0) return '打开应用的步骤不能合并进子 Flow'
  if (part.some(s => s.kind === 'bind' || s.kind === 'unbind')) return '不能合并方法进出步'
  const e = validateFlow(part).filter(x => x.startsWith('错误') && /没有对应|不在任何循环|只能有一个/.test(x))
  return e.length ? '选中的步骤里块没有配对完整（如果 / 循环要连同结束步一起选）' : ''
}

export interface ValidateOpts { own?: Flow; inMethod?: boolean; params?: string[] }

/**
 * 校验步骤。返回字符串数组：`错误：…` 阻止运行，`警告：…` 不阻止。
 * all：所有 Flow（查 call 目标与类）；initialVars：Flow.vars。
 */
export function validateFlow(steps: FlowStep[], all?: Flow[], initialVars?: Record<string, VarValue>, opts: ValidateOpts = {}): string[] {
  const errs: string[] = []
  const warn: string[] = []
  const defined = new Set<string>([...Object.keys(initialVars || {}), ...(opts.params || [])])
  const varClass: Record<string, string> = {}
  const checkPath = (path: string | undefined, at: string) => {
    if (!path) return
    const r = rootOf(path)
    if (r === 'this') { if (!opts.inMethod) errs.push(`错误：第 ${at} 步的 this 只能在类方法里用`); return }
    if (!defined.has(r)) warn.push(`警告：第 ${at} 步用了未定义的变量 ${r}`)
  }
  const checkExpr = (raw: string | undefined, at: string) => {
    if (!raw) return
    for (const m of raw.matchAll(new RegExp(`\\$\\{(${PATH})\\}`, 'g'))) checkPath(m[1], at)
    const t = raw.trim()
    if (t.startsWith('{') || t.startsWith('[')) return // struct JSON
    // 只有像表达式（带运算符）或带点路径时才检查裸名字；纯文字（如「你好 world」）不算变量
    const bare = raw.replace(/\$\{[^}]*\}/g, ' ').replace(/(["'])(?:(?!\1).)*\1/g, ' ')
    const exprLike = /[+\-*/%()]/.test(bare) || /^\s*[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_]/.test(bare)
    if (!exprLike) return
    for (const m of bare.matchAll(new RegExp(`(?<![\\w.])(${PATH})`, 'g'))) {
      if (m[1] === 'true' || m[1] === 'false') continue
      checkPath(m[1], at)
    }
  }
  interface Frame { kind: string; idx: number; elseSeen?: boolean }
  const stack: Frame[] = []
  let loopDepth = 0
  steps.forEach((s, i) => {
    const at = String(i + 1)
    const isLoop = s.kind === 'while' || s.kind === 'do' || s.kind === 'for'
    if (isLoop) { loopDepth++; if (loopDepth > MAX_LOOP_DEPTH) errs.push(`错误：第 ${at} 步循环嵌套超过 ${MAX_LOOP_DEPTH} 层`) }
    if (s.kind === 'endwhile' || s.kind === 'dowhile' || s.kind === 'endfor') loopDepth = Math.max(0, loopDepth - 1)
    if (s.max != null && (!Number.isInteger(s.max) || s.max <= 0)) errs.push(`错误：第 ${at} 步 max 必须是正整数`)
    if (s.kind === 'if' || s.kind === 'while' || s.kind === 'dowhile') {
      const c = s.cond
      if (!c) errs.push(`错误：第 ${at} 步缺少条件`)
      else {
        if ((c.kind === 'exists' || c.kind === 'not_exists') && !(c.sel?.text || c.sel?.desc || c.sel?.id)) errs.push(`错误：第 ${at} 步的条件要写找哪个文字`)
        if (c.kind === 'text' && !c.text) errs.push(`错误：第 ${at} 步的条件要写屏幕上的文字`)
        if (c.kind === 'var') {
          if (!c.var) errs.push(`错误：第 ${at} 步的条件缺少变量`)
          else if (!isPath(c.var)) errs.push(`错误：第 ${at} 步的条件变量名「${c.var}」不合法`)
          else checkPath(c.var, at)
          if (!c.op) errs.push(`错误：第 ${at} 步的条件缺少比较方式`)
          if (c.value == null) errs.push(`错误：第 ${at} 步的条件缺少比较值`)
          else checkExpr(c.value, at)
        }
      }
    }
    switch (s.kind) {
      case 'if': case 'while': stack.push({ kind: s.kind, idx: i }); break
      case 'do': stack.push({ kind: 'do', idx: i }); break
      case 'for': {
        if (!s.var) errs.push(`错误：第 ${at} 步 for 缺少循环变量`)
        else if (!isIdent(s.var)) errs.push(`错误：第 ${at} 步 for 的循环变量「${s.var}」不合法（不能带点）`)
        for (const [k, v] of [['from', s.from], ['to', s.to]] as const) {
          if (v == null || v === '') errs.push(`错误：第 ${at} 步 for 缺少 ${k}`)
          else if (typeof v === 'string') checkExpr(v, at)
          else if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`错误：第 ${at} 步 for 的 ${k} 必须是数字或变量`)
        }
        if (s.step === 0 || s.step === '0') errs.push(`错误：第 ${at} 步 for 的步长不能为 0`)
        if (typeof s.from === 'number' && typeof s.to === 'number' && s.max == null) {
          const n = Math.floor(Math.abs(s.to - s.from) / Math.abs(Number(s.step) || 1)) + 1
          if (n > 1000) errs.push(`错误：第 ${at} 步 for 要跑 ${n} 次，超过 1000 次上限`)
        }
        if (s.var) defined.add(s.var)
        stack.push({ kind: 'for', idx: i })
        break
      }
      case 'else': {
        const top = stack[stack.length - 1]
        if (!top || top.kind !== 'if') errs.push(`错误：第 ${at} 步「否则」没有对应的「如果」`)
        else if (top.elseSeen) errs.push(`错误：第 ${at} 步：一个「如果」只能有一个「否则」`)
        else top.elseSeen = true
        break
      }
      case 'endif': case 'endwhile': case 'endfor': case 'dowhile': {
        const want = CONTROL_CLOSE[s.kind]
        const top = stack[stack.length - 1]
        if (!top || top.kind !== want) errs.push(`错误：第 ${at} 步 ${s.kind} 没有对应的 ${want}`)
        else {
          const open = stack.pop()!
          if (open.kind !== 'if' && open.idx === i - 1) errs.push(`错误：第 ${open.idx + 1}–${at} 步循环体是空的`)
        }
        break
      }
      case 'break': case 'continue':
        if (!stack.some(f => f.kind !== 'if')) errs.push(`错误：第 ${at} 步 ${s.kind === 'break' ? '跳出循环' : '继续下一轮'} 不在任何循环里`)
        break
      case 'set': {
        if (!s.var) errs.push(`错误：第 ${at} 步 set 缺少变量名`)
        else if (!isPath(s.var)) errs.push(`错误：第 ${at} 步变量名「${s.var}」不合法（字母、数字、下划线，可用 a.b 写字段）`)
        else {
          checkExpr(s.value, at)
          if (s.var.includes('.')) checkPath(s.var, at)
          else if (s.var === 'this') errs.push(`错误：第 ${at} 步不能给 this 赋值`)
          else defined.add(s.var)
        }
        break
      }
      case 'call': {
        const own = opts.own
        const target = all?.find(f => f.id === s.flowId || f.name === s.flowId)
        if (!s.flowId) errs.push(`错误：第 ${at} 步没选要调用的 Flow`)
        else if (own && (s.flowId === own.id || s.flowId === own.name)) errs.push(`错误：第 ${at} 步不能调用自己`)
        else if (all && !target) errs.push(`错误：第 ${at} 步调用的 Flow「${s.flowId}」不存在`)
        else if (all && target) {
          const g = subflowGraph(target, all, own?.id)
          if (g.cycle) errs.push(`错误：第 ${at} 步的子 Flow 会循环调用（${g.cycle.join(' → ')}）`)
          else if (g.depth > MAX_SUBFLOW_DEPTH) errs.push(`错误：第 ${at} 步的子 Flow 嵌套 ${g.depth} 层，超过 ${MAX_SUBFLOW_DEPTH} 层上限`)
          for (const k of target.params || []) if (!(s.args && k in s.args)) warn.push(`警告：第 ${at} 步没给子 Flow 的参数 {${k}} 传值，运行时用同名参数`)
          for (const k of Object.keys(s.args || {})) if (!(target.params || []).includes(k)) warn.push(`警告：第 ${at} 步给了子 Flow 没有的参数 ${k}`)
        }
        for (const v of Object.values(s.args || {})) checkExpr(v, at)
        break
      }
      case 'new': {
        if (!s.var) errs.push(`错误：第 ${at} 步 new 缺少变量名`)
        else if (!isPath(s.var)) errs.push(`错误：第 ${at} 步变量名「${s.var}」不合法`)
        if (!s.cls) errs.push(`错误：第 ${at} 步 new 没选类`)
        else {
          const c = findClass(s.cls, all, opts.own)
          if (!c) errs.push(`错误：第 ${at} 步的类「${s.cls}」不存在`)
          else for (const k of Object.keys(s.args || {})) if (!(k in c.cls.fields)) warn.push(`警告：第 ${at} 步给了类 ${s.cls} 没有的字段 ${k}`)
        }
        for (const v of Object.values(s.args || {})) checkExpr(v, at)
        if (s.var) { if (s.var.includes('.')) checkPath(s.var, at); else { defined.add(s.var); if (s.cls) varClass[s.var] = s.cls } }
        break
      }
      case 'method': {
        if (!s.var) errs.push(`错误：第 ${at} 步缺少对象变量`)
        else checkPath(s.var, at)
        if (!s.method) errs.push(`错误：第 ${at} 步缺少方法名`)
        else {
          const cn = s.cls || (s.var ? varClass[s.var] : undefined)
          const c = cn ? findClass(cn, all, opts.own) : undefined
          if (cn && !c) errs.push(`错误：第 ${at} 步的类「${cn}」不存在`)
          else if (c && !c.cls.methods.some(m => m.name === s.method)) errs.push(`错误：第 ${at} 步：类 ${c.cls.name} 没有方法 ${s.method}`)
          else if (!c) {
            const cands = classesWithMethod(s.method, all || [], opts.own)
            if (!cands.length) errs.push(`错误：第 ${at} 步：没有哪个类有方法 ${s.method}`)
            else if (cands.length > 1) warn.push(`警告：第 ${at} 步：${cands.map(x => x.cls.name).join('、')} 都有方法 ${s.method}，按 ${cands[0].cls.name} 展开（可在步上写 cls 指定）`)
          }
        }
        for (const v of Object.values(s.args || {})) checkExpr(v, at)
        break
      }
      case 'ai':
        if (!s.goal?.trim()) errs.push(`错误：第 ${at} 步 AI 步要写清楚找什么`)
        if (s.act === 'input' && !s.text) warn.push(`警告：第 ${at} 步 AI 输入没有填文字`)
        break
      case 'tap': if (s.pointVar) checkPath(s.pointVar, at); break
      case 'input': case 'wait': checkExpr(s.text, at); break
      default: break
    }
    if (s.kind === 'tap' || s.kind === 'input' || s.kind === 'wait') for (const m of [s.sel?.text, s.sel?.desc, s.text].join(' ').matchAll(new RegExp(`\\$\\{(${PATH})\\}`, 'g'))) checkPath(m[1], at)
  })
  for (const f of stack) errs.push(`错误：第 ${f.idx + 1} 步 ${f.kind} 没有对应的结束步（${CONTROL_OPEN[f.kind]}）`)
  return [...errs, ...[...new Set(warn)]]
}

/** 校验一个 Flow 里定义的类：名字、字段、方法体（方法体按「在方法里」规则校验，this 可用、参数算已定义）。 */
export function validateClasses(fl: Flow, all: Flow[] = []): string[] {
  const out: string[] = []
  const names = new Set<string>()
  for (const c of fl.classes || []) {
    if (!isIdent(c.name)) out.push(`错误：类名「${c.name}」不合法（字母开头，字母数字下划线）`)
    if (names.has(c.name)) out.push(`错误：类 ${c.name} 重名`)
    names.add(c.name)
    for (const k of Object.keys(c.fields)) if (!isIdent(k) || k === '__class') out.push(`错误：类 ${c.name} 的字段名「${k}」不合法`)
    const ms = new Set<string>()
    for (const m of c.methods) {
      if (!isIdent(m.name)) out.push(`错误：类 ${c.name} 的方法名「${m.name}」不合法`)
      if (ms.has(m.name)) out.push(`错误：类 ${c.name} 的方法 ${m.name} 重名`)
      ms.add(m.name)
      if (m.flowId) { if (!all.some(f => f.id === m.flowId || f.name === m.flowId)) out.push(`错误：${c.name}.${m.name} 指向的 Flow 不存在`) }
      else if (!m.steps?.length) out.push(`错误：${c.name}.${m.name} 没有方法体（选一个 Flow 或写步骤）`)
      else out.push(...validateFlow(m.steps, all, undefined, { own: fl, inMethod: true, params: m.params }).map(e => e.replace(/^(错误|警告)：/, `$1：${c.name}.${m.name} `)))
    }
  }
  return out
}

export interface ExpandCtx { own?: Flow; varClass?: Record<string, string> }
const tag = (steps: FlowStep[], fid: string): FlowStep[] => steps.map((x, i) => ({ ...x, _i: i, _fid: fid }))

/**
 * 内联子流程与类方法：
 * - call{flowId} → 目标 Flow 的步骤；
 * - new{var, cls} → 带上类的字段默认值 fields（Java 侧不需要类表）；
 * - method{var, method, args} → bind{var, cls, method, args} + 方法体 + unbind（运行时绑定 this、实参离开方法后恢复）。
 * 最多展开 MAX_CALL_DEPTH 层；循环调用 / 超深 / 找不到时保留原步，原生会报错停下而不是静默跳过。
 */
export function expandCalls(steps: FlowStep[], all: Flow[], depth = 0, chain: string[] = [], ctx: ExpandCtx = {}): FlowStep[] {
  const varClass = ctx.varClass || {}
  const out: FlowStep[] = []
  for (const s of steps) {
    if (s.kind === 'new' && s.cls) {
      const c = findClass(s.cls, all, ctx.own)
      if (s.var && !s.var.includes('.')) varClass[s.var] = s.cls
      out.push(c ? { ...s, fields: { ...c.cls.fields } } : s)
      continue
    }
    if (s.kind === 'method' && s.var && s.method) {
      const cn = s.cls || varClass[s.var]
      const hit = cn ? findClass(cn, all, ctx.own) : classesWithMethod(s.method, all, ctx.own)[0]
      const m = hit?.cls.methods.find(x => x.name === s.method)
      const key = `${hit?.cls.name}.${s.method}`
      if (!hit || !m || depth >= MAX_CALL_DEPTH || chain.includes(key)) { out.push(s); continue }
      let body: FlowStep[]
      if (m.flowId) {
        const t = all.find(f => f.id === m.flowId || f.name === m.flowId)
        if (!t) { out.push(s); continue }
        body = tag(t.steps, t.id)
      } else body = tag(m.steps || [], `${hit.owner.id}::${hit.cls.name}.${m.name}`)
      out.push({ kind: 'bind', var: s.var, cls: hit.cls.name, method: s.method, args: s.args, _i: s._i, _fid: s._fid })
      out.push(...expandCalls(body, all, depth + 1, [...chain, key], { own: hit.owner, varClass: { ...varClass } }))
      out.push({ kind: 'unbind', _i: s._i, _fid: s._fid })
      continue
    }
    if (s.kind !== 'call' || !s.flowId) { out.push(s); continue }
    const target = all.find(f => f.id === s.flowId || f.name === s.flowId)
    // v0.22：子 Flow 最多 5 层；自己调自己 / 循环调用保留原步，原生报错停下
    if (!target || depth >= MAX_SUBFLOW_DEPTH || chain.includes(target.id) || target.id === ctx.own?.id && depth === 0) { out.push(s); continue }
    // 参数传递：call.args 填进子 Flow 的 {参数}；没传的留给外层同名参数（runFlow 展开后再 fill 一次）
    const body = s.args && Object.keys(s.args).length ? fill(target.steps, s.args) : target.steps
    out.push(...expandCalls(tag(body, target.id), all, depth + 1, [...chain, ...(depth === 0 && ctx.own ? [ctx.own.id] : []), target.id], { own: target, varClass }))
  }
  return out
}

const PARAM = /(?<!\$)\{([^{}]{1,20})\}/g
/** {参数} → 实际值；${变量} 原样保留（运行时求值）。 */
export const fill = (steps: FlowStep[], vals: Record<string, string>): FlowStep[] =>
  steps.map(s => {
    const r = (t?: string) => t?.replace(PARAM, (m, k) => (k in vals ? vals[k] : m))
    const rm = (o?: Record<string, string>) => o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v) ?? ''])) : undefined
    const cond = s.cond ? { ...s.cond, text: r(s.cond.text), value: r(s.cond.value), sel: s.cond.sel ? { ...s.cond.sel, text: r(s.cond.sel.text), desc: r(s.cond.sel.desc) } : undefined } : undefined
    return { ...s, text: r(s.text), note: r(s.note), value: r(s.value), goal: r(s.goal), args: rm(s.args), cond,
      from: typeof s.from === 'string' ? r(s.from) : s.from, to: typeof s.to === 'string' ? r(s.to) : s.to,
      sel: s.sel ? { ...s.sel, text: r(s.sel.text), desc: r(s.sel.desc) } : undefined }
  })
export const paramsIn = (steps: FlowStep[]) => [...new Set(steps.flatMap(s =>
  [s.text, s.value, s.goal, s.sel?.text, s.sel?.desc, s.cond?.text, s.cond?.value, typeof s.from === 'string' ? s.from : '', typeof s.to === 'string' ? s.to : '', ...Object.values(s.args || {})]
    .join(' ').match(PARAM) || []).map(x => x.slice(1, -1)))]
export const hasParam = (s: FlowStep) => paramsIn([s]).length > 0
/** v0.20：目标或文字里带 ${变量}（比如循环里的「第 ${i} 篇笔记」）的步每次指向不同元素，学到的选择器也不能写死。 */
export const hasDynamic = (s: FlowStep) => /\$\{/.test([s.goal, s.text, s.sel?.text, s.sel?.desc].join(' '))

/** 录制结果清理：合并重复滚动、去掉空输入、补上应用名。 */
export function tidy(steps: FlowStep[], app?: string): FlowStep[] {
  const out: FlowStep[] = []
  for (const s0 of steps) {
    const s = { ...s0 }
    delete s._i; delete s._fid
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

/** 运行结果里 AI 视觉学到的位置：写回对应 Flow / 类方法的那一步。带 {参数} 或 ${变量} 的步不写（选择器会把某次的值写死）。返回写回了几步。 */
export interface Learned { fid: string; i: number; sel?: Sel; x?: number; y?: number }
export function applyLearned(all: Flow[], learned: Learned[]): number {
  let n = 0
  for (const l of learned) {
    const [fid, path] = l.fid.split('::')
    const f = all.find(x => x.id === fid); if (!f) continue
    let steps = f.steps
    if (path) {
      const [cn, mn] = path.split('.')
      const m = f.classes?.find(c => c.name === cn)?.methods.find(x => x.name === mn)
      if (!m?.steps) continue
      steps = m.steps
    }
    const s = steps[l.i]
    if (!s || (s.kind !== 'ai' && !(s.kind === 'tap' && s.vision)) || hasParam(s) || hasDynamic(s)) continue
    if (l.sel && Object.keys(l.sel).length) s.sel = l.sel
    if (l.x != null && l.y != null) { s.x = l.x; s.y = l.y }
    f.updated = Date.now()
    n++
  }
  return n
}
