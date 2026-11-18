/** AI 接管（v0.24）的纯逻辑：动作解析、付款 / 发送 / 删除拦截、登录与验证码识别、屏幕指纹、提示词、候选合并。
 * 不依赖浏览器和原生插件，可以直接用 node 单测（scripts/agent-test.mts）。循环本身在 agent.ts。 */
import { AGENT_DEFAULTS, STOP_KINDS, type FlowStep, type StopKind } from './flowcore.ts'

export type AgentTier = 'helium' | 'neon' | 'argon'
export type AgentMode = 'browse' | 'order'
export interface Candidate { name: string; price?: string; rating?: string; sales?: string; shop?: string; where?: string; pros?: string; cons?: string; turn?: number }
export type ActType = 'tap' | 'long' | 'input' | 'enter' | 'scroll' | 'swipe' | 'back' | 'wait' | 'note' | 'done' | 'ask_user'
export interface AgentAction {
  type: ActType; thought: string
  id?: number; x?: number; y?: number; text?: string; dir?: 'up' | 'down' | 'left' | 'right'; ms?: number
  notes: Candidate[]; summary?: string; pick?: { name: string; reason: string }; question?: string
}

/** 一个 agent 步的配置（步上的字段 + 默认值 + 继续运行时的附加信息）。 */
export interface AgentCfg {
  goal: string; criteria?: string; maxSteps: number; maxMinutes: number; stopBefore: StopKind[]; output: 'compare' | 'text' | 'none'; model: AgentTier
  mode?: AgentMode; feedback?: string; prior?: Candidate[]; priorSummary?: string
  flowId?: string; flowName?: string; app?: string; pkg?: string
}
export function agentCfg(s: Partial<FlowStep>, extra: Partial<AgentCfg> = {}): AgentCfg {
  const stop = (s.stopBefore && s.stopBefore.length ? s.stopBefore : STOP_KINDS).filter(k => STOP_KINDS.includes(k))
  return {
    goal: (s.goal || '').trim(), criteria: s.criteria?.trim() || undefined,
    maxSteps: clampInt(s.maxSteps, 1, 60, AGENT_DEFAULTS.maxSteps), maxMinutes: clampNum(s.maxMinutes, 0.5, 30, AGENT_DEFAULTS.maxMinutes),
    stopBefore: stop.includes('pay') ? stop : ['pay', ...stop], // 付款永远停
    output: s.output || AGENT_DEFAULTS.output, model: s.model || AGENT_DEFAULTS.model, ...extra,
  }
}
const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v != null ? Math.max(lo, Math.min(hi, n)) : d }
const clampNum = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) && v != null ? Math.max(lo, Math.min(hi, n)) : d }

