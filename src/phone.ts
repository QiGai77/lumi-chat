/** 手机操控：原生 LumiPhone 插件（无障碍 + 自建 ADB + SAF 文件夹）封装，以及给模型的工具定义与执行。 */
import { registerPlugin, Capacitor } from '@capacitor/core'
import type { Step } from './api'
import type { FlowStep } from './flow'

interface LumiPhonePlugin {
  a11yStatus(): Promise<{ enabled: boolean }>
  openA11ySettings(): Promise<void>
  screen(o: { max?: number }): Promise<{ text: string }>
  click(o: { id: number; long?: boolean }): Promise<{ ok: boolean; step?: { sel: FlowStep['sel']; x: number; y: number; pkg?: string } }>
  inputInfo(o: { id: number }): Promise<{ step?: { sel: FlowStep['sel']; x: number; y: number } }>
  appIcon(o: { pkg?: string; name?: string }): Promise<{ pkg: string; label: string; src: string }>
  flowRun(o: { name: string; steps: FlowStep[]; fast?: boolean }): Promise<Record<string, unknown>>
  flowStop(): Promise<void>
  recordStart(o: { pkg?: string; app?: string }): Promise<void>
  recordStatus(): Promise<{ recording: boolean; steps: FlowStep[] }>
  recordStop(): Promise<{ steps: FlowStep[] }>
  tap(o: { x: number; y: number; long?: boolean }): Promise<{ ok: boolean }>
  swipe(o: { x1: number; y1: number; x2: number; y2: number; ms?: number }): Promise<{ ok: boolean }>
  input(o: { id?: number; text: string }): Promise<{ ok: boolean }>
  scroll(o: { id?: number; forward?: boolean }): Promise<{ ok: boolean }>
  global(o: { action: string }): Promise<{ ok: boolean }>
  apps(o: { q?: string }): Promise<{ apps: { label: string; pkg: string }[] }>
  launch(o: { name: string }): Promise<{ ok: boolean; pkg: string }>
  openUrl(o: { url: string }): Promise<void>
  adbStatus(): Promise<{ connected: boolean; pairPort: number; connectPort: number; last: string; sdk: number }>
  openDevSettings(): Promise<void>
  adbPair(o: { port?: number; code?: string }): Promise<void>
  adbConnect(o: { port?: number }): Promise<{ connected: boolean }>
  adbDisconnect(): Promise<void>
  adbShell(o: { cmd: string; timeout?: number }): Promise<{ out: string }>
  pickFolder(): Promise<{ linked: boolean; name?: string }>
  folderStatus(): Promise<{ linked: boolean; name?: string }>
  unlinkFolder(): Promise<void>
  writeText(o: { path: string; text: string }): Promise<{ ok: boolean }>
  readText(o: { path: string }): Promise<{ text: string }>
  list(o: { path?: string }): Promise<{ files: { name: string; dir: boolean; size: number; mtime: number }[] }>
  remove(o: { path: string }): Promise<void>
  addListener(ev: 'adb', cb: (d: { state: string; msg: string }) => void): Promise<{ remove: () => void }>
}

export const Phone = registerPlugin<LumiPhonePlugin>('LumiPhone')
export const isNative = Capacitor.isNativePlatform()

