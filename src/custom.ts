/** v0.20：在对话里定制技能、MCP 和 Flow。
 * 模型调用 skill_* / mcp_* / flow_save / flow_delete 时不直接改数据，而是先生成一张确认卡（ChatCard）：
 * 卡上列出要保存的内容，用户点「保存」才写入（commitCard），保存后可「撤销」（undoCard，恢复 before）。
 * 只依赖纯模块（agents、extras 的类型、flowcore），node 里可以直接单测（scripts/flow-test.mts）。 */
import { AGENTS, loadSkills, saveSkills, type Agent } from './agents.ts'
import type { McpServer, McpTool } from './extras.ts'
import { paramsIn, stepLabel, tidy, validateClasses, validateFlow, type Flow, type FlowStep, type VarValue } from './flowcore.ts'

export type CardKind = 'skill' | 'mcp' | 'flow' | 'run'
export interface ChatCard {
  id: string; kind: CardKind; op: 'create' | 'update' | 'delete' | 'run'
  /** 卡片标题：「新建技能」「更新 Flow」…；name 是对象名，sub 是一行说明 */
  title: string; name: string; sub?: string
  fields: { k: string; v: string }[]
  /** Flow 的步骤（文字），每项 [类别, 文字]；类别 act / ai / logic / var / cls / confirm */
  lines?: [string, string][]
  warn?: string[]
  app?: string; pkg?: string; icon?: string; tone?: string
  status: 'pending' | 'saved' | 'cancelled' | 'undone' | 'running' | 'done' | 'failed'
  before: unknown | null; after: unknown | null
  /** 结果说明（撤销结果、试跑结果、运行结果） */
  note?: string
  /** v0.24：运行里 AI 接管的结果（对比卡） */
  agent?: import('./agentcore.ts').AgentOutcome
}