/* ---------- 动作解析 */
/** 从模型输出里取第一个完整的 JSON 对象（支持嵌套、字符串里的括号、```json 代码块）。 */
export function firstJson(text: string): string | null {
  const t = text || ''
  for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
    let depth = 0, str = false, esc = false
    for (let i = start; i < t.length; i++) {
      const c = t[i]
      if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue }
      if (c === '"') str = true
      else if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { const s = t.slice(start, i + 1); try { JSON.parse(s); return s } catch { break } } }
    }
  }
  return null
}
const ALIAS: Record<string, ActType> = {
  tap: 'tap', click: 'tap', press: 'tap', long: 'long', long_press: 'long', longpress: 'long',
  input: 'input', type: 'input', text: 'input', enter: 'enter', search: 'enter', submit_search: 'enter',
  scroll: 'scroll', scroll_down: 'scroll', scroll_up: 'scroll', swipe: 'swipe', swipe_left: 'swipe', swipe_right: 'swipe',
  back: 'back', go_back: 'back', wait: 'wait', sleep: 'wait',
  note: 'note', note_candidate: 'note', note_candidates: 'note', record: 'note',
  done: 'done', finish: 'done', complete: 'done', ask_user: 'ask_user', ask: 'ask_user', take_over: 'ask_user', takeover: 'ask_user',
}
const str = (v: unknown, n = 120) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const opt = (v: unknown, n = 60) => { const s = str(v, n); return s && !/^(null|undefined|无|未知|n\/a|-)$/i.test(s) ? s : undefined }
export function normCandidate(v: unknown): Candidate | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = str(o.name ?? o.title ?? o.product, 80)
  if (!name) return null
  const c: Candidate = { name }
  const set = (k: keyof Candidate, ...keys: string[]) => { for (const x of keys) { const s = opt(o[x], k === 'pros' || k === 'cons' ? 90 : 40); if (s) { (c as unknown as Record<string, string>)[k] = s; return } } }
  set('price', 'price', '价格'); set('rating', 'rating', 'score', '评分', '好评率'); set('sales', 'sales', 'sold', '销量'); set('shop', 'shop', 'store', 'seller', '店铺')
  set('where', 'where', 'position', 'url', 'pos'); set('pros', 'pros', '优点'); set('cons', 'cons', '缺点')
  return c
}
/** 解析一个动作。raw 可以是模型的文字回答，也可以是 tool call 的 arguments（字符串或对象）。w/h 是屏幕像素，用来把像素坐标换成比例。 */
export function parseAction(raw: unknown, w = 0, h = 0): { action: AgentAction } | { error: string } {
  let j: Record<string, unknown>
  if (raw && typeof raw === 'object') j = raw as Record<string, unknown>
  else {
    const s = firstJson(String(raw ?? ''))
    if (!s) return { error: '回答里没有 JSON 动作' }
    j = JSON.parse(s)
  }
  if (j.arguments && typeof j.arguments === 'string' && !j.action) { const s = firstJson(j.arguments); if (s) j = JSON.parse(s) }
  const name = String(j.action ?? j.type ?? j.op ?? j.name ?? '').toLowerCase().trim()
  const type = ALIAS[name]
  if (!type) return { error: `不认识的动作「${name || '空'}」` }
  const notes: Candidate[] = []
  for (const v of [j.candidate, ...(Array.isArray(j.candidates) ? j.candidates : []), ...(Array.isArray(j.notes) ? j.notes : [])]) { const c = normCandidate(v); if (c) notes.push(c) }
  if (type === 'note' && !notes.length) { const c = normCandidate(j); if (c && j.name) notes.push(c) }
  const a: AgentAction = { type, thought: str(j.thought ?? j.reason ?? j.why, 80), notes }
  const dirOf = (d: unknown, def: AgentAction['dir']) => { const x = String(d ?? '').toLowerCase(); return (['up', 'down', 'left', 'right'] as const).find(k => x === k || x.includes(k)) || def }
  switch (type) {
    case 'tap': case 'long': {
      const id = j.id ?? j.element ?? j.i ?? j.index
      if (id != null && id !== '' && Number.isInteger(Number(id)) && Number(id) >= 0) { a.id = Number(id); break }
      let x = Number(j.x), y = Number(j.y)
      if (Array.isArray(j.point) || Array.isArray(j.xy)) { const p = (j.point || j.xy) as unknown[]; x = Number(p[0]); y = Number(p[1]) }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: '点击要给元素编号 id，或 0-1 比例坐标 x、y' }
      if (x > 1 || y > 1) { if (!(w > 0 && h > 0)) return { error: '坐标超出 0-1' }; x /= w; y /= h }
      if (x < 0 || y < 0 || x > 1 || y > 1) return { error: '坐标在屏幕外' }
      a.x = Math.round(x * 1000) / 1000; a.y = Math.round(y * 1000) / 1000
      break
    }
    case 'input': {
      const t = j.text ?? j.value ?? j.content
      if (t == null || String(t) === '') return { error: '输入要给 text' }
      a.text = String(t).slice(0, 200)
      if (j.id != null && Number.isInteger(Number(j.id))) a.id = Number(j.id)
      break
    }
    case 'scroll': a.dir = name === 'scroll_up' ? 'up' : dirOf(j.dir ?? j.direction, 'down') === 'up' ? 'up' : 'down'; break
    case 'swipe': a.dir = name === 'swipe_right' ? 'right' : name === 'swipe_left' ? 'left' : dirOf(j.dir ?? j.direction, 'left'); break
    case 'wait': a.ms = Math.max(300, Math.min(3000, Number(j.ms) || 1200)); break
    case 'done': {
      a.summary = str(j.summary ?? j.result ?? j.text, 300)
      const p = j.pick ?? j.choice ?? j.best
      if (p && typeof p === 'object') { const po = p as Record<string, unknown>; const n = str(po.name ?? po.title, 80); if (n) a.pick = { name: n, reason: str(po.reason ?? po.why, 200) } }
      else if (typeof p === 'string' && p.trim()) a.pick = { name: str(p, 80), reason: str(j.reason ?? j.why, 200) }
      break
    }
    case 'ask_user': a.question = str(j.question ?? j.text ?? j.thought, 200) || '需要你看一下手机'; break
    default: break
  }
  return { action: a }
}

