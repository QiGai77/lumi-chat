/** Flow：按应用保存的一串手机操作，原生无障碍服务负责录制和运行。
 * 纯逻辑（类型、求值、校验、展开）在 flowcore.ts；这里是存储、原生运行、AI 视觉桥和给模型的工具。 */
import { Phone, isNative } from './phone'
import { loadSettings } from './api'
import { visionLocate, type VisionReq } from './vision'
import { applyLearned, expandCalls, fill, paramsIn, tidy, validateClasses, validateFlow, type Flow, type FlowStep, type Learned, type VarValue } from './flowcore'
export * from './flowcore'

const K = 'lumi.flows'
export const loadFlows = (): Flow[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export const saveFlows = (f: Flow[]) => {
  localStorage.setItem(K, JSON.stringify(f))
  window.dispatchEvent(new Event('lumi-flows'))
  if (isNative) Phone.folderStatus().then(st => { if (st.linked) Phone.writeText({ path: 'Flow/flows.json', text: JSON.stringify(f, null, 1) }).catch(() => {}) }).catch(() => {})
}
export const upsertFlow = (fl: Flow) => { const a = loadFlows(); const i = a.findIndex(x => x.id === fl.id); if (i >= 0) a[i] = fl; else a.unshift(fl); saveFlows(a); return fl }

export interface TraceItem { pc: number; i?: number; fid?: string; label: string; ms: number; src: 'native' | 'cache' | 'vision' | 'coord' | 'logic' | 'skip' | 'fail' }
export interface RunResult {
  ok: boolean; done: number; total: number; failedAt?: number; reason?: string; screen?: string; log?: string[]; ms?: number; stepMs?: number[]
  trace?: TraceItem[]; learned?: Learned[]; visionMs?: number; visionCalls?: number; vars?: Record<string, VarValue>
  /** 写回了几个 AI 学到的选择器；JS 侧每次模型调用的耗时 */
  saved?: number; modelMs?: number[]
}

/** 校验一个 Flow（步骤 + 类），供编辑页和运行前用。 */
export const checkFlow = (fl: Flow, all = loadFlows()) => [...validateFlow(fl.steps, all, fl.vars, { own: fl }), ...validateClasses(fl, all)]

/** 跑一个 Flow：校验 → 标注步骤来源 → 填参数 → 展开 call/类方法 → 原生执行；AI 视觉请求在这里调模型；学到的选择器写回。 */
export async function runFlow(fl: Flow, vals: Record<string, string> = {}): Promise<RunResult> {
  const all = loadFlows()
  const errors = checkFlow(fl, all).filter(p => p.startsWith('错误'))
  if (errors.length) return { ok: false, done: 0, total: fl.steps.length, failedAt: 0, reason: errors.join('；') }
  const own = all.find(x => x.id === fl.id) || fl
  const tagged = fl.steps.map((s, i) => ({ ...s, _i: i, _fid: fl.id }))
  const steps = expandCalls(fill(tagged, vals), all, 0, [], { own })
  const modelMs: number[] = []
  const sub = await Phone.addListener('flowVision', async (d: VisionReq) => {
    try {
      const r = await visionLocate(loadSettings(), d)
      modelMs.push(r.ms)
      await Phone.flowVisionAnswer({ id: d.id, ...r })
    } catch (e) { await Phone.flowVisionAnswer({ id: d.id, error: (e as Error).message || String(e) }).catch(() => {}) }
  }).catch(() => null)
  let r: RunResult
  try { r = await Phone.flowRun({ name: fl.name, steps, fast: fl.fast ?? true, vars: fl.vars || {} }) as unknown as RunResult }
  finally { sub?.remove() }
  r.modelMs = modelMs
  const now = loadFlows()
  r.saved = r.learned?.length ? applyLearned(now, r.learned) : 0
  const i = now.findIndex(x => x.id === fl.id)
  if (i >= 0) now[i] = { ...now[i], runs: now[i].runs + 1, lastOk: r.ok, lastMs: r.ms }
  saveFlows(now)
  return r
}

/** 结果一句话：「完成，5 步 · 2.3 秒 · 原生 4 · 视觉 1」。 */
export function runSummary(r: RunResult, name?: string): string {
  const t = r.trace || []
  const n = (k: string) => t.filter(x => x.src === k).length
  const parts = [r.ms != null ? `${(r.ms / 1000).toFixed(1)} 秒` : '', n('native') + n('coord') ? `原生 ${n('native') + n('coord')}` : '', n('cache') ? `缓存 ${n('cache')}` : '', n('vision') ? `视觉 ${n('vision')}` : ''].filter(Boolean)
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
  { name: 'flow_save', desc: '新建或更新一个 Flow。steps 是步骤数组，每步 {kind, sel:{id,text,desc}, x, y, text, app, pkg, key, forward, ms, optional, confirm, note}。kind 可选 launch/tap/input/enter/scroll/swipe/key/wait/sleep/ai/new/method/if/else/endif/while/endwhile/do/dowhile/for/endfor/break/continue/set/call。逻辑节点：if/while/dowhile 带 cond{kind:exists|not_exists|text|var, sel, text, var, op(==|!=|>|<|>=|<=|contains), value}；set{var, value}，value 支持 ${变量}、四则、拼接、point "0.5,0.3"、struct JSON；for{var, from, to, step?} 含端点；call{flowId} 调子流程；tap 可用 pointVar 指向 point 变量；变量可用 a.b 读写字段（point 的 x/y、struct、对象）。v0.17：ai{goal, act:tap|long|input, text?} 用 AI 视觉找元素（首跑要一次模型往返，找到的选择器自动存回，之后走原生）；类 classes:[{name, fields:{字段:默认值}, methods:[{name, params?, steps 或 flowId}]}]，new{var, cls, args?} 实例化，method{var, method, args?} 调用，方法里用 this.字段。循环嵌套最多 8 层，单循环默认最多 20 次（步上用 max 覆盖）。会变的内容写成 {参数名}。付款、提交订单、发送这类步骤要设 confirm:true。', params: { id: { type: 'string', description: '更新已有 Flow 时填，可省略' }, app: { type: 'string' }, name: { type: 'string' }, desc: { type: 'string' }, steps: { type: 'array', items: { type: 'object' } }, classes: { type: 'array', items: { type: 'object' }, description: '类定义，可省略' } } },
] as const

const uid = () => Math.random().toString(36).slice(2, 10)
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