/* ---------- 给模型的工具 */
export const PHONE_TOOLS = [
  { name: 'phone_screen', desc: '读取手机当前屏幕上的文字、按钮和输入框，返回带编号的元素列表。操作前先调用它看清界面。', params: {} },
  { name: 'phone_tap', desc: '点击一个元素。用 phone_screen 返回的编号。', params: { id: { type: 'integer', description: '元素编号' }, long: { type: 'boolean', description: '是否长按' } } },
  { name: 'phone_input', desc: '在输入框里输入文字。id 省略则输入到当前焦点框。', params: { text: { type: 'string' }, id: { type: 'integer', description: '输入框编号，可省略' } } },
  { name: 'phone_scroll', desc: '滚动列表。id 是可滚动元素的编号，forward=true 向下。', params: { id: { type: 'integer' }, forward: { type: 'boolean' } } },
  { name: 'phone_swipe', desc: '在屏幕坐标间滑动，用于翻页或手势。', params: { x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' } } },
  { name: 'phone_key', desc: '系统按键：back 返回、home 主屏、recents 最近任务、notifications 通知栏。', params: { action: { type: 'string', enum: ['back', 'home', 'recents', 'notifications', 'quick_settings'] } } },
  { name: 'phone_open_app', desc: '按应用名打开一个 App，比如「微信」「设置」。', params: { app: { type: 'string' } } },
  { name: 'phone_shell', desc: '通过 ADB 执行一条 shell 命令（需要已连接手机连接）。用于截图信息、文件、am/pm 等。', params: { cmd: { type: 'string' } } },
  { name: 'phone_save', desc: '把内容保存到项目文件夹里的文件，比如 notes.md 或 pages/demo.html。', params: { path: { type: 'string' }, text: { type: 'string' } } },
  { name: 'phone_read', desc: '读取项目文件夹里某个文件的内容。', params: { path: { type: 'string' } } },
  { name: 'phone_files', desc: '列出项目文件夹里的文件，path 省略则列根目录。', params: { path: { type: 'string', description: '子目录，可省略' } } },
] as const

type Name = typeof PHONE_TOOLS[number]['name'] | typeof FLOW_TOOLS[number]['name']
import { FLOW_TOOLS, runFlowTool } from './flow'
const ALL = [...PHONE_TOOLS, ...FLOW_TOOLS]
export const toolSpecs = (names: readonly string[]) => ALL.filter(t => names.includes(t.name)).map(t => ({
  type: 'function', function: { name: t.name, description: t.desc, parameters: { type: 'object', properties: t.params, required: Object.keys(t.params).filter(k => !/可省略|可省/.test((t.params as Record<string, { description?: string }>)[k].description || '')) } },
}))

const LABEL: Record<Name, (a: Record<string, unknown>) => string> = {
  phone_screen: () => '看了看屏幕',
  phone_tap: a => `点击了元素 ${a.id}${a.long ? '（长按）' : ''}`,
  phone_input: a => `输入「${String(a.text).slice(0, 20)}」`,
  phone_scroll: () => '滚动了列表',
  phone_swipe: () => '滑动了屏幕',
  phone_key: a => ({ back: '返回', home: '回到主屏', recents: '打开最近任务', notifications: '拉开通知栏', quick_settings: '打开快捷设置' } as Record<string, string>)[String(a.action)] || '按键',
  phone_open_app: a => `打开 ${a.app}`,
  phone_shell: a => `执行 ${String(a.cmd).slice(0, 40)}`,
  phone_save: a => `保存到 ${a.path}`,
  phone_read: a => `读取 ${a.path}`,
  phone_files: a => `查看文件夹${a.path ? ' ' + a.path : ''}`,
  flow_list: () => '查看 Flow',
  flow_run: a => `运行 Flow ${a.id}`,
  flow_save: a => `保存 Flow「${a.name || ''}」`,
}

/** 这一轮手机操控实际做过的操作（用来「存成 Flow」）。 */
export const trace: FlowStep[] = []
export const takeTrace = () => trace.splice(0)

/** 执行一个工具调用，返回给模型看的文本结果。 */
export async function runTool(name: string, args: Record<string, unknown>, base = ''): Promise<string> {
  const at = (p: unknown) => (base ? base.replace(/\/+$/, '') + '/' : '') + String(p ?? '').replace(/^\/+/, '').replace(/\.\.\//g, '')
  try {
    switch (name as Name) {
      case 'phone_screen': return (await Phone.screen({ max: 160 })).text
      case 'phone_tap': { const r = await Phone.click({ id: Number(args.id), long: !!args.long }); if (r.step) trace.push({ kind: 'tap', ...r.step, ...(args.long ? { long: true } : {}) }); return r.ok ? '已点击' : '点击失败' }
      case 'phone_input': {
        if (args.id != null) { try { const i = await Phone.inputInfo({ id: Number(args.id) }); const sel = { ...(i.step?.sel || {}) }; delete sel.text; trace.push({ kind: 'input', sel, x: i.step?.x, y: i.step?.y, text: String(args.text ?? '') }) } catch { /* */ } }
        else trace.push({ kind: 'input', text: String(args.text ?? '') })
        const r = await Phone.input({ id: args.id != null ? Number(args.id) : undefined, text: String(args.text ?? '') }); return r.ok ? '已输入' : '输入失败，可能没有找到输入框' }
      case 'phone_scroll': { trace.push({ kind: 'scroll', forward: args.forward !== false }); const r = await Phone.scroll({ id: args.id != null ? Number(args.id) : undefined, forward: args.forward !== false }); return r.ok ? '已滚动' : '这里不能滚动' }
      case 'phone_swipe': { const r = await Phone.swipe({ x1: Number(args.x1), y1: Number(args.y1), x2: Number(args.x2), y2: Number(args.y2) }); return r.ok ? '已滑动' : '滑动失败' }
      case 'phone_key': { trace.push({ kind: 'key', key: String(args.action) }); const r = await Phone.global({ action: String(args.action) }); return r.ok ? '已执行' : '不支持这个按键' }
      case 'phone_open_app': { const r = await Phone.launch({ name: String(args.app ?? '') }); if (r.ok) trace.push({ kind: 'launch', app: String(args.app ?? ''), pkg: r.pkg }); return r.ok ? `已打开（${r.pkg}）` : '没打开' }
      case 'phone_shell': { const r = await Phone.adbShell({ cmd: String(args.cmd ?? '') }); return r.out.slice(0, 4000) || '（没有输出）' }
      case 'phone_save': { await Phone.writeText({ path: at(args.path), text: String(args.text ?? '') }); return `已保存到 ${args.path}` }
      case 'phone_read': return (await Phone.readText({ path: at(args.path) })).text.slice(0, 20000)
      case 'phone_files': { const r = await Phone.list({ path: at(args.path || '') || undefined }); return r.files.length ? r.files.map(f => `${f.dir ? '[目录] ' : ''}${f.name}${f.dir ? '' : ` (${f.size} 字节)`}`).join('\n') : '（空文件夹）' }
      case 'flow_list': case 'flow_run': case 'flow_save': return runFlowTool(name, args)
      default: return '未知工具'
    }
  } catch (e) { return '出错了：' + ((e as { message?: string }).message || String(e)) }
}

export const stepLabel = (name: string, args: Record<string, unknown>): string =>
  (LABEL[name as Name]?.(args)) || name

/** 把一步存成 Step（界面显示用）。 */
export const toStep = (name: string, args: Record<string, unknown>, result: string, ok: boolean): Step =>
  ({ name, label: stepLabel(name, args), args, result: result.slice(0, 600), ok })