/* ---------- 安全：付款 / 提交订单 / 发送 / 删除 前一定停下 */
export const STOP_WORDS: Record<StopKind, string[]> = {
  pay: ['确认支付', '立即支付', '去支付', '支付(?!宝)', '付款', '确认付款', '免密支付', '立即付款', '去付款', '确认交易', '支付密码'],
  submit: ['提交订单', '确认订单', '立即下单', '去下单', '下单', '立即购买', '领券购买', '立即抢购', '马上抢', '去结算', '结算', '确认购买', '确认收货', '提交'],
  send: ['发送', '发布', '发表'],
  delete: ['删除', '移除', '清空', '注销', '取消订单', '解绑'],
}
/** 「继续去下单」时允许点的入口：进到下单页（提交订单页）为止。提交订单、付款仍然拦。 */
export const ORDER_ENTRY = ['立即购买', '领券购买', '立即抢购', '马上抢', '去结算', '结算']
export const STOP_LABEL: Record<StopKind, string> = { pay: '付款', submit: '提交订单 / 下单', send: '发送 / 发布', delete: '删除' }
const wordsFor = (kinds: StopKind[], mode: AgentMode = 'browse') => {
  const ks = kinds.includes('pay') ? kinds : (['pay', ...kinds] as StopKind[])
  return ks.flatMap(k => STOP_WORDS[k].filter(w => !(mode === 'order' && k === 'submit' && ORDER_ENTRY.includes(w))).map(w => ({ k, w })))
}
/** 原生拦截用的正则源（Java Pattern 也能用：只有字面量、| 和 (?!宝)）。 */
export const guardSource = (kinds: StopKind[], mode: AgentMode = 'browse') => wordsFor(kinds, mode).map(x => x.w).join('|')
/** 点击目标文字命中哪一类危险操作；没命中返回 null。 */
export function dangerOf(text: string, kinds: StopKind[] = STOP_KINDS, mode: AgentMode = 'browse'): { kind: StopKind; word: string } | null {
  const t = (text || '').replace(/\s+/g, '')
  if (!t) return null
  for (const { k, w } of wordsFor(kinds, mode)) { const m = new RegExp(w).exec(t); if (m) return { kind: k, word: m[0] } }
  return null
}