/* ---------- 存储：Flow 的读写由 flow.ts 注入（它会同步到手机文件夹），默认直接用 localStorage */
interface Store<T> { load: () => T[]; save: (v: T[]) => void }
const ls = <T,>(k: string, ev: string): Store<T> => ({
  load: () => { try { const a = JSON.parse(globalThis.localStorage?.getItem(k) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } },
  save: v => { globalThis.localStorage?.setItem(k, JSON.stringify(v)); globalThis.dispatchEvent?.(new Event(ev)) },
})
export const stores = {
  skills: { load: loadSkills, save: saveSkills } as Store<Agent>,
  mcp: ls<McpServer>('lumi.mcp', 'lumi-mcp'),
  flows: ls<Flow>('lumi.flows', 'lumi-flows'),
}

/* ---------- 给模型的工具 */
const opt = (d: string) => ({ type: 'string', description: d + '，可省略' })
export const CUSTOM_TOOLS = [
  { name: 'skill_list', desc: '列出用户的技能（预设好提示词的助手）：内置的和用户自己定制的。', params: {} },
  { name: 'skill_save', desc: '新建或修改一个自定义技能。会在对话里弹出确认卡，用户点「保存」才生效。prompt 是这个技能的系统提示词，写清角色、做法和输出格式。内置技能不能改。', params: {
    id: opt('修改已有自定义技能时填它的 id'), name: { type: 'string', description: '技能名，20 字以内' }, desc: opt('一句话说明'),
    prompt: { type: 'string', description: '系统提示词' }, hello: opt('打开技能时的开场白'), icon: opt('图标：spark/pen/code/book/list/map/globe/chat/bolt/search/star/doc/leaf/cube/eye/target'),
  } },
  { name: 'skill_delete', desc: '删除一个自定义技能（会弹确认卡）。', params: { id: { type: 'string' } } },
  { name: 'mcp_list', desc: '列出用户连接的 MCP 服务器和它们的工具。', params: {} },
  { name: 'mcp_add', desc: '添加或修改一个 MCP 服务器（Streamable HTTP 地址，比如 https://mcp.example.com/mcp）。会先测试连接、读取工具列表，再弹确认卡，用户点「保存」才生效。', params: {
    url: { type: 'string', description: 'https 地址' }, name: opt('显示名'), token: opt('Bearer 令牌（用户给了才填）'), id: opt('修改已有服务器时填它的 id'),
  } },
  { name: 'mcp_remove', desc: '移除一个 MCP 服务器（会弹确认卡）。', params: { id: { type: 'string' } } },
  { name: 'flow_delete', desc: '删除一个 Flow（会弹确认卡）。', params: { id: { type: 'string' } } },
] as const
export const CUSTOM_NAMES = ['skill_list', 'skill_save', 'skill_delete', 'mcp_list', 'mcp_add', 'mcp_remove', 'flow_list', 'flow_save', 'flow_delete', 'flow_run']
export const MUTATING = new Set(['skill_save', 'skill_delete', 'mcp_add', 'mcp_remove', 'flow_save', 'flow_delete'])

/** 普通对话的系统提示词（v0.20）：模型知道自己能定制技能 / MCP / Flow，以及怎么按任务生成 Flow。 */
export const CUSTOM_PROMPT = `你可以在对话里替用户定制栖语：
- 技能（预设提示词的助手）：skill_list / skill_save / skill_delete
- MCP 服务器（Streamable HTTP）：mcp_list / mcp_add / mcp_remove
- Flow（手机上的任务工作流）：flow_list / flow_save / flow_delete / flow_run
只在用户明确要新建、修改、删除、查看或运行时调用（比如「帮我做个技能…」「加一个 MCP…」「做一个 Flow…」）。保存、删除类工具会在对话里弹出确认卡，用户点「保存」才生效，工具结果会告诉你用户是保存了还是取消了；取消了就不要再提交同样的内容，问用户想怎么改。修改或删除前先用对应的 *_list 拿到 id。保存成功后用一两句话说明做了什么，不要把整段 JSON 再贴一遍。

按任务生成 Flow：用户用一句话描述手机上的一件事（比如「每天帮我在小红书收藏前5篇南京咖啡笔记」）时，为这件事生成一个 Flow，用 flow_save 提交：
1. 第一步 launch 打开应用（app 写应用名；知道包名就写 pkg，比如小红书 com.xingin.xhs、微信 com.tencent.mm、淘宝 com.taobao.taobao、美团 com.sankuai.meituan、抖音 com.ss.android.ugc.aweme、支付宝 com.eg.android.AlipayGphone、大众点评 com.dianping.v1、京东 com.jingdong.app.mall、哔哩哔哩 tv.danmaku.bili）。
2. 只在确定时写原生选择器 sel（用户已有 Flow 里出现过的，或刚才 phone_screen 看到的）。不确定的界面一律用 AI 视觉步：{"kind":"ai","goal":"顶部的搜索框","act":"tap"}，输入用 {"kind":"ai","goal":"搜索输入框","act":"input","text":"{关键词}"}；goal 写清位置和外观。ai 步运行时先试缓存的选择器，没有才截图交给模型找，找到后选择器自动存回 Flow，下次走原生。
3. 会变的内容写成 {参数}（比如 {关键词}、{数量}）。重复的事用 for：{"kind":"for","var":"i","from":1,"to":"{数量}"} … {"kind":"endfor"}；循环里每次目标不同可以写「第 \${i} 篇笔记」，但这种步每次都要走 AI 视觉、不会缓存，能用固定目标（比如「列表里第一篇笔记」+ 返回 + 滚动）就用固定目标。
4. 用 if + exists / not_exists 处理弹窗、广告、未登录（比如出现「跳过」就点掉，或给 tap 加 optional:true）。不要为了等页面加载写 wait 或 sleep：运行器每步都会自动等到下一步的目标出现就继续；wait 只用来等一个具体的文字出现，sel 必须写这个文字，不能为空。
5. 付款、下单、提交、发送、发布、删除这类步骤加 confirm:true。
6. Flow 本身不带时间。用户说「每天 / 每周」时，保存后告诉用户可以在「定时任务」里加一条，提示词写：运行 Flow「名称」。
7. 速度要说实话：原生步和已缓存的步通常几百毫秒一步（页面加载时间另算）；选择器失效时先用手机上的文字识别找字，再不行才让 AI 视觉找，视觉每次要一次模型往返（约 2–3 秒）。建议用户保存后先在卡片上点「试跑」一次，让 AI 把位置学会存回。
9. 需要看内容做判断的部分（挑一个、比较、筛选：最便宜的、评分最高的、最合适的一款、最新一条未读）用 AI 接管步，不要用一串猜出来的点击：{"kind":"agent","goal":"在搜索结果里比较至少 5 款{关键词}，按 {预算} 和口碑挑最合适的一款，停在商品详情页","criteria":"{预算}"}。固定导航（打开应用 → 点搜索 → 输入 → 回车）仍然用确定性步骤放在前面，跑得快；agent 步后面还可以接普通步骤。AI 接管每轮看屏幕、问一次模型，准确优先、比较慢；会在付款、提交订单、发送、删除前自己停下，结果是一张对比卡（继续去下单 / 换一个 / 结束）。可选字段 maxSteps（默认 25）、maxMinutes（默认 5）、model（默认 argon）。
8. 用户已有的 Flow 能完成其中一段时（先用 flow_list 看），直接把它当一步调用：{"kind":"call","flowId":"已有 Flow 的 id","args":{"关键词":"{关键词}"}}，args 给子 Flow 的 {参数} 传值。不能调用自己、不能形成循环，最多嵌套 5 层。`

/* ---------- 工具执行：只读的直接返回文字；改动类返回确认卡 */
export interface ToolCtx { probe?: (s: McpServer) => Promise<McpTool[]>; uid?: () => string; now?: () => number }
export interface Proposal { text?: string; card?: ChatCard }
const defUid = () => Math.random().toString(36).slice(2, 10)
const ICONS = ['spark', 'pen', 'code', 'book', 'list', 'map', 'globe', 'chat', 'bolt', 'search', 'star', 'doc', 'leaf', 'cube', 'eye', 'target']
const TONES: Agent['tone'][] = ['coral', 'sage', 'gold', 'plum']
const str = (v: unknown) => (v == null ? '' : String(v)).trim()
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s
const err = (s: string): Proposal => ({ text: '出错了：' + s })

export const skillSummary = (a: Agent[]) => a.map(x => `- id=${x.id} 名称=${x.name}${x.custom ? '（自定义）' : '（内置，不能改删）'} 说明=${x.desc}`).join('\n')
export const mcpSummary = (s: McpServer[]) => s.length
  ? s.map(x => `- id=${x.id} 名称=${x.name} 地址=${x.url} 状态=${x.status === 'ok' ? '已连接' : x.status === 'error' ? '连接失败' : '未测试'}${x.tools.length ? ` 工具=${x.tools.map(t => t.name).join('、')}` : ''}`).join('\n')
  : '（还没有 MCP 服务器）'

/** 校验 MCP 地址：必须是 http(s) 的完整 URL；http 只允许本机 / 局域网（否则给警告）。返回规范化后的地址或错误。 */
export function checkMcpUrl(u: string): { url?: string; error?: string; warn?: string } {
  const raw = u.trim()
  if (!raw) return { error: 'url 不能为空' }
  let x: URL
  try { x = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw) } catch { return { error: `「${raw}」不是有效的地址` } }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return { error: `只支持 http(s) 地址，收到的是 ${x.protocol}` }
  if (!x.hostname.includes('.') && x.hostname !== 'localhost') return { error: `「${x.hostname}」不像是一个域名` }
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.hostname)
  return { url: x.toString().replace(/\/$/, x.pathname === '/' ? '' : '/'), warn: x.protocol === 'http:' && !local ? '这是 http 地址，令牌会明文传输' : undefined }
}

