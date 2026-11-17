/** Flow：按应用保存的一串手机操作，原生无障碍服务负责录制和运行。 */
import { Phone, isNative } from './phone'

export interface Sel { id?: string; text?: string; desc?: string; cls?: string }
export type StepKind = 'launch' | 'tap' | 'input' | 'enter' | 'scroll' | 'swipe' | 'key' | 'wait' | 'sleep'
export interface FlowStep {
  kind: StepKind; sel?: Sel; x?: number; y?: number; x2?: number; y2?: number
  text?: string; pkg?: string; app?: string; key?: string; forward?: boolean; ms?: number; long?: boolean
  optional?: boolean; confirm?: boolean; note?: string; timeout?: number
}
export interface Flow { id: string; app: string; pkg?: string; name: string; desc: string; params: string[]; steps: FlowStep[]; updated: number; runs: number; lastOk?: boolean }

const K = 'lumi.flows'
export const loadFlows = (): Flow[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export const saveFlows = (f: Flow[]) => {
  localStorage.setItem(K, JSON.stringify(f))
  window.dispatchEvent(new Event('lumi-flows'))
  if (isNative) Phone.folderStatus().then(st => { if (st.linked) Phone.writeText({ path: 'Flow/flows.json', text: JSON.stringify(f, null, 1) }).catch(() => {}) }).catch(() => {})
}
export const upsertFlow = (fl: Flow) => { const a = loadFlows(); const i = a.findIndex(x => x.id === fl.id); if (i >= 0) a[i] = fl; else a.unshift(fl); saveFlows(a); return fl }

export const stepLabel = (s: FlowStep): string => {
  if (s.note) return s.note
  const w = s.sel?.text || s.sel?.desc || ''
  switch (s.kind) {
    case 'launch': return `打开 ${s.app || s.pkg || '应用'}`
    case 'tap': return `${s.long ? '长按' : '点击'}${w ? `「${w}」` : s.x != null ? `（${Math.round(s.x * 100)}%, ${Math.round((s.y || 0) * 100)}%）` : ''}`
    case 'input': return `输入「${s.text || ''}」`
    case 'enter': return '回车 / 搜索'
    case 'scroll': return s.forward === false ? '向上滚动' : '向下滚动'
    case 'swipe': return '滑动'
    case 'key': return ({ back: '返回', home: '回主屏', recents: '最近任务' } as Record<string, string>)[s.key || ''] || '按键'
    case 'wait': return `等待「${w}」出现`
    case 'sleep': return `等 ${(s.ms || 1000) / 1000} 秒`
  }
}

/** {关键词} → 实际值 */
export const fill = (steps: FlowStep[], vals: Record<string, string>): FlowStep[] =>
  steps.map(s => {
    const r = (t?: string) => t?.replace(/\{([^{}]{1,20})\}/g, (m, k) => (k in vals ? vals[k] : m))
    return { ...s, text: r(s.text), note: r(s.note), sel: s.sel ? { ...s.sel, text: r(s.sel.text), desc: r(s.sel.desc) } : undefined }
  })
export const paramsIn = (steps: FlowStep[]) => [...new Set(steps.flatMap(s => [s.text, s.sel?.text, s.sel?.desc].join(' ').match(/\{([^{}]{1,20})\}/g) || []).map(x => x.slice(1, -1)))]

export interface RunResult { ok: boolean; done: number; total: number; failedAt?: number; reason?: string; screen?: string; log?: string[] }
export async function runFlow(fl: Flow, vals: Record<string, string> = {}): Promise<RunResult> {
  const r = await Phone.flowRun({ name: fl.name, steps: fill(fl.steps, vals) }) as unknown as RunResult
  const all = loadFlows(); const i = all.findIndex(x => x.id === fl.id)
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
  { name: 'flow_save', desc: '新建或更新一个 Flow。steps 是步骤数组，每步 {kind, sel:{id,text,desc}, x, y, text, app, pkg, key, forward, ms, optional, confirm, note}。kind 可选 launch/tap/input/enter/scroll/swipe/key/wait/sleep。会变的内容写成 {参数名}。付款、提交订单、发送这类步骤要设 confirm:true。', params: { id: { type: 'string', description: '更新已有 Flow 时填，可省略' }, app: { type: 'string' }, name: { type: 'string' }, desc: { type: 'string' }, steps: { type: 'array', items: { type: 'object' } } } },
] as const

const uid = () => Math.random().toString(36).slice(2, 10)
export async function runFlowTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'flow_list') return flowSummary(loadFlows())
    if (name === 'flow_run') {
      const fl = loadFlows().find(f => f.id === args.id || f.name === args.id)
      if (!fl) return '出错了：没有这个 Flow，先用 flow_list 看看'
      const r = await runFlow(fl, (args.params as Record<string, string>) || {})
      if (r.ok) return `Flow「${fl.name}」完成，共 ${r.done} 步。`
      return `Flow「${fl.name}」在第 ${(r.failedAt ?? 0) + 1} 步停下：${r.reason}\n已完成 ${r.done}/${r.total} 步。当前屏幕：\n${r.screen || ''}\n请接着手动完成剩下的事；完成后可以用 flow_save 更新这个 Flow（id=${fl.id}），修好卡住的那一步。`
    }
    if (name === 'flow_save') {
      const steps = tidy((args.steps as FlowStep[]) || [], String(args.app || ''))
      if (!steps.length) return '出错了：steps 不能为空'
      const old = loadFlows().find(f => f.id === args.id)
      const fl: Flow = { id: old?.id || uid(), app: String(args.app || old?.app || steps.find(s => s.app)?.app || '应用'), pkg: steps.find(s => s.pkg)?.pkg || old?.pkg,
        name: String(args.name || old?.name || 'Flow'), desc: String(args.desc || old?.desc || ''), steps, params: paramsIn(steps), updated: Date.now(), runs: old?.runs || 0 }
      upsertFlow(fl)
      return `已${old ? '更新' : '保存'} Flow「${fl.app} · ${fl.name}」，${steps.length} 步${fl.params.length ? '，参数：' + fl.params.join('、') : ''}。`
    }
    return '未知工具'
  } catch (e) { return '出错了：' + ((e as Error).message || String(e)) }
}