/* ---------- 元素列表 */
export interface El { id: number; cls: string; text: string; desc: string; flags: string; x: number; y: number }
/** 解析 LumiA11yService.dump 的一行：[编号] 类型 "文字" (描述) {属性} @x,y */
export function parseElements(dump: string): El[] {
  const out: El[] = []
  for (const line of (dump || '').split('\n')) {
    const m = /^\[(\d+)\]\s+(\S+)(.*?)\s+@(-?\d+),(-?\d+)\s*$/.exec(line)
    if (!m) continue
    let rest = m[3]
    let flags = ''
    const f = /\s*\{([^{}]*)\}\s*$/.exec(rest); if (f) { flags = f[1]; rest = rest.slice(0, f.index) }
    let desc = ''
    const d = /\s*\(([^()]*)\)\s*$/.exec(rest); if (d) { desc = d[1]; rest = rest.slice(0, d.index) }
    const t = /^\s*"(.*)"\s*$/.exec(rest)
    out.push({ id: Number(m[1]), cls: m[2], text: t ? t[1] : rest.trim(), desc, flags, x: Number(m[4]), y: Number(m[5]) })
  }
  return out
}
export const elText = (e?: El) => e ? [e.text, e.desc].filter(Boolean).join(' ') : ''
/** 比例坐标附近（屏幕宽 8% 以内）的元素文字，坐标点击的预检查用。 */
export function textNear(els: El[], x: number, y: number, w: number, h: number): string {
  const px = x * w, py = y * h, r = Math.max(40, w * 0.08)
  return els.filter(e => Math.hypot(e.x - px, e.y - py) <= r).map(elText).join(' ')
}
/** 屏幕指纹：元素列表去掉焦点标记后的哈希。 */
export function fingerprint(dump: string): string {
  const body = (dump || '').split('\n').filter(l => l.startsWith('[')).map(l => l.replace(/,?焦点,?/g, m => m.length === 4 ? ',' : '').replace(/ \{\}/, '')).join('\n')
  let h = 5381
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0
  return (h >>> 0).toString(16) + ':' + body.length
}

/** 登录 / 验证码 / 滑块页：AI 接管停下来让用户处理。 */
export function screenGate(dump: string): { kind: 'captcha' | 'login'; word: string } | null {
  const t = parseElements(dump).map(elText).join(' | ')
  const cap = /(安全验证|人机验证|拖动滑块|滑块验证|向右滑动|请完成验证|请按住滑块|拼图验证|点击完成验证|身份验证)/.exec(t)
  if (cap) return { kind: 'captcha', word: cap[1] }
  const login = /(密码登录|短信登录|验证码登录|账号登录|其他登录方式|本机号码一键登录|一键登录|请先登录|扫码登录)/.exec(t)
  if (login) return { kind: 'login', word: login[1] }
  if (/登录/.test(t) && /(请输入手机号|输入密码|获取验证码|请输入密码|手机号码)/.test(t)) return { kind: 'login', word: '登录' }
  return null
}

/* ---------- 候选 */
const keyOf = (n: string) => n.toLowerCase().replace(/[\s【】[\]（）()「」,，.。!！]/g, '').slice(0, 24)
export function mergeCandidates(old: Candidate[], add: Candidate[], turn?: number, cap = 20): Candidate[] {
  const out = old.map(c => ({ ...c }))
  for (const c of add) {
    const k = keyOf(c.name)
    const i = out.findIndex(o => keyOf(o.name) === k || (k.length >= 8 && (keyOf(o.name).startsWith(k) || k.startsWith(keyOf(o.name)))))
    if (i >= 0) { const o = out[i]; for (const [f, v] of Object.entries(c)) if (v && f !== 'turn') (o as unknown as Record<string, unknown>)[f] = v; if (c.name.length > o.name.length) o.name = c.name }
    else out.push({ ...c, ...(turn != null ? { turn } : {}) })
  }
  return out.slice(0, cap)
}
/** 选中的候选（按名字模糊匹配），找不到返回 -1。 */
export function pickIndex(cands: Candidate[], name?: string): number {
  if (!name) return -1
  const k = keyOf(name)
  let i = cands.findIndex(c => keyOf(c.name) === k)
  if (i < 0) i = cands.findIndex(c => keyOf(c.name).includes(k.slice(0, 10)) || k.includes(keyOf(c.name).slice(0, 10)))
  return i
}

