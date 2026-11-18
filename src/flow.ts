/** Flow：按应用保存的一串手机操作，原生无障碍服务负责录制和运行。
 * 纯逻辑（类型、求值、校验、展开）在 flowcore.ts；这里是存储、原生运行、AI 视觉桥和给模型的工具。 */
import { Phone, isNative } from './phone'
import { loadSettings } from './api'
import { visionLocate, type VisionReq } from './vision'
import { stores } from './custom'
import { applyLearned, canExtract, expandCalls, fill, paramsIn, tidy, validateClasses, validateFlow, type Flow, type FlowStep, type Learned, type VarValue } from './flowcore'
export * from './flowcore'

const uid = () => Math.random().toString(36).slice(2, 10)
const K = 'lumi.flows'
export const loadFlows = (): Flow[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export const saveFlows = (f: Flow[]) => {
  localStorage.setItem(K, JSON.stringify(f))
  window.dispatchEvent(new Event('lumi-flows'))
  if (isNative) Phone.folderStatus().then(st => { if (st.linked) Phone.writeText({ path: 'Flow/flows.json', text: JSON.stringify(f, null, 1) }).catch(() => {}) }).catch(() => {})
}
// v0.20：对话里的确认卡（custom.ts）也走这里存 Flow，保持同步到手机文件夹
stores.flows = { load: loadFlows, save: saveFlows }
export const upsertFlow = (fl: Flow) => { const a = loadFlows(); const i = a.findIndex(x => x.id === fl.id); if (i >= 0) a[i] = fl; else a.unshift(fl); saveFlows(a); return fl }

/* ---------- v0.22 录制返回：新建 Flow，或「继续录制」时把新步骤接到已有 Flow 里 */
export interface RecMeta { app: string; pkg: string; appendTo?: string; at?: number }
export type RecResult = { id: string; added: number; appended: boolean } | { error: string }
/** 把录到的步骤接进 fl：去掉重复的打开应用，插在 at（默认最后）。纯逻辑，网页里也能测。 */
export function appendRecorded(fl: Flow, raw: FlowStep[], at?: number): RecResult {
  const hasLaunch = fl.steps.some(s => s.kind === 'launch')
  const add = tidy(raw, fl.app).filter(s => !(s.kind === 'launch' && (hasLaunch || (at ?? fl.steps.length) > 0)))
  if (!add.length) return { error: '没录到新的操作' }
  const pos = Math.max(0, Math.min(at ?? fl.steps.length, fl.steps.length))
  const steps = [...fl.steps]; steps.splice(pos, 0, ...add)
  upsertFlow({ ...fl, steps, params: paramsIn(steps), updated: Date.now() })
  return { id: fl.id, added: add.length, appended: true }
}
/** 回到 App 时调用：有一次刚结束的录制就处理掉（只处理一次）。 */
export async function consumeRecording(): Promise<RecResult | null> {
  if (!isNative) return null
  const rec = localStorage.getItem('lumi.recording'); if (!rec) return null
  const st = await Phone.recordStatus(); if (st.recording) return null
  if (localStorage.getItem('lumi.recording') !== rec) return null
  localStorage.removeItem('lumi.recording')
  const meta = JSON.parse(rec) as RecMeta
  if (meta.appendTo) {
    const fl = loadFlows().find(x => x.id === meta.appendTo)
    if (!fl) return { error: '要接着录的 Flow 已经不在了' }
    return appendRecorded(fl, st.steps || [], meta.at)
  }
  const steps = tidy(st.steps || [], meta.app)
  if (steps.length < 2) return { error: '没录到操作，再试一次' }
  const fl = upsertFlow({ id: uid(), app: meta.app, pkg: meta.pkg, name: '新的 Flow', desc: '', steps, params: paramsIn(steps), updated: Date.now(), runs: 0 })
  return { id: fl.id, added: steps.length, appended: false }
}
/** 开始录制；appendTo 时是「继续录制」：回到应用当前页面接着录，不新加打开应用这一步。 */
export async function startRecording(meta: RecMeta): Promise<string | null> {
  if (!isNative) return '只有安卓 App 里可以录制'
  if (!(await Phone.a11yStatus()).enabled) return '先到「手机连接」里打开无障碍'
  localStorage.setItem('lumi.recording', JSON.stringify(meta))
  await Phone.recordStart({ pkg: meta.pkg, app: meta.app, resume: !!meta.appendTo })
  return null
}

/** 合并：把 fl 的第 from–to 步存成一个新的子 Flow，原位置换成一个 call 步（参数原样往下传）。返回新 Flow。 */
export function extractSubflow(fl: Flow, from: number, to: number, name?: string): { parent: Flow; child: Flow } | { error: string } {
  const why = canExtract(fl.steps, from, to); if (why) return { error: why }
  const part = tidy(fl.steps.slice(from, to + 1).map(s => JSON.parse(JSON.stringify(s)) as FlowStep))
  const params = paramsIn(part)
  const child: Flow = { id: uid(), app: fl.app, pkg: fl.pkg, name: name || `${fl.name} · 子流程`, desc: `从「${fl.name}」第 ${from + 1}–${to + 1} 步合并`, steps: part, params, updated: Date.now(), runs: 0, fast: fl.fast, vars: fl.vars }
  const call: FlowStep = { kind: 'call', flowId: child.id, ...(params.length ? { args: Object.fromEntries(params.map(p => [p, `{${p}}`])) } : {}) }
  const steps = [...fl.steps.slice(0, from), call, ...fl.steps.slice(to + 1)]
  const parent = { ...fl, steps, params: paramsIn(steps), updated: Date.now() }
  const all = loadFlows().filter(x => x.id !== fl.id)
  saveFlows([parent, child, ...all])
  return { parent, child }
}

export interface TraceItem {
  pc: number; i?: number; fid?: string; label: string; ms: number; src: 'native' | 'cache' | 'vision' | 'coord' | 'ocr' | 'logic' | 'skip' | 'fail'
  /** v0.23 耗时拆分（毫秒）：查找 / 动作 / 等页面（look-ahead 或安静窗）/ AI 视觉 / 端侧 OCR */
  lk?: number; ac?: number; wt?: number; vs?: number; oc?: number
  /** v0.23 命中的是哪一层：ahead（上一步等页面时已找到）/ id / text / walk / bounds（缓存坐标）/ focus / edit / coord / ocr / vision / launch，重试时带 +retry */
  tier?: string
}
export interface RunResult {
  ok: boolean; done: number; total: number; failedAt?: number; reason?: string; screen?: string; log?: string[]; ms?: number; stepMs?: number[]
  trace?: TraceItem[]; learned?: Learned[]; visionMs?: number; visionCalls?: number; vars?: Record<string, VarValue>
  /** v0.23：失败时的截图（长边 480px JPEG base64）、OCR 调用次数、引擎版本 */
  shot?: string; ocrCalls?: number; engine?: string
  /** 写回了几个 AI 学到的选择器；JS 侧每次模型调用的耗时 */
  saved?: number; modelMs?: number[]
}

/** 校验一个 Flow（步骤 + 类），供编辑页和运行前用。 */
export const checkFlow = (fl: Flow, all = loadFlows()) => [...validateFlow(fl.steps, all, fl.vars, { own: fl }), ...validateClasses(fl, all)]

/** 跑一个 Flow：校验 → 标注步骤来源 → 填参数 → 展开 call/类方法 → 原生执行；AI 视觉请求在这里调模型；学到的选择器写回。 */
export async function runFlow(fl: Flow, vals: Record<string, string> = {}): Promise<RunResult> {
  if (!isNative) throw new Error('Flow 要在安卓 App 里运行，网页版只能查看和编辑')
  const all = loadFlows()
  const errors = checkFlow(fl, all).filter(p => p.startsWith('错误'))
  if (errors.length) return { ok: false, done: 0, total: fl.steps.length, failedAt: 0, reason: errors.join('；') }
  const own = all.find(x => x.id === fl.id) || fl
  const tagged = fl.steps.map((s, i) => ({ ...s, _i: i, _fid: fl.id }))
  // v0.22：子 Flow 里没被 call.args 填上的 {参数} 用外层同名参数再填一次
  const steps = fill(expandCalls(fill(tagged, vals), all, 0, [], { own }), vals)
  const modelMs: number[] = []
  const sub = await Phone.addListener('flowVision', async (d: VisionReq) => {
    try {
      const r = await visionLocate(loadSettings(), d)
      modelMs.push(r.ms)
      await Phone.flowVisionAnswer({ id: d.id, ...r })
    } catch (e) { await Phone.flowVisionAnswer({ id: d.id, error: (e as Error).message || String(e) }).catch(() => {}) }
  }).catch(() => null)
  let r: RunResult
  const pkg = fl.pkg || fl.steps.find(x => x.kind === 'launch' && x.pkg)?.pkg || ''
  try { r = await Phone.flowRun({ name: fl.name, steps, fast: fl.fast ?? true, vars: fl.vars || {}, pkg }) as unknown as RunResult }
  finally { sub?.remove() }
  r.modelMs = modelMs
  const now = loadFlows()
  r.saved = r.learned?.length ? applyLearned(now, r.learned) : 0
  const i = now.findIndex(x => x.id === fl.id)
  if (i >= 0) now[i] = { ...now[i], runs: now[i].runs + 1, lastOk: r.ok, lastMs: r.ms }
  saveFlows(now)
  saveRun(fl, r)
  return r
}

/* ---------- v0.23 最近运行：保留最近 12 次的明细（每步耗时拆分），方便截图对比；只有最近一次带失败截图 */
const RUNS = 'lumi.flowRuns'
export interface SavedRun { flowId: string; name: string; app: string; at: number; r: RunResult }
export const loadRuns = (): SavedRun[] => { try { return JSON.parse(localStorage.getItem(RUNS) || '[]') } catch { return [] } }
export function saveRun(fl: Flow, r: RunResult) {
  const slim: RunResult = { ok: r.ok, done: r.done, total: r.total, failedAt: r.failedAt, reason: r.reason, ms: r.ms, trace: r.trace, visionMs: r.visionMs, visionCalls: r.visionCalls, ocrCalls: r.ocrCalls, saved: r.saved, modelMs: r.modelMs, engine: r.engine, shot: r.shot }
  const old = loadRuns().map(x => ({ ...x, r: { ...x.r, shot: undefined } }))
  const all = [{ flowId: fl.id, name: fl.name, app: fl.app, at: Date.now(), r: slim }, ...old].slice(0, 12)
  try { localStorage.setItem(RUNS, JSON.stringify(all)) } catch { try { localStorage.setItem(RUNS, JSON.stringify(all.map(x => ({ ...x, r: { ...x.r, shot: undefined } })).slice(0, 6))) } catch { /* 存不下就算了 */ } }
  window.dispatchEvent(new Event('lumi-flowruns'))
}

/** 原生步（不含视觉 / 失败 / 跳过）的平均耗时拆分。 */
export function runSplit(t: TraceItem[]) {
  const xs = t.filter(x => x.src !== 'logic' && x.src !== 'vision' && x.src !== 'fail' && x.src !== 'skip')
  const avg = (k: 'ms' | 'lk' | 'ac' | 'wt') => xs.length ? Math.round(xs.reduce((a, x) => a + (x[k] || 0), 0) / xs.length) : 0
  return { n: xs.length, ms: avg('ms'), lk: avg('lk'), ac: avg('ac'), wt: avg('wt') }
}

/** 结果一句话：「完成，5 步 · 2.3 秒 · 原生 4 · 视觉 1」。 */
export function runSummary(r: RunResult, name?: string): string {
  const t = r.trace || []
  const n = (k: string) => t.filter(x => x.src === k).length
  const parts = [r.ms != null ? `${(r.ms / 1000).toFixed(1)} 秒` : '', n('native') + n('coord') ? `原生 ${n('native') + n('coord')}` : '', n('cache') ? `缓存 ${n('cache')}` : '', n('ocr') ? `文字识别 ${n('ocr')}` : '', n('vision') ? `视觉 ${n('vision')}` : ''].filter(Boolean)
  const head = name ? `「${name}」` : ''
  if (r.ok) return `${head}完成，${r.done} 步${parts.length ? ' · ' + parts.join(' · ') : ''}${r.saved ? ` · 已把 ${r.saved} 个 AI 找到的位置存回，下次走原生` : ''}`
  return `${head}卡在第 ${(r.failedAt ?? 0) + 1} 步：${r.reason}`
}

export const flowSummary = (f: Flow[]) => f.length
  ? f.map(x => `- id=${x.id} 应用=${x.app} 名称=${x.name}${x.params.length ? ` 参数=${x.params.join('、')}` : ''}${x.desc ? ` 说明=${x.desc}` : ''}（${x.steps.length} 步）`).join('\n')
  : '（还没有保存任何 Flow）'

export const FLOW_TOOLS = [
  { name: 'flow_list', desc: '列出用户保存的 Flow（按应用分组的固定操作流程）。', params: {} },
  { name: 'flow_run', desc: '运行一个 Flow，比运行逐步操作快很多。params 填 Flow 需要的参数。失败会返回卡住的步骤和当时的屏幕，你可以接着手动完成。', params: { id: { type: 'string' }, params: { type: 'object', description: '参数，比如 {"关键词":"露营"}，可省略' } } },
  { name: 'flow_save', desc: '新建或更新一个 Flow。steps 是步骤数组，每步 {kind, sel:{id,text,desc}, x, y, text, app, pkg, key, forward, ms, optional, confirm, note}。kind 可选 launch/tap/input/enter/scroll/swipe/key/wait/sleep/ai/new/method/if/else/endif/while/endwhile/do/dowhile/for/endfor/break/continue/set/call。逻辑节点：if/while/dowhile 带 cond{kind:exists|not_exists|text|var, sel, text, var, op(==|!=|>|<|>=|<=|contains), value}；set{var, value}，value 支持 ${变量}、四则、拼接、point "0.5,0.3"、struct JSON；for{var, from, to, step?} 含端点；call{flowId, args?} 运行另一个已保存的 Flow（子 Flow，当作一步），args 给子 Flow 的 {参数} 传值，如 {"关键词":"{关键词}"}，不能调用自己或形成循环，最多嵌套 5 层；tap 可用 pointVar 指向 point 变量；变量可用 a.b 读写字段（point 的 x/y、struct、对象）。v0.17：ai{goal, act:tap|long|input, text?} 用 AI 视觉找元素（首跑要一次模型往返，找到的选择器自动存回，之后走原生）；类 classes:[{name, fields:{字段:默认值}, methods:[{name, params?, steps 或 flowId}]}]，new{var, cls, args?} 实例化，method{var, method, args?} 调用，方法里用 this.字段。循环嵌套最多 8 层，单循环默认最多 20 次（步上用 max 覆盖）。会变的内容写成 {参数名}。付款、提交订单、发送这类步骤要设 confirm:true。不要为了等页面加载写 wait / sleep：运行器每步会自动等到下一步的目标出现就继续；wait 只用来等一个具体文字出现，sel 不能为空。', params: { id: { type: 'string', description: '更新已有 Flow 时填，可省略' }, app: { type: 'string' }, name: { type: 'string' }, desc: { type: 'string' }, steps: { type: 'array', items: { type: 'object' } }, classes: { type: 'array', items: { type: 'object' }, description: '类定义，可省略' } } },
] as const

export async function runFlowTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'flow_list') return flowSummary(loadFlows())
    if (name === 'flow_run') {
      const fl = loadFlows().find(f => f.id === args.id || f.name === args.id)
      if (!fl) return '出错了：没有这个 Flow，先用 flow_list 看看'
      const r = await runFlow(fl, (args.params as Record<string, string>) || {})
      if (r.ok) return 'Flow ' + runSummary(r, fl.name) + '。'
      return `Flow「${fl.name}」在第 ${(r.failedAt ?? 0) + 1} 步停下：${r.reason}\n已完成 ${r.done}/${r.total} 步。当前屏幕：\n${r.screen || ''}\n请接着手动完成剩下的事；完成后可以用 flow_save 更新这个 Flow（id=${fl.id}），修好卡住的那一步。`
    }
    if (name === 'flow_save') {
      const steps = tidy((args.steps as FlowStep[]) || [], String(args.app || ''))
      if (!steps.length) return '出错了：steps 不能为空'
      const old = loadFlows().find(f => f.id === args.id)
      const fl: Flow = { id: old?.id || uid(), app: String(args.app || old?.app || steps.find(s => s.app)?.app || '应用'), pkg: steps.find(s => s.pkg)?.pkg || old?.pkg,
        name: String(args.name || old?.name || 'Flow'), desc: String(args.desc || old?.desc || ''), steps, params: paramsIn(steps), updated: Date.now(), runs: old?.runs || 0,
        vars: (args.vars as Record<string, VarValue> | undefined) || old?.vars, fast: (args.fast as boolean | undefined) ?? old?.fast,
        classes: (args.classes as Flow['classes']) || old?.classes }
      upsertFlow(fl)
      return `已${old ? '更新' : '保存'} Flow「${fl.app} · ${fl.name}」，${steps.length} 步${fl.params.length ? '，参数：' + fl.params.join('、') : ''}。`
    }
    return '未知工具'
  } catch (e) { return '出错了：' + ((e as Error).message || String(e)) }
}