/** 一步属于哪类（确认卡上的小标签）。 */
export const stepCat = (s: FlowStep) => s.confirm ? 'confirm' : s.kind === 'agent' ? 'agent' : s.kind === 'ai' || s.vision ? 'ai'
  : ['if', 'else', 'endif', 'while', 'endwhile', 'do', 'dowhile', 'for', 'endfor', 'break', 'continue', 'call'].includes(s.kind) ? 'logic'
    : s.kind === 'set' ? 'var' : ['new', 'method'].includes(s.kind) ? 'cls' : 'act'

/** Flow 的速度说明（确认卡、文档同一口径）：v0.23 原生 / 缓存通常几百毫秒一步（页面加载另算）；AI 视觉没缓存时是一次模型往返。 */
export function flowSpeed(steps: FlowStep[]) {
  const ai = steps.filter(s => (s.kind === 'ai' || s.vision) && !s.sel).length
  const cached = steps.filter(s => (s.kind === 'ai' || s.vision) && s.sel).length
  const act = steps.filter(s => stepCat(s) === 'act' || s.confirm).length
  const dyn = steps.filter(s => (s.kind === 'ai' || s.vision) && !s.sel && /\$\{|(?<!\$)\{[^{}]+\}/.test([s.goal, s.text].join(' '))).length
  const agent = steps.filter(s => s.kind === 'agent').length
  const parts = [`原生 ${act + cached} 步`, ai ? `AI 视觉 ${ai} 步` : '', agent ? `AI 接管 ${agent} 步` : '']
  const note = ai ? `原生和已缓存的步通常几百毫秒一步（页面加载另算）；AI 视觉步没缓存时先试手机上的文字识别，再不行要一次模型往返（几秒），找到的位置自动存回，之后走原生。${dyn ? `其中 ${dyn} 步的目标带参数或变量，不会缓存，每次都走 AI 视觉。` : ''}可以先点「试跑」让它学会。` : '全部是原生步，通常几百毫秒一步（不含打开应用和页面加载）。'
  const agentNote = agent ? '到了 AI 接管步，AI 每轮看一次屏幕、问一次模型（几秒到十几秒一轮），准确优先，结束后给出对比卡；付款、提交订单、发送、删除前一定停下。' : ''
  return { ai, cached, text: parts.filter(Boolean).join(' · '), note: agentNote ? (agent === steps.length ? agentNote : note + agentNote) : note }
}

export async function proposeTool(name: string, args: Record<string, unknown>, ctx: ToolCtx = {}): Promise<Proposal> {
  const uid = ctx.uid || defUid, now = ctx.now || Date.now
  const id = uid()
  try {
    switch (name) {
      case 'skill_list': return { text: skillSummary([...stores.skills.load(), ...AGENTS.map(a => ({ ...a, custom: false }))]) }
      case 'skill_save': {
        const all = stores.skills.load()
        const want = str(args.id)
        if (want && AGENTS.some(a => a.id === want)) return err(`「${AGENTS.find(a => a.id === want)!.name}」是内置技能，不能修改；可以不填 id 另存为一个新技能`)
        const old = want ? all.find(a => a.id === want) : all.find(a => a.name === str(args.name))
        if (want && !old) return err(`没有 id=${want} 的自定义技能，先用 skill_list 看看`)
        const name0 = clip(str(args.name) || old?.name || '', 20), prompt = str(args.prompt) || old?.prompt || ''
        if (!name0) return err('name 不能为空')
        if (prompt.length < 8) return err('prompt 太短，写清这个技能的角色、做法和输出格式')
        const icon = ICONS.includes(str(args.icon)) ? str(args.icon) : old?.icon || 'spark'
        let h = 0; for (const c of name0) h = (h * 31 + c.charCodeAt(0)) % 997
        const after: Agent = { id: old?.id || 'sk-' + id, name: name0, desc: clip(str(args.desc) || old?.desc || prompt.replace(/\s+/g, ' '), 40), icon, tone: old?.tone || TONES[h % 4],
          prompt, hello: str(args.hello) || old?.hello || `我是「${name0}」，说说你要做什么。`, custom: true, updated: now() }
        return { card: { id, kind: 'skill', op: old ? 'update' : 'create', title: old ? '修改技能' : '新建技能', name: after.name, sub: after.desc, icon: after.icon, tone: after.tone,
          fields: [{ k: '开场白', v: after.hello }, { k: '提示词', v: clip(after.prompt, 600) }], status: 'pending', before: old || null, after } }
      }
      case 'skill_delete': {
        const want = str(args.id)
        if (AGENTS.some(a => a.id === want)) return err('内置技能不能删除')
        const old = stores.skills.load().find(a => a.id === want || a.name === want)
        if (!old) return err(`没有 id=${want} 的自定义技能，先用 skill_list 看看`)
        return { card: { id, kind: 'skill', op: 'delete', title: '删除技能', name: old.name, sub: old.desc, icon: old.icon, tone: old.tone, fields: [], status: 'pending', before: old, after: null } }
      }
      case 'mcp_list': return { text: mcpSummary(stores.mcp.load()) }
      case 'mcp_add': {
        const chk = checkMcpUrl(str(args.url))
        if (chk.error) return err(chk.error)
        const all = stores.mcp.load()
        const want = str(args.id)
        const old = want ? all.find(s => s.id === want) : all.find(s => s.url === chk.url)
        if (want && !old) return err(`没有 id=${want} 的 MCP 服务器，先用 mcp_list 看看`)
        const host = new URL(chk.url!).hostname
        const site = /^\d+\.\d+\.\d+\.\d+$|^localhost$/.test(host) ? host : host.replace(/^(mcp|api|server|gateway)\d*\./, '')
        const after: McpServer = { id: old?.id || 'mcp-' + id, name: clip(str(args.name) || old?.name || site, 30), url: chk.url!, site: old?.site || site,
          token: args.token != null ? str(args.token) : old?.token || '', enabled: true, tools: old?.tools || [], status: 'unknown' }
        const warn = chk.warn ? [chk.warn] : []
        let test = '没有测试'
        if (ctx.probe) {
          try {
            const tools = await Promise.race([ctx.probe(after), new Promise<never>((_, no) => setTimeout(() => no(new Error('8 秒没有响应')), 8000))])
            after.tools = tools; after.status = 'ok'; after.error = undefined
            test = `连接成功，${tools.length} 个工具${tools.length ? '：' + clip(tools.map(t => t.name).join('、'), 80) : ''}`
          } catch (e) {
            after.status = 'error'; after.error = (e as Error).message || String(e)
            test = '连接失败：' + after.error
            warn.push('连接测试没通过（可能是地址、令牌或跨域限制），仍然可以保存，之后在 MCP 页「连接并读取工具」重试')
          }
        }
        return { card: { id, kind: 'mcp', op: old ? 'update' : 'create', title: old ? '修改 MCP 服务器' : '添加 MCP 服务器', name: after.name, sub: after.url,
          fields: [{ k: '地址', v: after.url }, { k: '令牌', v: after.token ? '已填写（不显示）' : '无' }, { k: '连接测试', v: test }], warn, status: 'pending', before: old || null, after } }
      }
      case 'mcp_remove': {
        const want = str(args.id)
        const old = stores.mcp.load().find(s => s.id === want || s.name === want || s.url === want)
        if (!old) return err(`没有 id=${want} 的 MCP 服务器，先用 mcp_list 看看`)
        return { card: { id, kind: 'mcp', op: 'delete', title: '移除 MCP 服务器', name: old.name, sub: old.url, fields: [], status: 'pending', before: old, after: null } }
      }
      case 'flow_save': {
        const all = stores.flows.load()
        const want = str(args.id)
        const old = want ? all.find(f => f.id === want) : undefined
        if (want && !old) return err(`没有 id=${want} 的 Flow，先用 flow_list 看看；新建时不要填 id`)
        const steps = tidy((Array.isArray(args.steps) ? args.steps : old?.steps || []) as FlowStep[], str(args.app) || old?.app)
        if (!steps.length) return err('steps 不能为空')
        const bad = steps.findIndex(s => !s || typeof s !== 'object' || typeof s.kind !== 'string')
        if (bad >= 0) return err(`第 ${bad + 1} 步缺少 kind`)
        const launch = steps.find(s => s.kind === 'launch')
        const app = str(args.app) || old?.app || launch?.app || '应用'
        const fl: Flow = { id: old?.id || id, app, pkg: steps.find(s => s.pkg)?.pkg || old?.pkg, name: clip(str(args.name) || old?.name || 'Flow', 24),
          desc: str(args.desc) || old?.desc || '', steps, params: paramsIn(steps), updated: now(), runs: old?.runs || 0, lastOk: old?.lastOk, lastMs: old?.lastMs,
          vars: (args.vars as Record<string, VarValue> | undefined) || old?.vars, fast: (args.fast as boolean | undefined) ?? old?.fast ?? true,
          classes: (args.classes as Flow['classes']) || old?.classes }
        const others = all.filter(f => f.id !== fl.id)
        const probs = [...validateFlow(fl.steps, [...others, fl], fl.vars, { own: fl }), ...validateClasses(fl, [...others, fl])]
        const errors = probs.filter(p => p.startsWith('错误'))
        if (errors.length) return err('这个 Flow 校验没通过，改好再提交：' + errors.join('；'))
        const sp = flowSpeed(steps)
        const lines: [string, string][] = steps.map(s => [stepCat(s), stepLabel(s)])
        const fields = [{ k: '步骤', v: `${steps.length} 步 · ${sp.text}` }, ...(fl.params.length ? [{ k: '参数', v: fl.params.join('、') }] : []),
          ...(steps.some(s => s.confirm) ? [{ k: '需要确认', v: steps.filter(s => s.confirm).map(stepLabel).join('；') }] : []), { k: '速度', v: sp.note }]
        return { card: { id, kind: 'flow', op: old ? 'update' : 'create', title: old ? '更新 Flow' : '新建 Flow', name: fl.name, sub: fl.desc || fl.app, app: fl.app, pkg: fl.pkg,
          fields, lines, warn: probs.filter(p => !p.startsWith('错误')), status: 'pending', before: old || null, after: fl } }
      }
      case 'flow_delete': {
        const want = str(args.id)
        const old = stores.flows.load().find(f => f.id === want || f.name === want)
        if (!old) return err(`没有 id=${want} 的 Flow，先用 flow_list 看看`)
        return { card: { id, kind: 'flow', op: 'delete', title: '删除 Flow', name: old.name, sub: old.app, app: old.app, pkg: old.pkg, fields: [{ k: '步骤', v: `${old.steps.length} 步` }], status: 'pending', before: old, after: null } }
      }
    }
    return err('未知工具 ' + name)
  } catch (e) { return err((e as Error).message || String(e)) }
}

const storeOf = (k: CardKind) => (k === 'skill' ? stores.skills : k === 'mcp' ? stores.mcp : stores.flows) as unknown as Store<{ id: string }>
const what = (c: ChatCard) => `${c.kind === 'skill' ? '技能' : c.kind === 'mcp' ? 'MCP 服务器' : 'Flow'}「${c.name}」`

/** 用户点了「保存」：写入，返回给模型的结果文字。 */
export function commitCard(c: ChatCard): string {
  const st = storeOf(c.kind), all = st.load()
  const after = c.after as { id: string } | null, before = c.before as { id: string } | null
  if (c.op === 'delete' && before) { st.save(all.filter(x => x.id !== before.id)); return `用户确认了，已删除${what(c)}。` }
  if (!after) return '出错了：卡片没有内容'
  const i = all.findIndex(x => x.id === after.id)
  if (i >= 0) all[i] = after; else all.unshift(after)
  st.save(all)
  const extra = c.kind === 'flow' ? `（id=${after.id}）` : c.kind === 'skill' ? `（id=${after.id}，在「技能」页可以打开）` : c.kind === 'mcp' ? `（id=${after.id}）` : ''
  return `用户确认了，已${c.op === 'update' ? '更新' : '保存'}${what(c)}${extra}。`
}

/** 撤销：恢复保存前的样子（新建的就删掉，删除的就放回去）。 */
export function undoCard(c: ChatCard): string {
  const st = storeOf(c.kind), all = st.load()
  const after = c.after as { id: string } | null, before = c.before as { id: string } | null
  const key = (after || before)!.id
  const rest = all.filter(x => x.id !== key)
  if (before) { const i = all.findIndex(x => x.id === key); if (i >= 0) rest.splice(i, 0, before); else rest.unshift(before) }
  st.save(rest)
  return before ? (c.op === 'delete' ? `已恢复${what(c)}` : `已恢复成修改前的${what(c)}`) : `已撤销，${what(c)}已移除`
}

/* ---------- 等用户点「保存 / 取消」：确认卡的回调只活在本次会话里，重开 App 后旧的待确认卡显示「已失效」 */
const waits = new Map<string, (ok: boolean) => void>()
export const isWaiting = (id: string) => waits.has(id)
export function waitDecision(id: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise(res => {
    const done = (ok: boolean) => { waits.delete(id); signal?.removeEventListener('abort', off); res(ok) }
    const off = () => done(false)
    waits.set(id, done)
    if (signal?.aborted) done(false); else signal?.addEventListener('abort', off)
  })
}
export const decide = (id: string, ok: boolean) => waits.get(id)?.(ok)