/* ---------- 提示词 */
export const AGENT_SYSTEM = `你是栖语 Lumi 的手机操作助手，正在接管用户的安卓手机完成一个目标。准确比速度重要：每一步先看清屏幕再动手，不确定就先滚动看看或返回，不要猜。
每轮只输出一个动作，格式是一个 JSON 对象（用 act 工具提交，或者直接输出 JSON，不要别的文字）：
{"thought":"一句话：看到了什么、为什么这样做（中文，30 字以内）","action":"动作名", ...参数}
动作：
- tap {id} 点击元素编号（优先用编号）；列表里没有、截图里有时用 {x,y}（0-1 的屏幕比例）
- long {id} 长按
- input {id?, text} 在输入框输入；id 省略时输入到当前焦点框
- enter 输入法回车 / 搜索
- scroll {dir:"down"|"up"} 滚动列表；swipe {dir:"left"|"right"} 左右翻页
- back 系统返回
- wait {ms} 等页面加载，最多 3000
- note {candidates:[{name, price, rating, sales, shop, where, pros, cons}]} 记下看过的候选
- done {summary, pick:{name, reason}} 目标达成；pick 是最终选中的那一个和理由
- ask_user {question} 需要用户决定或操作（登录、验证码、目标不清楚）
任何动作都可以带 "candidates":[...]，顺手记下这一屏看到的候选，省一轮。
规则：
1. 只用屏幕上真实出现的信息：名称、价格、销量、评分、店铺照抄，看不到就留空，不要编造。候选的 where 写它在哪（比如 搜索结果第 3 个）。
2. 比较 / 挑选类目标：先在列表里浏览，记下足够数量的候选（目标里有数量就按数量），需要时点进详情看评分和评价再返回；然后按挑选标准选一个，最后停在目标要求的页面，再 done。
3. 绝对不要点 付款、支付、提交订单、确认订单、下单、立即购买、领券购买、去结算、确认收货、发送、发布、删除 这类按钮（除非目标里明确写了可以点哪一个）。到了这一步就 done 或 ask_user，交给用户。
4. 广告、升级提示、开屏弹窗可以点关闭或跳过；登录、验证码、滑块一律 ask_user。
5. 如果提示「上一步后屏幕没有变化」，换一种做法（换元素、滚动、返回），不要重复同一个动作。
6. 轮数和时间有限；快到上限时用已记下的候选收尾 done。`

export const ACT_TOOL = {
  type: 'function',
  function: {
    name: 'act', description: '提交这一轮要执行的一个动作',
    parameters: { type: 'object', properties: {
      thought: { type: 'string' }, action: { type: 'string', enum: ['tap', 'long', 'input', 'enter', 'scroll', 'swipe', 'back', 'wait', 'note', 'done', 'ask_user'] },
      id: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' }, dir: { type: 'string' }, ms: { type: 'integer' },
      candidates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' }, rating: { type: 'string' }, sales: { type: 'string' }, shop: { type: 'string' }, where: { type: 'string' }, pros: { type: 'string' }, cons: { type: 'string' } } } },
      summary: { type: 'string' }, pick: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } }, question: { type: 'string' },
    }, required: ['thought', 'action'] },
  },
} as const

export const candLine = (c: Candidate, i: number) => `${i + 1}. ${c.name}${c.price ? ` · ${c.price}` : ''}${c.rating ? ` · 评分 ${c.rating}` : ''}${c.sales ? ` · ${c.sales}` : ''}${c.shop ? ` · ${c.shop}` : ''}${c.where ? `（${c.where}）` : ''}`
export function agentUserText(o: { cfg: AgentCfg; turn: number; elapsedS: number; cands: Candidate[]; history: string[]; elements: string; pkg?: string; note?: string }): string {
  const { cfg } = o
  const els = o.elements.length > 7000 ? o.elements.slice(0, 7000) + '\n…' : o.elements
  const left = cfg.maxSteps - o.turn + 1
  return [
    `目标：${cfg.goal}`,
    cfg.criteria ? `挑选标准：${cfg.criteria}` : '',
    cfg.mode === 'order' ? '模式：去下单。可以点「立即购买 / 领券购买 / 去结算」，选好规格（不确定就选默认或 ask_user），停在提交订单页就 done；绝对不点提交订单、付款、支付。' : '',
    cfg.feedback ? `用户的反馈：${cfg.feedback}` : '',
    cfg.priorSummary ? `上一次的结论：${cfg.priorSummary}` : '',
    `进度：第 ${o.turn}/${cfg.maxSteps} 轮，已用 ${Math.round(o.elapsedS)} 秒，上限 ${Math.round(cfg.maxMinutes * 60)} 秒${left <= 3 ? '。快到上限了，请用已有候选收尾 done' : ''}`,
    `已记下的候选（${o.cands.length}）：${o.cands.length ? '\n' + o.cands.map(candLine).join('\n') : '还没有'}`,
    o.history.length ? `最近的操作：\n${o.history.slice(-8).join('\n')}` : '',
    o.note ? `注意：${o.note}` : '',
    `当前屏幕${o.pkg ? `（${o.pkg}）` : ''}，元素：[编号] 类型 "文字" (描述) {属性} @像素中心\n${els}`,
  ].filter(Boolean).join('\n\n')
}

export const actionLabel = (a: AgentAction, target = ''): string => {
  const t = target ? `「${target.slice(0, 16)}」` : a.id != null ? ` [${a.id}]` : a.x != null ? `（${Math.round((a.x || 0) * 100)}%, ${Math.round((a.y || 0) * 100)}%）` : ''
  switch (a.type) {
    case 'tap': return `点击${t}`
    case 'long': return `长按${t}`
    case 'input': return `输入「${(a.text || '').slice(0, 16)}」`
    case 'enter': return '回车 / 搜索'
    case 'scroll': return a.dir === 'up' ? '向上滚动' : '向下滚动'
    case 'swipe': return a.dir === 'right' ? '向右滑' : a.dir === 'up' ? '向上滑' : a.dir === 'down' ? '向下滑' : '向左滑'
    case 'back': return '返回'
    case 'wait': return `等 ${((a.ms || 1200) / 1000).toFixed(1)} 秒`
    case 'note': return `记下 ${a.notes.length} 个候选`
    case 'done': return '完成'
    case 'ask_user': return '需要你处理'
  }
}

/* ---------- 结果 */
export type AgentStatus = 'done' | 'safety' | 'ask' | 'login' | 'stopped' | 'limit' | 'fail'
export interface AgentTurn { i: number; ms: number; modelMs: number; calls: number; label: string; thought: string; changed?: boolean }
export interface AgentOutcome {
  id: string; status: AgentStatus; at: number
  cfg: AgentCfg; summary: string; reason: string
  pick?: { name: string; reason: string }; candidates: Candidate[]
  turns: AgentTurn[]; modelCalls: number; modelMs: number; ms: number
  question?: string; blocked?: { kind: StopKind; word: string; target: string }
  ended?: boolean
}
export const STATUS_LABEL: Record<AgentStatus, string> = { done: '已完成', safety: '已停在敏感操作前', ask: '需要你决定', login: '需要你登录或验证', stopped: '已停止', limit: '到达上限', fail: '没完成' }
/** 给模型 / 运行结果的一段文字。 */
export function outcomeText(o: AgentOutcome): string {
  const head = `AI 接管${STATUS_LABEL[o.status]}（${o.turns.length} 轮 · ${(o.ms / 1000).toFixed(0)} 秒 · 模型 ${o.modelCalls} 次）`
  const lines = [head]
  if (o.summary) lines.push(o.summary)
  if (o.pick) lines.push(`选中：${o.pick.name}${o.pick.reason ? '。理由：' + o.pick.reason : ''}`)
  if (o.blocked) lines.push(`停在「${o.blocked.word}」前（${STOP_LABEL[o.blocked.kind]}），需要用户自己确认`)
  if (o.question) lines.push(`需要用户：${o.question}`)
  if (o.reason && o.status !== 'done') lines.push(o.reason)
  if (o.candidates.length) lines.push('候选：\n' + o.candidates.map(candLine).join('\n'))
  return lines.join('\n')
}
