import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass } from './glass'
import { GlassIcon, Icon } from './icons'
import { MODEL_NAME, MODELS, PLANS, PLATFORM_URL, feedbackPage, fetchUsage, generateImage, generateVideo, keyPage, loadSettings, purchasePage, saveSettings, streamChat, type GatewayUsage, type Media, type Msg, type Settings, type Tier } from './api'
import { Markdown } from './md/Markdown'
import { GENUI_PROMPT } from './genui'
import { blobUrl, putBlob } from './media'
import { addUsage, loadConvs, loadUsage, saveConvs, uid, when, type Conv } from './store'
import { allAgents, agentById, type Agent } from './agents'
import { CUSTOM_NAMES, CUSTOM_PROMPT, MUTATING, commitCard, decide, isWaiting, proposeTool, undoCard, waitDecision, type ChatCard } from './custom'
import { RpView } from './rp'
import { Phone, isNative, isPhoneTool, runTool, takeTrace, toolSpecs, toStep } from './phone'
import { FAMILIES, meshBg, meshVars, tint, useAppLook } from './appicon'
import { bentoLayout, bentoOrder, type BentoCell, type BentoSize } from './bento'
import { flowSummary, loadFlows, runFlow, runSummary, stepLabel, tidy, upsertFlow, type Flow, type RunResult } from './flow'
import { AppIcon, FlowEdit, RunPanel, useFlows } from './flowui'
import type { ApiMsg, Step } from './api'
import { blankChar, charById, greetings, macros, runRegex, importFile, importLink, loadChars, rpSystem, saveChars, type Character } from './chara'
import { isDue, loadMcp, loadProjects, loadTasks, probeMcp, saveMcp, saveProjects, saveTasks, type McpServer, type Project, type Task } from './extras'

type View = 'home' | 'phone' | 'flows' | `flowapp:${string}` | 'chars' | `char:${string}` | 'skills' | 'mcp' | 'tasks' | 'projects' | `project:${string}` | 'me' | 'fav' | 'wallet' | 'settings'
type Gen = 'chat' | 'image' | 'video'
const GEN_LABEL: Record<Gen, string> = { chat: '对话', image: '生成图片', video: '生成视频' }
const QUICK: [string, string][] = [
  ['润色文字', '帮我把这段文字改得更简洁专业：\n'], ['解释代码', '解释下面这段代码在做什么：\n'], ['旅行计划', '帮我做一个两日游计划，目的地：'],
  ['读论文', '帮我精读这篇论文，按问题、方法、结论拆解：\n'], ['写周报', '把下面的记录整理成周报：\n'],
]
const greeting = () => { const h = new Date().getHours(); return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好' }
const USER_NAME = 'Qi'
const USER_FULL = 'Qi Gai'

interface Pending { text: string; gen: Gen }
/** 外部链接：安卓里交给系统浏览器，网页版新窗口。官网 platform.qigai.tech 的获取密钥 / 升级会员 / 反馈都走这里。 */
const openLink = (url: string) => { if (isNative) Phone.openUrl({ url }).catch(() => window.open(url, '_blank', 'noopener')); else window.open(url, '_blank', 'noopener') }

export default function App() {
  const [view, setView] = useState<View>('home')
  const wide = () => window.innerWidth >= 980
  // v0.18：折叠态就是侧栏的「关闭」态。关上后左侧永远留一条图标栏（新对话 / 技能 / MCP + 展开按钮），没有完全隐藏的抽屉，也没有另外的迷你开关。
  // 展开：桌面推开内容显示完整侧栏；手机是盖在内容上的抽屉（带遮罩），关上回到图标栏。状态存 localStorage 'lumi.sideMini'（'1' = 折叠）。
  const [side, setSideS] = useState(() => { const v = localStorage.getItem('lumi.sideMini'); return v == null ? wide() : v === '0' })
  const setSide = (o: boolean) => { localStorage.setItem('lumi.sideMini', o ? '0' : '1'); setSideS(o) }
  const toggleSide = () => setSide(!side)
  const shut = () => { if (!wide()) setSide(false) }
  const [convs, setConvs] = useState<Conv[]>(loadConvs)
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [servers, setServers] = useState<McpServer[]>(loadMcp)
  const [tasks, setTasks] = useState<Task[]>(loadTasks)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [tier, setTier] = useState<Tier>(() => asTier(localStorage.getItem('lumi.tier')))
  const [think, setThink] = useState(() => localStorage.getItem('lumi.think') === '1')
  const [sheet, setSheet] = useState(false)
  const [gu, setGu] = useState<GatewayUsage | null>(null)
  useEffect(() => saveConvs(convs), [convs])
  useEffect(() => saveProjects(projects), [projects])
  useEffect(() => saveMcp(servers), [servers])
  useEffect(() => saveTasks(tasks), [tasks])
  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => localStorage.setItem('lumi.tier', tier), [tier])
  useEffect(() => localStorage.setItem('lumi.think', think ? '1' : '0'), [think])
  useEffect(() => {
    const c = new AbortController()
    fetchUsage(settings, c.signal).then(setGu).catch(() => setGu(null))
    return () => c.abort()
  }, [settings.baseUrl, settings.apiKey])

  const open = convs.find(c => c.id === openId) || null
  const [chars, setCharsS] = useState<Character[]>(loadChars)
  const setChars = (fn: (c: Character[]) => Character[]) => setCharsS(cs => { const n = fn(cs); saveChars(n); return n })
  const editing = view.startsWith('char:') ? chars.find(c => c.id === view.slice(5)) : undefined
  // 绑定了手机文件夹的项目：对话变化后存成 Markdown（防抖 1.5 秒，内容没变不重写）
  const syncT = useRef(new Map<string, number>()), synced = useRef(new Map<string, string>())
  useEffect(() => {
    if (!isNative) return
    for (const c of convs) {
      const p = c.project ? projects.find(x => x.id === c.project) : undefined
      if (!p?.folder || !c.messages.length) continue
      const md = `# ${c.title}\n\n` + c.messages.map(m => `## ${m.role === 'user' ? '我' : MODEL_NAME[asTier(m.tier || c.tier)]}\n\n${m.content}`).join('\n\n')
      if (synced.current.get(c.id) === md) continue
      window.clearTimeout(syncT.current.get(c.id))
      syncT.current.set(c.id, window.setTimeout(() => {
        synced.current.set(c.id, md)
        Phone.writeText({ path: `${p.folder}/对话/${c.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}-${c.id.slice(0, 6)}.md`, text: md }).catch(() => {})
        Phone.writeText({ path: `${p.folder}/.lumi/${c.id}.json`, text: JSON.stringify(c) }).catch(() => {})
      }, 1500))
    }
    for (const p of projects) if (p.folder && synced.current.get('p' + p.id) !== p.instructions + p.name) {
      synced.current.set('p' + p.id, p.instructions + p.name)
      Phone.writeText({ path: `${p.folder}/.lumi/project.json`, text: JSON.stringify(p) }).catch(() => {})
      Phone.writeText({ path: `${p.folder}/项目说明.md`, text: `# ${p.name}\n\n${p.instructions || '（还没有写说明）'}\n` }).catch(() => {})
    }
  }, [convs, projects])
  const go = (v: View) => { setView(v); setOpenId(null); shut() }
  const openConv = (id: string) => { setOpenId(id); shut() }
  const newChat = (first?: Pending, extra?: { agent?: Agent; project?: string; char?: Character }) => {
    const ch = extra?.char, g = ch ? greetings(ch, settings.rpUser || '用户')[0] : ''
    const c: Conv = { id: uid(), title: ch ? ch.name : extra?.agent ? extra.agent.name : '新对话', tier, updated: Date.now(), messages: g ? [{ role: 'assistant', content: g, tier }] : [], agent: extra?.agent?.id, project: extra?.project, char: ch?.id }
    setConvs(cs => [c, ...cs]); setPending(first && first.text.trim() ? first : null); setOpenId(c.id); shut()
  }
  const update = (id: string, fn: (c: Conv) => Conv) => setConvs(cs => cs.map(c => (c.id === id ? fn(c) : c)))
  const del = (id: string) => { setConvs(cs => cs.filter(c => c.id !== id)); if (openId === id) setOpenId(null) }
  // v0.20：对话里的确认卡改了 MCP 列表（custom.ts 写 localStorage + 'lumi-mcp' 事件）就重新读；'lumi-go' 跳页面，'lumi-ask' 带一句话新开对话（按任务生成 Flow 等）
  useEffect(() => {
    const mcp = () => setServers(loadMcp())
    const goE = (e: Event) => go((e as CustomEvent).detail as View)
    const ask = (e: Event) => { setView('home'); newChat({ text: (e as CustomEvent).detail as string, gen: 'chat' }) }
    window.addEventListener('lumi-mcp', mcp); window.addEventListener('lumi-go', goE); window.addEventListener('lumi-ask', ask)
    return () => { window.removeEventListener('lumi-mcp', mcp); window.removeEventListener('lumi-go', goE); window.removeEventListener('lumi-ask', ask) }
  })

  // 定时任务：App 打开期间每 30 秒检查一次，到点就在后台新建对话并跑完
  const running = useRef(new Set<string>())
  const runTask = async (t: Task) => {
    if (running.current.has(t.id)) return
    running.current.add(t.id)
    const cid = uid()
    const user: Msg = { role: 'user', content: t.prompt }
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, lastRun: Date.now(), lastConv: cid } : x))
    setConvs(cs => [{ id: cid, title: t.name, tier, updated: Date.now(), messages: [user, { role: 'assistant', content: '', tier }], task: t.id }, ...cs])
    const set = (m: Partial<Msg>) => setConvs(cs => cs.map(c => c.id === cid ? { ...c, updated: Date.now(), messages: [user, { ...c.messages[1], ...m, role: 'assistant' }] } : c))
    // v0.20：提示词是「运行 Flow「名称」」时直接在手机上跑这个 Flow（按任务生成的 Flow 配合定时任务实现「每天」）
    const fm = t.prompt.trim().match(/^运行\s*Flow\s*[「“"]([^」”"]+)[」”"]/)
    const fl = fm ? loadFlows().find(f => f.name === fm[1] || f.id === fm[1]) : undefined
    if (fm) {
      try {
        if (!fl) set({ content: `没有找到名为「${fm[1]}」的 Flow` })
        else if (!isNative) set({ content: `Flow「${fl.name}」只能在安卓 App 里运行` })
        else set({ content: runSummary(await runFlow(fl), fl.name) })
      } catch (e) { set({ content: '定时任务运行失败：' + (e as Error).message }) }
      running.current.delete(t.id); return
    }
    try {
      const r = await streamChat({ settings, tier, think: false, messages: [user], signal: new AbortController().signal, system: settings.genUI ? GENUI_PROMPT : undefined, onDelta: (t2, rs) => set({ content: t2, reasoning: rs }) })
      set({ ms: r.firstTokenMs }); addUsage(0, r.promptTokens + r.completionTokens)
    } catch (e) { set({ content: '定时任务运行失败：' + (e as Error).message }) }
    running.current.delete(t.id)
  }
  const tasksRef = useRef(tasks); tasksRef.current = tasks
  useEffect(() => {
    const tick = () => tasksRef.current.filter(isDue).forEach(runTask)
    tick(); const h = setInterval(tick, 30000); return () => clearInterval(h)
  }, [settings.baseUrl, settings.apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [wall, setWall] = useState<string | null>(null)
  const [wallVer, setWallVer] = useState(() => Number(localStorage.getItem('lumi.wallVer') || 0))
  useEffect(() => { if (settings.theme === 'wallpaper') blobUrl('wallpaper:' + wallVer).then(u => setWall(u)); else setWall(null) }, [settings.theme, wallVer])
  const plan = gu?.planName || null
  const back = (to: View, title: string) => <div className="sub-head"><button className="nav-back press" onClick={() => go(to)} aria-label="返回"><Icon n="back" s={20} w={2.2} /></button><span className="sub-title">{title}</span></div>
  const head = (title: string, sub: string, right?: React.ReactNode) => <div className="page-h"><div className="grow"><h1 className="serif">{title}</h1><p>{sub}</p></div>{right}</div>
  const flowEd = view.startsWith('flow:') ? view.slice(5) : null
  const flowApp = view.startsWith('flowapp:') ? view.slice(8) : null
  const proj = view.startsWith('project:') ? projects.find(p => 'project:' + p.id === view) : null

  return (
    <div className={`app theme-${settings.theme} ${side ? 'side-open' : 'side-mini'}`} style={wall ? { ['--wall' as string]: `url(${wall})` } : undefined}>
      <div className="app-bg"><div className="halftone" /></div>
      <Sidebar view={view} go={go} convs={convs} openId={openId} onOpen={openConv} onNew={() => { go('home') }} onDelete={del}
        plan={plan} mini={!side} onToggleMini={toggleSide} onUpgrade={() => openLink(purchasePage(settings))} />
      <div className="side-scrim" onClick={() => setSide(false)} />
      <main className="main">
        <div className={`page ${open ? 'pushed' : ''}`}>
          <div className="scroll">
            <div className={`wrap ${view === 'home' ? 'wide' : ''}`}>
              {view === 'home' && <><div className="home-top" />
                <Home convs={convs} tier={tier} think={think} setThink={setThink} onMode={() => setSheet(true)}
                  onSend={p => newChat(p)} onOpen={openConv} onDelete={del} /></>}
              {view === 'flows' && <>{head('Flow', '把常用的手机操作存成一键工作流')}<FlowsPage go={go} /></>}
              {flowApp && <>{back('flows', 'Flow')}<FlowApp app={flowApp} go={go} /></>}
              {flowEd && (() => { const fa = loadFlows().find(x => x.id === flowEd)?.app; const to = (fa ? `flowapp:${fa}` : 'flows') as View; return <>{back(to, '编辑 Flow')}<FlowEdit id={flowEd} settings={settings} done={() => go(to)} /></> })()}
              {view === 'phone' && <>{head('手机连接', '无障碍、无线调试 ADB 和手机存储')}<PhonePage /></>}
              {view === 'chars' && <>{head('角色', '和角色卡里的人物沉浸式聊天，支持导入酒馆角色卡')}<CharsPage chars={chars} settings={settings}
                add={c => setChars(cs => [c, ...cs])} onChat={c => newChat(undefined, { char: c })} onEdit={c => go(`char:${c.id}`)} convs={convs} onOpen={openConv} /></>}
              {view.startsWith('char:') && <>{back('chars', editing?.name || '新角色')}<CharEdit key={view} c={editing || { ...blankChar(), id: view.slice(5) }}
                save={c => setChars(cs => cs.some(x => x.id === c.id) ? cs.map(x => x.id === c.id ? c : x) : [c, ...cs])}
                remove={() => { setChars(cs => cs.filter(x => x.id !== view.slice(5))); go('chars') }} onChat={c => newChat(undefined, { char: c })} /></>}
              {view === 'skills' && <>{head('技能', '预设好角色和方法，点开就能用')}<Agents onPick={a => newChat(undefined, { agent: a })} /></>}
              {view === 'mcp' && <>{head('MCP', '连接你的 MCP 服务器（Streamable HTTP）')}<AskBar kind="mcp" /><McpPage servers={servers} setServers={setServers} /></>}
              {view === 'tasks' && <>{head('定时任务', '到点自动提问，结果存成一段新对话')}<TasksPage tasks={tasks} setTasks={setTasks} onRun={runTask} onOpen={openConv} /></>}
              {view === 'projects' && <>{head('项目', '把相关对话放在一起，共用一套说明')}<ProjectsPage projects={projects} setProjects={setProjects} convs={convs} onOpen={p => go(`project:${p}`)} onImport={(ps, cs) => { setProjects(a => [...a.filter(x => !ps.some(y => y.id === x.id)), ...ps]); setConvs(a => [...cs.filter(c => !a.some(x => x.id === c.id)), ...a].sort((x, y) => y.updated - x.updated)) }} /></>}
              {proj && <>{back('projects', proj.name)}<ProjectPage p={proj} convs={convs.filter(c => c.project === proj.id)}
                save={np => setProjects(ps => ps.map(x => x.id === np.id ? np : x))} remove={() => { setProjects(ps => ps.filter(x => x.id !== proj.id)); go('projects') }}
                onNew={() => newChat(undefined, { project: proj.id })} onOpen={openConv} /></>}
              {view === 'me' && <>{head('我的', '账号、会员与设置')}<MePage plan={plan} gu={gu} settings={settings} favCount={convs.reduce((a, c) => a + c.messages.filter(m => m.fav).length, 0)} go={go} /></>}
              {view === 'fav' && <>{back('me', '收藏')}<Favs convs={convs} onOpen={openConv} onUnfav={(cid, i) => update(cid, c => ({ ...c, messages: c.messages.map((m, j) => j === i ? { ...m, fav: false } : m) }))} /></>}
              {view === 'wallet' && <>{back('me', '升级会员')}<Wallet settings={settings} gu={gu} onSettings={() => go('settings')} /></>}
              {view === 'settings' && <>{back('me', '设置')}<SettingsPage s={settings} set={setSettings} plan={plan} onWall={v => { localStorage.setItem('lumi.wallVer', String(v)); setWallVer(v) }} /></>}
              <div className="bottom-pad" />
            </div>
          </div>
        </div>
        {open && <Chat key={open.id} conv={open} settings={settings} tier={tier} think={think} pending={pending} clearPending={() => setPending(null)}
          project={projects.find(p => p.id === open.project)} onNew={() => go('home')} onMode={() => setSheet(true)} update={fn => update(open.id, fn)} />}
      </main>
      <Preview />
      <ModeSheet show={sheet} onClose={() => setSheet(false)} tier={tier} setTier={setTier} think={think} setThink={setThink}
        plan={plan} gu={gu} onPlans={() => { setSheet(false); go('wallet') }} onUpgrade={() => { setSheet(false); openLink(purchasePage(settings)) }} />
    </div>
  )
}

/* ---------------- sidebar (ChatGPT 式) */
function Sidebar({ view, go, convs, openId, onOpen, onNew, onDelete, plan, mini, onToggleMini, onUpgrade }: {
  view: View; go: (v: View) => void; convs: Conv[]; openId: string | null; onOpen: (id: string) => void; onNew: () => void
  onDelete: (id: string) => void; plan: string | null; mini: boolean; onToggleMini: () => void; onUpgrade: () => void
}) {
  const [q, setQ] = useState('')
  const list = convs.filter(c => !q || c.title.includes(q) || c.messages.some(m => m.content.includes(q)))
  const item = (v: View, icon: string, label: string, tone: string) => (
    <button className={`s-item ${view === v || (v === 'projects' && view.startsWith('project:')) || (v === 'flows' && view.startsWith('flow')) ? 'on' : ''}`} onClick={() => go(v)} title={label}><GlassIcon n={icon} tone={tone} s={30} />{label}</button>)
  if (mini) {
    return (
      <aside className="side rail">
        <div className="s-head">
          <button className="side-btn" onClick={onToggleMini} aria-label="展开侧栏" title="展开侧栏"><Icon n="sidebar" s={22} w={1.9} /></button>
        </div>
        <button className={`s-item new ${view === 'home' && !openId ? 'on' : ''}`} onClick={onNew} title="新对话" aria-label="新对话"><GlassIcon n="compose" tone="coral" s={30} /><span className="rail-l">新对话</span></button>
        <button className={`s-item ${view === 'skills' ? 'on' : ''}`} onClick={() => go('skills')} title="技能" aria-label="技能"><GlassIcon n="spark" tone="plum" s={30} /><span className="rail-l">技能</span></button>
        <button className={`s-item ${view === 'mcp' ? 'on' : ''}`} onClick={() => go('mcp')} title="MCP" aria-label="MCP"><GlassIcon n="plug" tone="sky" s={30} /><span className="rail-l">MCP</span></button>
      </aside>
    )
  }
  return (
    <aside className="side">
      <div className="s-head">
        <button className="side-btn" onClick={onToggleMini} aria-label="折叠侧栏" title="折叠成图标栏"><Icon n="sidebar" s={22} w={1.9} /></button>
        <div className="s-search"><Icon n="search" s={15} w={2} /><input placeholder="搜索" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <button className={`s-item new ${view === 'home' && !openId ? 'on' : ''}`} onClick={onNew}><GlassIcon n="compose" tone="coral" s={30} />新对话</button>
      {item('chars', 'mask', '角色', 'rose')}
      {item('phone', 'phone', '手机连接', 'sky')}
      {item('flows', 'bolt', 'Flow', 'gold')}
      {item('skills', 'spark', '技能', 'plum')}
      {item('mcp', 'plug', 'MCP', 'sky')}
      {item('tasks', 'clock', '定时任务', 'gold')}
      {item('projects', 'folder', '项目', 'sage')}
      <div className="s-sec">最近</div>
      <div className="s-list">
        {list.length === 0 && <div className="t13 s-empty">{q ? '没有找到' : '还没有对话'}</div>}
        {list.map(c => (
          <div key={c.id} className={`s-conv ${c.id === openId ? 'on' : ''}`} onClick={() => onOpen(c.id)}>
            <span className="ell grow">{c.title}</span>
            <button className="s-del" aria-label="删除" onClick={e => { e.stopPropagation(); if (confirm(`删除「${c.title}」？`)) onDelete(c.id) }}><Icon n="trash" s={15} /></button>
          </div>))}
      </div>
      <button className={`s-me ${view === 'me' || view === 'wallet' || view === 'settings' || view === 'fav' ? 'on' : ''}`} onClick={() => go('me')}>
        <span className="avatar sm"><Icon n="user" s={20} w={1.8} c="#fff" /></span>
        <div className="grow"><div className="b">{USER_FULL}</div><div className="t12">{plan || 'Free'}</div></div>
        {!plan && <span className="up-tag" role="link" onClick={e => { e.stopPropagation(); onUpgrade() }}>升级</span>}
      </button>
    </aside>
  )
}

/* ---------------- 我的 */
function MePage({ plan, gu, settings, favCount, go }: { plan: string | null; gu: GatewayUsage | null; settings: Settings; favCount: number; go: (v: View) => void }) {
  const ext = <span className="ext-ic"><Icon n="up" s={12} w={2.4} /></span>
  const u = usageOf(gu)
  const ok = !!(settings.baseUrl && settings.apiKey)
  return (
    <section className="fade">
      <div className="me-card">
        <span className="avatar lg"><Icon n="user" s={34} w={1.6} c="#fff" /></span>
        <div className="grow"><div className="me-n serif">{USER_FULL}</div><div className="t13">{ok ? '已连接网关' : '还没连接网关'}</div></div>
      </div>
      <div className="acct big" style={{ marginTop: 14 }}>
        <div className="grow">
          <div className="t12">当前套餐</div><div className="acct-n serif">{plan || 'Free'}</div>
          {u.limit > 0 && <div className="meter"><div style={{ width: `${u.pct}%` }} /></div>}
          <div className="t12">{u.limit > 0 ? `${u.win}已用 ${u.pct.toFixed(0)}%` : '升级后可用 Helium · Neon · Argon'}{u.exp ? ` · ${u.exp.getMonth() + 1}月${u.exp.getDate()}日到期` : ''}</div>
        </div>
        <button className="acct-btn" onClick={() => openLink(purchasePage(settings))}>{plan ? '续费' : '升级'}</button>
      </div>
      <div className="list" style={{ marginTop: 18 }}>
        <button className="row press-row" onClick={() => openLink(purchasePage(settings))}><GlassIcon n="crown" tone="gold" s={32} /><span className="t16 grow">升级会员</span><span className="t13">{plan ? plan : 'Pro / Max / Ultra'}</span>{ext}</button>
        <button className="row press-row" onClick={() => go('wallet')}><GlassIcon n="wallet" tone="sage" s={32} /><span className="t16 grow">用量与套餐</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
        <button className="row press-row" onClick={() => go('fav')}><GlassIcon n="star" tone="coral" s={32} /><span className="t16 grow">收藏</span><span className="t13">{favCount || ''}</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
        <button className="row press-row" onClick={() => go('settings')}><GlassIcon n="gear" tone="slate" s={32} /><span className="t16 grow">设置</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
      </div>
      <div className="list" style={{ marginTop: 14 }}>
        <button className="row press-row" onClick={() => openLink(keyPage(settings))}><GlassIcon n="key" tone="sky" s={32} /><span className="t16 grow">获取 API Key</span>{ext}</button>
        <button className="row press-row" onClick={() => openLink(feedbackPage())}><GlassIcon n="chat" tone="plum" s={32} /><span className="t16 grow">提交反馈</span>{ext}</button>
      </div>
    </section>
  )
}

/* ---------------- MCP */
function McpPage({ servers, setServers }: { servers: McpServer[]; setServers: (f: (s: McpServer[]) => McpServer[]) => void }) {
  const [form, setForm] = useState<{ name: string; url: string; token: string; site: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const patch = (id: string, p: Partial<McpServer>) => setServers(ss => ss.map(s => s.id === id ? { ...s, ...p } : s))
  const test = async (s: McpServer) => {
    setBusy(s.id)
    try { patch(s.id, { tools: await probeMcp(s), status: 'ok', error: undefined }) }
    catch (e) { patch(s.id, { status: 'error', error: (e as Error).message === 'Failed to fetch' ? '连不上（地址错误或服务器不允许跨域）' : (e as Error).message }) }
    setBusy(null)
  }
  return (
    <section className="fade">
      {servers.length === 0 && !form && <div className="empty-card"><GlassIcon n="plug" tone="sky" s={56} /><div>还没有 MCP 服务器</div><span className="t13">添加后可以读取它提供的工具</span></div>}
      <div className="stack">{servers.map(s => (
        <div key={s.id} className="card-row">
          <div className="cr-h">
            <Favicon site={s.site || siteOf(s.url)} name={s.name} status={s.status} />
            <div className="grow"><div className="t16 b ell">{s.name}</div>
              <a className="t12 ell site-link" href={'https://' + (s.site || siteOf(s.url))} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{s.site || siteOf(s.url)}</a></div>
            <Toggle on={s.enabled} set={b => patch(s.id, { enabled: b })} />
          </div>
          {s.status === 'error' && <div className="err sm">{s.error}</div>}
          {s.tools.length > 0 && <div className="tools">{s.tools.map(t => <span key={t.name} className="tool" title={t.description}>{t.name}</span>)}</div>}
          <div className="cr-acts">
            <button className="pill-btn" onClick={() => test(s)} disabled={busy === s.id}>{busy === s.id ? '连接中…' : s.status === 'ok' ? `重新读取 · ${s.tools.length} 个工具` : '连接并读取工具'}</button>
            <button className="pill-btn ghost" onClick={() => { if (confirm(`删除「${s.name}」？`)) setServers(ss => ss.filter(x => x.id !== s.id)) }}>删除</button>
          </div>
        </div>))}
      </div>
      {form ? (
        <div className="card-row form">
          <input className="inp" placeholder="名称，如 GitHub" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="inp" placeholder="https://…/mcp" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
          <input className="inp" placeholder={'官网（可选，默认 ' + (form.url ? siteOf(form.url) : '从地址推断') + '）'} value={form.site} onChange={e => setForm({ ...form, site: e.target.value })} />
          <input className="inp" placeholder="Bearer Token（可选）" type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />
          <div className="cr-acts">
            <button className="pill-btn solid" onClick={() => { if (!form.url.trim()) return; const s: McpServer = { id: uid(), name: form.name.trim() || siteOf(form.url), url: form.url.trim(), token: form.token, site: form.site.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined, enabled: true, tools: [], status: 'unknown' }; setServers(ss => [...ss, s]); setForm(null); test(s) }}>添加</button>
            <button className="pill-btn ghost" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      ) : <button className="add-btn press" onClick={() => setForm({ name: '', url: '', token: '', site: '' })}><Icon n="plus" s={18} w={2.2} />添加服务器</button>}
      <div className="t12 foot">目前可连接并读取工具列表；在对话中调用工具将在下一版接入</div>
    </section>
  )
}

/** 把网络 / 网关错误翻成人话。 */
function friendly(e: unknown) {
  const m = (e as Error)?.message || String(e)
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return navigator.onLine === false ? '网络断开了，连上网再试一次。' : '连不上服务器，检查一下网络，稍后再试。'
  if (/请求失败 401/.test(m)) return '访问密钥无效，到「设置」里检查一下 API Key。'
  if (/请求失败 429/.test(m)) return '请求太频繁了，稍等一分钟再试。'
  if (/请求失败 5\d\d/.test(m)) return '服务器暂时出了点问题，稍后再试。'
  return m
}

/** 从 MCP 地址推断官网：去掉 mcp. / api. 之类的前缀。 */
function siteOf(u: string) {
  try { const h = new URL(u.includes('://') ? u : 'https://' + u).hostname; return /^\d+\.\d+\.\d+\.\d+$|^localhost$/.test(h) ? h : h.replace(/^(mcp|api|server|gateway)\d*\./, '') } catch { return u }
}
function Favicon({ site, status }: { site: string; name?: string; status: McpServer['status'] }) {
  return <FaviconImpl site={site} status={status} />
}
function FaviconImpl({ site, status }: { site: string; status: McpServer['status'] }) {
  const srcs = [`https://${site}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${site}.ico`, `https://www.google.com/s2/favicons?domain=${site}&sz=128`]
  const [i, setI] = useState(0)
  return (
    <span className="fav">
      {i < srcs.length ? <img src={srcs[i]} alt="" onError={() => setI(i + 1)} onLoad={e => { if ((e.target as HTMLImageElement).naturalWidth < 2) setI(i + 1) }} />
        : <GlassIcon n="plug" tone="sky" s={34} />}
      <span className={`st-dot ${status}`} />
    </span>
  )
}

/* ---------------- 定时任务 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
function TasksPage({ tasks, setTasks, onRun, onOpen }: { tasks: Task[]; setTasks: (f: (t: Task[]) => Task[]) => void; onRun: (t: Task) => void; onOpen: (id: string) => void }) {
  const blank: Task = { id: '', name: '', prompt: '', time: '08:00', days: [], enabled: true }
  const [form, setForm] = useState<Task | null>(null)
  const patch = (id: string, p: Partial<Task>) => setTasks(ts => ts.map(t => t.id === id ? { ...t, ...p } : t))
  const dayText = (d: number[]) => d.length === 0 || d.length === 7 ? '每天' : d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x)) ? '工作日' : '每周' + [...d].sort().map(x => WEEK[x]).join('')
  return (
    <section className="fade">
      {tasks.length === 0 && !form && <div className="empty-card"><GlassIcon n="clock" tone="gold" s={56} /><div>还没有定时任务</div><span className="t13">比如每天 8:00 给你一份新闻摘要</span></div>}
      <div className="stack">{tasks.map(t => (
        <div key={t.id} className="card-row">
          <div className="cr-h">
            <div className="task-time serif">{t.time}</div>
            <div className="grow"><div className="t16 b ell">{t.name}</div><div className="t12 ell">{dayText(t.days)} · {t.prompt}</div></div>
            <Toggle on={t.enabled} set={b => patch(t.id, { enabled: b })} />
          </div>
          <div className="cr-acts">
            <button className="pill-btn" onClick={() => onRun(t)}><Icon n="play" s={13} w={2.2} />立即运行</button>
            {t.lastConv && <button className="pill-btn ghost" onClick={() => onOpen(t.lastConv!)}>上次结果 · {when(t.lastRun || 0)}</button>}
            <button className="pill-btn ghost" onClick={() => setForm(t)}>编辑</button>
          </div>
        </div>))}
      </div>
      {form ? (
        <div className="card-row form">
          <input className="inp" placeholder="名称，如 早间新闻" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <textarea className="inp" rows={3} placeholder="到点要问的话" value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
          <div className="task-when">
            <input className="inp time" type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            <div className="days">{WEEK.map((w, i) => <button key={i} className={form.days.includes(i) ? 'on' : ''} onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter(x => x !== i) : [...form.days, i] })}>{w}</button>)}</div>
          </div>
          <div className="t12">不选星期即每天。App 打开时到点执行，关闭期间错过的会在下次打开 6 小时内补跑。</div>
          <div className="cr-acts">
            <button className="pill-btn solid" onClick={() => {
              if (!form.prompt.trim()) return
              const t = { ...form, name: form.name.trim() || form.prompt.slice(0, 12), lastRun: form.id ? form.lastRun : Date.now() }
              setTasks(ts => form.id ? ts.map(x => x.id === form.id ? t : x) : [...ts, { ...t, id: uid() }]); setForm(null)
            }}>保存</button>
            {form.id && <button className="pill-btn ghost" onClick={() => { setTasks(ts => ts.filter(x => x.id !== form.id)); setForm(null) }}>删除</button>}
            <button className="pill-btn ghost" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      ) : <button className="add-btn press" onClick={() => setForm(blank)}><Icon n="plus" s={18} w={2.2} />新建定时任务</button>}
    </section>
  )
}

/* ---------------- 项目 */
const PTONES: Project['tone'][] = ['coral', 'sage', 'gold', 'plum']
function ProjectsPage({ projects, setProjects, convs, onOpen, onImport }: { projects: Project[]; setProjects: (f: (p: Project[]) => Project[]) => void; convs: Conv[]; onOpen: (id: string) => void; onImport: (p: Project[], c: Conv[]) => void }) {
  const [name, setName] = useState<string | null>(null)
  const [imp, setImp] = useState('')
  const importAll = async () => {
    setImp('正在读取…')
    try {
      let st = await Phone.folderStatus(); if (!st.linked) st = await Phone.pickFolder()
      const dirs = (await Phone.list({ path: '项目' })).files.filter(f => f.dir)
      const ps: Project[] = [], cs: Conv[] = []
      for (const d of dirs) {
        try {
          const p = JSON.parse((await Phone.readText({ path: `项目/${d.name}/.lumi/project.json` })).text) as Project
          ps.push({ ...p, folder: `项目/${d.name}` })
          for (const f of (await Phone.list({ path: `项目/${d.name}/.lumi` })).files) if (f.name.endsWith('.json') && f.name !== 'project.json')
            try { cs.push({ ...JSON.parse((await Phone.readText({ path: `项目/${d.name}/.lumi/${f.name}` })).text), project: p.id }) } catch { /* */ }
        } catch { /* 不是 Lumi 的项目文件夹 */ }
      }
      onImport(ps, cs); setImp(ps.length ? `导入了 ${ps.length} 个项目、${cs.length} 段对话` : '这个文件夹的「项目」里没有找到栖语的项目')
    } catch (e) { setImp((e as Error).message) }
  }
  return (
    <section className="fade">
      {projects.length === 0 && name === null && <div className="empty-card"><GlassIcon n="folder" tone="sage" s={56} /><div>还没有项目</div><span className="t13">比如「毕业论文」「求职」，对话会共用项目说明</span></div>}
      <div className="agents">{projects.map(p => (
        <button key={p.id} className={`agent ${p.tone} press-row`} onClick={() => onOpen(p.id)}>
          <span className="ag-i"><Icon n="folder" s={21} w={1.9} /></span>
          <div className="grow"><div className="ag-n">{p.name}</div><div className="t13 ell">{convs.filter(c => c.project === p.id).length} 个对话{p.instructions ? ' · ' + p.instructions : ''}</div></div>
          <Icon n="right" s={16} w={2} c="var(--label3)" />
        </button>))}
      </div>
      {isNative && <button className="btn-ghost" style={{ margin: '4px 0 12px' }} onClick={importAll}><Icon n="download" s={16} w={2} />从手机存储导入项目</button>}
      {imp && <div className="imp-msg ok" style={{ marginBottom: 12 }}>{imp}</div>}
      {name !== null ? (
        <div className="card-row form" style={{ marginTop: 12 }}>
          <input className="inp" autoFocus placeholder="项目名称" value={name} onChange={e => setName(e.target.value)} />
          <div className="cr-acts">
            <button className="pill-btn solid" onClick={() => { if (!name.trim()) return; const p: Project = { id: uid(), name: name.trim(), instructions: '', tone: PTONES[projects.length % 4], created: Date.now() }; setProjects(ps => [...ps, p]); setName(null); onOpen(p.id) }}>创建</button>
            <button className="pill-btn ghost" onClick={() => setName(null)}>取消</button>
          </div>
        </div>
      ) : <button className="add-btn press" onClick={() => setName('')}><Icon n="plus" s={18} w={2.2} />新建项目</button>}
    </section>
  )
}

function ProjectPage({ p, convs, save, remove, onNew, onOpen }: { p: Project; convs: Conv[]; save: (p: Project) => void; remove: () => void; onNew: () => void; onOpen: (id: string) => void }) {
  return (
    <section className="fade">
      <div className="sec">项目说明 · 这个项目里的每段对话都会带上</div>
      <textarea className="inp big" rows={4} placeholder="比如：我在写关于城市更新的硕士论文，回答用学术口吻，引用给出处。" value={p.instructions} onChange={e => save({ ...p, instructions: e.target.value })} />
      <button className="add-btn solid press" onClick={onNew}><Icon n="compose" s={18} w={2} />在项目里新建对话</button>
      {isNative && <ProjectStore p={p} save={save} />}
      <div className="sec">对话 · {convs.length}</div>
      {convs.length === 0 ? <div className="empty">还没有对话</div> : (
        <div className="list">{convs.map(c => (
          <div key={c.id} className="row press-row" onClick={() => onOpen(c.id)}>
            <El t={asTier(c.tier)} s={30} />
            <div className="grow"><div className="t16 ell">{c.title}</div><div className="t13 ell">{snippet(c) || '还没有消息'}</div></div>
            <span className="t12">{when(c.updated)}</span>
          </div>))}
        </div>)}
      <button className="adv-toggle danger" onClick={() => { if (confirm(`删除项目「${p.name}」？对话会保留。`)) remove() }}>删除项目</button>
    </section>
  )
}

/* ---------------- composer card (home) */
function GenMenu({ show, gen, setGen, onClose, onMode, phone, phoneOn, onTask }: { show: boolean; gen: Gen; setGen: (g: Gen) => void; onClose: () => void; onMode: () => void; phone?: () => void; phoneOn?: boolean; onTask?: () => void }) {
  return <>
    {show && <div className="gen-scrim" onClick={onClose} />}
    <div className={`gen-menu ${show ? 'show' : ''}`}>
      {(['chat', 'image', 'video'] as Gen[]).map(g => (
        <button key={g} className={gen === g ? 'on' : ''} onClick={() => { setGen(g); onClose() }}>
          <span className="gi"><Icon n={g === 'chat' ? 'chat' : g === 'image' ? 'image' : 'film'} s={18} w={2} /></span>{GEN_LABEL[g]}
          {gen === g && <Icon n="check" s={16} w={2.4} />}
        </button>))}
      {onTask && <button onClick={() => { onClose(); setGen('chat'); onTask() }}><span className="gi"><Icon n="eye" s={18} w={2} /></span>按任务生成 Flow</button>}
      {phone && <button onClick={() => { onClose(); phone() }}><span className="gi"><Icon n="phone" s={18} w={2} /></span>手机操控{phoneOn && <Icon n="check" s={16} w={2.4} />}</button>}
      <button onClick={() => { onClose(); onMode() }}><span className="gi"><Icon n="spark" s={18} w={2} /></span>选择模式</button>
    </div>
  </>
}

function Home({ convs, tier, think, setThink, onMode, onSend, onOpen, onDelete }: {
  convs: Conv[]; tier: Tier; think: boolean; setThink: (b: boolean) => void; onMode: () => void
  onSend: (p: Pending) => void; onOpen: (id: string) => void; onDelete: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [gen, setGen] = useState<Gen>('chat')
  const [menu, setMenu] = useState(false)
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const go = () => { if (!text.trim()) return; onSend({ text, gen }); setText(''); setGen('chat') }
  const fill = (s: string) => { setText(s); requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(s.length, s.length) } }) }
  const list = convs.filter(c => !q || c.title.includes(q) || c.messages.some(m => m.content.includes(q)))

  if (all) return (
    <section className="all fade">
      <div className="sec-h"><button className="link-back" onClick={() => { setAll(false); setQ('') }}><Icon n="back" s={18} w={2.2} />全部对话</button><span className="t13">{convs.length} 个</span></div>
      <div className="searchbox"><Icon n="search" s={17} w={2} /><input placeholder="搜索对话" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
      {list.length === 0 ? <div className="empty">没有找到</div> : (
        <div className="list">{list.map(c => (
          <div key={c.id} className="row press-row" onClick={() => onOpen(c.id)}>
            <El t={asTier(c.tier)} s={32} />
            <div className="grow"><div className="t16 ell">{c.title}</div><div className="t13 ell">{snippet(c) || '还没有消息'}</div></div>
            <span className="t12">{when(c.updated)}</span>
            <button className="del" aria-label="删除" onClick={e => { e.stopPropagation(); if (confirm('删除这个对话？')) onDelete(c.id) }}><Icon n="trash" s={17} /></button>
          </div>))}
        </div>)}
    </section>
  )

  return (
    <>
      <section className="hello">
        <h1 className="serif">{greeting()}，{USER_NAME}</h1>
        <p>今天想聊点什么？</p>
      </section>
      <div className="compose-card">
        {gen !== 'chat' && <button className="gen-chip" onClick={() => setGen('chat')}><Icon n={gen === 'image' ? 'image' : 'film'} s={14} w={2.2} />{GEN_LABEL[gen]}<Icon n="x" s={12} w={2.4} /></button>}
        <textarea ref={ta} rows={2} value={text} placeholder={gen === 'chat' ? '问点什么…' : gen === 'image' ? '描述想要的图片…' : '描述想要的视频…'}
          onCompositionStart={() => (composing.current = true)} onCompositionEnd={() => (composing.current = false)}
          onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(Math.max(e.target.scrollHeight, 56), 200) + 'px' }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !composing.current && window.innerWidth > 700) { e.preventDefault(); go() } }} />
        <div className="cc-row">
          <button className={`cc-plus ${menu ? 'open' : ''}`} onClick={() => setMenu(v => !v)} aria-label="更多"><Icon n="plus" s={20} w={2} /></button>
          <button className="chip" onClick={onMode}><El t={tier} s={20} />{MODEL_NAME[tier]}<Icon n="down" s={13} w={2.4} /></button>
          <button className={`chip chip-think ${think ? 'on' : ''}`} onClick={() => setThink(!think)} aria-label="深度思考" title="深度思考"><Icon n="spark" s={14} w={2.2} /><span className="chip-tx">深度思考</span></button>
          <button className={`send big ${text.trim() ? 'on' : ''}`} onClick={go} aria-label="发送"><Icon n="up" s={20} c="#fff" w={2.4} /></button>
        </div>
        <div className="home-menu"><GenMenu show={menu} gen={gen} setGen={setGen} onClose={() => setMenu(false)} onMode={onMode} onTask={() => fill('按任务生成 Flow：')} /></div>
      </div>
      <div className="quick">{QUICK.map(([l, p]) => <button key={l} className="q-chip press" onClick={() => fill(p)}>{l}</button>)}</div>

      <div className="sec-h"><h2 className="serif">最近对话</h2>{convs.length > 0 && <button className="t13 more" onClick={() => setAll(true)}>全部 {convs.length}<Icon n="right" s={13} w={2.2} /></button>}</div>
      {convs.length === 0
        ? <div className="empty-folder"><Folder tone="coral" title="第一段对话" meta="从上面的输入框开始" sheets={['今天想聊点什么？', '// 栖语 Lumi', 'Helium · Neon · Argon']} /></div>
        : <div className="folders">{convs.slice(0, 6).map((c, i) => (
            <Folder key={c.id} tone={TONES[i % 3]} title={c.title} meta={`${c.agent ? agentById(c.agent)?.name || MODEL_NAME[asTier(c.tier)] : MODEL_NAME[asTier(c.tier)]} · ${c.messages.length} 条`}
              time={when(c.updated)} sheets={sheetsOf(c)} onClick={() => onOpen(c.id)} onLong={() => { if (confirm(`删除「${c.title}」？`)) onDelete(c.id) }} />))}
          </div>}
    </>
  )
}

const TONES = ['coral', 'sage', 'gold'] as const
const clean = (s: string) => s.replace(/```lumi-ui[\s\S]*?(```|$)/g, '').replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, '')).replace(/[#*>`$\\]/g, '').replace(/\n{2,}/g, '\n').trim()
const snippet = (c: Conv) => clean(c.messages[c.messages.length - 1]?.content || '').slice(0, 60)
function sheetsOf(c: Conv): string[] {
  const ms = c.messages.filter(m => m.content)
  const u = ms.find(m => m.role === 'user')?.content || c.title
  const a = [...ms].reverse().find(m => m.role === 'assistant')?.content || ''
  const code = a.match(/```\w*\n([\s\S]*?)```/)?.[1] || ''
  return [clean(u).slice(0, 40), (code || clean(a)).slice(0, 48) || '…', clean(a).split('\n').slice(-2).join('\n').slice(0, 40) || MODEL_NAME[asTier(c.tier)]]
}

function Folder({ tone, title, meta, time, sheets, onClick, onLong }: {
  tone: string; title: string; meta: string; time?: string; sheets: string[]; onClick?: () => void; onLong?: () => void
}) {
  const t = useRef<number | null>(null)
  const fired = useRef(false)
  const start = () => { fired.current = false; t.current = window.setTimeout(() => { fired.current = true; onLong?.() }, 560) }
  const stop = () => { if (t.current) clearTimeout(t.current); t.current = null }
  return (
    <div className={`folder ${tone}`} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={e => { e.preventDefault(); onLong?.() }} onClick={() => { if (!fired.current) onClick?.() }}>
      <div className="f-back" />
      <div className="f-sheets">
        <div className="f-sheet s1">{sheets[0]}</div>
        <div className="f-sheet s2 mono">{sheets[1]}</div>
        <div className="f-sheet s3">{sheets[2]}</div>
      </div>
      <div className="f-front">
        <div className="f-ghost" aria-hidden><div className="f-sheets">
          <div className="f-sheet s1">{sheets[0]}</div>
          <div className="f-sheet s2 mono">{sheets[1]}</div>
          <div className="f-sheet s3">{sheets[2]}</div>
        </div></div>
        <div className="f-title serif ell">{title}</div>
        <div className="f-meta"><span>{meta}</span><span>{time}</span></div>
      </div>
    </div>
  )
}

/* ---------------- 收藏 */
function Favs({ convs, onOpen, onUnfav }: { convs: Conv[]; onOpen: (id: string) => void; onUnfav: (cid: string, i: number) => void }) {
  const items = convs.flatMap(c => c.messages.map((m, i) => ({ c, m, i })).filter(x => x.m.fav))
  return (
    <section className="fade">
      {items.length === 0 ? <div className="empty-card"><Icon n="star" s={28} w={1.6} /><div>还没有收藏</div><span className="t13">在对话里点回答下方的星标</span></div> : (
        <div className="favs">{items.map(({ c, m, i }) => (
          <div key={c.id + i} className="fav press-row" onClick={() => onOpen(c.id)}>
            <div className="fav-h"><El t={asTier(m.tier || c.tier)} s={22} /><span className="t13 ell grow">{c.title}</span>
              <button className="fav-x" aria-label="取消收藏" onClick={e => { e.stopPropagation(); onUnfav(c.id, i) }}><Icon n="starf" s={17} /></button></div>
            <div className="fav-b serif">{clean(m.content).slice(0, 160)}</div>
            <div className="t12">{when(c.updated)}</div>
          </div>))}
        </div>)}
    </section>
  )
}

/* ---------------- 智能体 */
function ProjectStore({ p, save }: { p: Project; save: (p: Project) => void }) {
  const [files, setFiles] = useState<{ name: string; dir: boolean; size: number }[]>([])
  const [sub, setSub] = useState('')
  const [msg, setMsg] = useState('')
  const load = async (d = sub) => { if (!p.folder) return; try { setFiles((await Phone.list({ path: p.folder + (d ? '/' + d : '') })).files.filter(f => !f.name.startsWith('.')).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))) } catch (e) { setMsg((e as Error).message) } }
  useEffect(() => { load() }, [p.folder, sub]) // eslint-disable-line react-hooks/exhaustive-deps
  const link = async () => {
    try { let st = await Phone.folderStatus(); if (!st.linked) st = await Phone.pickFolder(); if (st.linked) save({ ...p, folder: `项目/${p.name.replace(/[\\/:*?"<>|]/g, '_')}` }) } catch (e) { setMsg((e as Error).message) }
  }
  const open = async (f: { name: string; dir: boolean }) => {
    if (f.dir) { setSub(sub ? sub + '/' + f.name : f.name); return }
    if (/\.html?$/i.test(f.name)) { const t = (await Phone.readText({ path: `${p.folder}/${sub ? sub + '/' : ''}${f.name}` })).text; window.dispatchEvent(new CustomEvent('lumi-preview', { detail: { html: t } })) }
  }
  return <>
    <div className="sec">手机存储{p.folder ? ` · ${p.folder}` : ''}</div>
    {!p.folder ? <div className="dev-card"><div className="t13">把这个项目存到手机：每段对话自动存成 Markdown，模型写的网页和文件也放在这里，换手机或重装后可以导入回来。</div>
      <div className="dev-acts"><button className="btn-ink" onClick={link}>存到手机</button></div></div>
      : <div className="list">
        {sub && <button className="row press-row" onClick={() => setSub(sub.split('/').slice(0, -1).join('/'))}><span className="ico"><Icon n="back" s={16} w={2} /></span><span className="grow t16">返回上一级</span></button>}
        {files.length === 0 && <div className="row"><span className="grow t13">还没有文件</span></div>}
        {files.map(f => <button key={f.name} className="row press-row" onClick={() => open(f)}><span className="ico"><Icon n={f.dir ? 'folder' : /\.html?$/i.test(f.name) ? 'play' : 'doc'} s={16} w={2} /></span>
          <span className="grow t16 ell">{f.name}</span><span className="t12">{f.dir ? '' : f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}</span></button>)}
        <button className="row press-row" onClick={() => { if (confirm('停止把这个项目存到手机？已存的文件会保留。')) save({ ...p, folder: undefined }) }}><span className="grow t13 danger">停止保存到手机</span></button>
      </div>}
    {msg && <div className="t13 danger">{msg}</div>}
  </>
}

/* ---------------- Flow */
function useRecordReturn(go: (v: View) => void, setMsg: (m: string) => void) {
  useEffect(() => {
    const vis = async () => {
      if (document.hidden || !isNative) return
      const rec = localStorage.getItem('lumi.recording'); if (!rec) return
      try {
        const st = await Phone.recordStatus(); if (st.recording) return
        localStorage.removeItem('lumi.recording')
        const meta = JSON.parse(rec) as { app: string; pkg: string }
        const steps = tidy(st.steps || [], meta.app)
        if (steps.length < 2) { setMsg('没录到操作，再试一次'); return }
        const fl = upsertFlow({ id: uid(), app: meta.app, pkg: meta.pkg, name: '新的 Flow', desc: '', steps, params: [], updated: Date.now(), runs: 0 })
        go(`flow:${fl.id}` as View)
      } catch (e) { setMsg((e as Error).message) }
    }
    document.addEventListener('visibilitychange', vis); vis()
    return () => document.removeEventListener('visibilitychange', vis)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
async function startRecord(a: { label: string; pkg: string }, setMsg: (m: string) => void) {
  try {
    if (!isNative) { setMsg('只有安卓 App 里可以录制'); return }
    if (!(await Phone.a11yStatus()).enabled) { setMsg('先到「手机连接」里打开无障碍'); return }
    localStorage.setItem('lumi.recording', JSON.stringify({ app: a.label, pkg: a.pkg }))
    await Phone.recordStart({ pkg: a.pkg, app: a.label })
  } catch (e) { setMsg((e as Error).message) }
}

function AppPicker({ onPick, onClose, onAsk }: { onPick: (a: { label: string; pkg: string }) => void; onClose: () => void; onAsk?: () => void }) {
  const [q, setQ] = useState('')
  const [apps, setApps] = useState<{ label: string; pkg: string }[]>([])
  useEffect(() => { if (isNative) Phone.apps({ q }).then(r => setApps(r.apps)).catch(() => {}) }, [q])
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet fsheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <div className="t18 b" style={{ marginBottom: 4 }}>录制哪个应用</div>
        <div className="t13" style={{ marginBottom: 12 }}>会自动打开它，顶部出现录制条。照常点一遍，点「完成」回到这里。</div>
        {onAsk && <button className="ask-bar press-row" onClick={onAsk}><span className="ask-ic"><Icon n="eye" s={16} w={2.2} /></span>
          <div className="grow"><div className="t15 b">不想录？按任务生成</div><div className="t12">一句话描述要做的事，AI 生成步骤</div></div><Icon n="right" s={15} w={2} c="var(--label3)" /></button>}
        <input className="inp" placeholder="搜索应用" value={q} onChange={e => setQ(e.target.value)} />
        <div className="app-pick">{apps.map(a => <button key={a.pkg} className="ap-item press" onClick={() => onPick(a)}><AppIcon app={a.label} pkg={a.pkg} s={52} /><span className="ell">{a.label}</span></button>)}
          {!isNative && <div className="t13">安卓 App 里会列出手机上的应用</div>}</div>
      </div>
    </div>
  )
}

function ParamSheet({ f, onRun, onClose }: { f: Flow; onRun: (v: Record<string, string>) => void; onClose: () => void }) {
  const [v, setV] = useState<Record<string, string>>({})
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet fsheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <div className="ps-head"><AppIcon app={f.app} pkg={f.pkg} s={40} /><div><div className="t13">{f.app}</div><div className="t18 b">{f.name}</div></div></div>
        {f.params.map((p, i) => <input key={p} className="inp" autoFocus={i === 0} placeholder={p} value={v[p] || ''} onChange={e => setV({ ...v, [p]: e.target.value })} style={{ marginTop: 10 }} />)}
        <button className="btn-run" onClick={() => onRun(v)}><Icon n="play" s={15} w={2.4} />运行</button>
      </div>
    </div>
  )
}

/** 运行 Flow 的共用状态：有参数先弹参数表，跑完显示结果文字和运行明细。总览页的便当格和应用页的叠卡都用它。 */
function useRunner() {
  const [ask, setAsk] = useState<Flow | null>(null)
  const [running, setRunning] = useState('')
  const [msg, setMsg] = useState('')
  const [res, setRes] = useState<RunResult | null>(null)
  const run = async (f: Flow, vals: Record<string, string> = {}) => {
    setAsk(null); setRunning(f.id); setMsg(''); setRes(null)
    try { const r = await runFlow(f, vals); setRes(r); setMsg(runSummary(r, f.name)) }
    catch (e) { setMsg((e as Error).message) } finally { setRunning('') }
  }
  const start = (f: Flow) => { if (!running) { if (f.params.length) setAsk(f); else run(f) } }
  const ui = <>{res && <RunPanel r={res} />}{ask && <ParamSheet f={ask} onClose={() => setAsk(null)} onRun={v => run(ask, v)} />}</>
  return { running, msg, setMsg, res, start, ui }
}

const flowMeta = (f: Flow) => `${f.steps.length} 步${f.params.length ? ' · ' + f.params.join('、') : ''}${f.lastMs ? ` · 上次 ${(f.lastMs / 1000).toFixed(1)} 秒` : ''}${f.lastOk === false ? ' · 上次失败' : ''}`

function FlowsPage({ go }: { go: (v: View) => void }) {
  const flows = useFlows()
  const [pick, setPick] = useState(false)
  const [ask, setAsk] = useState(false)
  const R = useRunner()
  useRecordReturn(go, R.setMsg)
  const apps = bentoOrder([...new Set(flows.map(f => f.app))], a => flows.filter(f => f.app === a).length)
  const ph = bentoLayout(apps.length, 2), dk = bentoLayout(apps.length, 4)
  return (
    <section className="fade">
      <div className="f-sum"><span>{apps.length} 个应用 · {flows.length} 个 Flow</span>
        <button className="gen-btn press" onClick={() => setAsk(true)}><Icon n="eye" s={15} w={2.2} />按任务生成</button>
        <button className="rec-btn press" onClick={() => setPick(true)}><span className="rec-dot" />录制</button></div>
      {R.msg && <div className="imp-msg ok" style={{ marginBottom: 12 }}>{R.msg}</div>}
      {flows.length === 0 ? <div className="f-empty">
        <div className="fe-stack">{[0, 4, 6].map(k => <span key={k} className="mesh" style={{ background: meshBg(FAMILIES[k]) }}><Icon n={['bolt', 'search', 'repeat'][k % 3 === 0 ? 0 : k === 4 ? 1 : 2]} s={26} w={2} c="#fff" /></span>)}</div>
        <div className="t18 b">把常用操作存成一张卡</div>
        <div className="t13">录一遍操作，或者用一句话描述任务让 AI 生成（不认识的界面用 AI 视觉步）。下次点一下就能跑完。</div>
        <button className="btn-run" style={{ marginTop: 14 }} onClick={() => setAsk(true)}><Icon n="eye" s={15} w={2.2} />按任务生成</button>
      </div> : <div className="bento-wrap"><div className="bento">
        {apps.map((a, i) => <BentoTile key={a} app={a} ph={ph[i]} dk={dk[i]} flows={flows.filter(f => f.app === a)} running={R.running} onRun={R.start} onOpen={() => go(`flowapp:${a}` as View)} />)}
        <button className={`bt add ${ph[apps.length].w > 1 ? 'ph-row' : ''} ${dk[apps.length].w > 1 ? 'dk-row' : ''} press`} style={cellVars(ph[apps.length], dk[apps.length])} onClick={() => setPick(true)}><span className="fa-plus"><Icon n="plus" s={22} w={2.2} /></span><span>新应用</span></button>
      </div></div>}
      {R.ui}
      {pick && <AppPicker onClose={() => setPick(false)} onPick={a => { setPick(false); startRecord(a, R.setMsg) }} onAsk={() => { setPick(false); setAsk(true) }} />}
      {ask && <AskSheet kind="flow" onClose={() => setAsk(false)} />}
    </section>
  )
}

/** 便当格里的一格。hero：上方深色条放图标和名字，下面一块奶白面板列出 Flow + 播放键；wide / tall：右侧或中间是可直接运行的 Flow 胶囊；sq：原版小卡。 */
/** 格子位置写成 CSS 变量：--pc/--pr/--pw/--ph 是手机（单位正方形），--dc/--dr/--dw/--dh 是桌面；CSS 换算成底层网格的列和行。 */
const cellVars = (p: BentoCell, d: BentoCell) => ({ ['--pc' as string]: p.c, ['--pr' as string]: p.r, ['--pw' as string]: p.w, ['--ph' as string]: p.h,
  ['--dc' as string]: d.c, ['--dr' as string]: d.r, ['--dw' as string]: d.w, ['--dh' as string]: d.h })

function BentoTile({ app, ph, dk, flows, running, onRun, onOpen }: { app: string; ph: BentoCell; dk: BentoCell; flows: Flow[]; running: string; onRun: (f: Flow) => void; onOpen: () => void }) {
  const pkg = flows.find(f => f.pkg)?.pkg
  const t = tint(useAppLook(app, pkg))
  const total = flows.reduce((n, f) => n + f.runs, 0)
  // 内容按手机格子的尺寸排；桌面格子尺寸不同时（被降级），用 data-dk 让 CSS 调整
  const size: BentoSize = ph.size
  const pos = { ...cellVars(ph, dk) }
  const play = (f: Flow) => (e: React.MouseEvent) => { e.stopPropagation(); onRun(f) }
  const open = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }
  if (size === 'hero') {
    const shown = flows.slice(0, 3)
    return (
      <div className="bt hero mesh press-soft" data-dk={dk.size} style={{ ...meshVars(t, true), ...pos }} role="button" tabIndex={0} onClick={onOpen} onKeyDown={open} aria-label={app}>
        <div className="bh-top"><span className="fa-ring"><AppIcon app={app} pkg={pkg} s={46} /></span>
          <div className="grow"><div className="bh-name ell">{app}</div><div className="bh-sub ell">{flows.length} 个 Flow{total ? ` · 运行 ${total} 次` : ''}</div></div>
          <span className="bh-go" aria-hidden="true"><Icon n="right" s={16} w={2.4} /></span></div>
        <div className="bh-list">
          {shown.map(f => <div key={f.id} className={`bh-row ${running === f.id ? 'busy' : ''}`}>
            <span className="bh-gl"><Icon n={flowGlyph(f)} s={16} w={2} /></span>
            <div className="grow"><div className="bh-fn ell">{f.name}</div><div className="bh-fm ell">{running === f.id ? '运行中…' : flowMeta(f)}</div></div>
            <button className="bh-play press" onClick={play(f)} aria-label={`运行 ${f.name}`}><Icon n="play" s={12} w={2.6} /></button></div>)}
          {flows.length > shown.length && <div className="bh-more">还有 {flows.length - shown.length} 个 · 点开查看</div>}
        </div>
      </div>)
  }
  const pills = size === 'wide' ? flows.slice(0, 2) : size === 'tall' ? flows.slice(0, 3) : []
  return (
    <div className={`bt ${size} mesh press`} data-dk={dk.size} style={{ ...meshVars(t), ...pos }} role="button" tabIndex={0} onClick={onOpen} onKeyDown={open} aria-label={app}>
      {size === 'tall' && <span className="bt-mark" aria-hidden="true">{app.slice(0, 1)}</span>}
      <div className="fa-top"><span className="fa-ring"><AppIcon app={app} pkg={pkg} s={size === 'sq' ? 40 : 44} /></span>{size !== 'wide' && <span className="fa-n">{flows.length}</span>}</div>
      {pills.length > 0 && <div className="bt-pills">{pills.map(f =>
        <button key={f.id} className={`bt-pill press ${running === f.id ? 'busy' : ''}`} onClick={play(f)} aria-label={`运行 ${f.name}`}>
          <span className="ell">{running === f.id ? '运行中…' : f.name}</span><Icon n="play" s={10} w={2.8} /></button>)}</div>}
      <div className="bt-text"><div className="fa-name ell">{app}</div>
        <div className="fa-sub ell">{size === 'sq' ? flows.map(f => f.name).join(' · ') : size === 'tall' ? (total ? `运行过 ${total} 次` : '点胶囊直接运行') : `${flows.length} 个 Flow`}</div></div>
    </div>)
}

const flowGlyph = (f: Flow) => /搜/.test(f.name) ? 'search' : /外卖|点餐|下单|买/.test(f.name) ? 'wallet' : /发|写|笔记|评论/.test(f.name) ? 'pen' : /消息|聊|回复/.test(f.name) ? 'chat' : /打卡|签到/.test(f.name) ? 'check' : 'bolt'
const SHIFTS = [0, -18, 18, -36, 36]

function FlowApp({ app, go }: { app: string; go: (v: View) => void }) {
  const flows = useFlows().filter(f => f.app === app)
  const pkg = flows.find(f => f.pkg)?.pkg
  const look = useAppLook(app, pkg)
  const t = tint(look)
  const R = useRunner()
  const [sel, setSel] = useState<string | null>(null)
  const [ask, setAsk] = useState(false)
  useRecordReturn(go, R.setMsg)
  const total = flows.reduce((n, f) => n + f.runs, 0)
  // 钱包叠卡（参考 Riffs「Five glossy cards, one continuous shuffle」）：卡片重叠，只露出 60px 标题条；点一张抬起展开，显示步骤和运行键。≤2 个时全部展开。
  const flat = flows.length <= 2
  return (
    <section className="fade">
      <div className="fhero mesh" style={meshVars(t)}>
        <span className="fh-ring"><AppIcon app={app} pkg={pkg} s={60} /></span>
        <div className="fh-name">{app}</div>
        <div className="fh-sub">{flows.length} 个 Flow{total ? ` · 运行过 ${total} 次` : ''}</div>
        <div className="fh-btns"><button className="fh-rec press" onClick={() => startRecord({ label: app, pkg: pkg || look.pkg || '' }, R.setMsg)}><span className="rec-dot" />录制新 Flow</button>
          <button className="fh-gen press" onClick={() => setAsk(true)}><Icon n="eye" s={14} w={2.2} />按任务生成</button></div>
      </div>
      {ask && <AskSheet kind="flow" prefix={`在${app}里`} onClose={() => setAsk(false)} />}
      {R.msg && !R.res && <div className="imp-msg ok" style={{ margin: '12px 0 0' }}>{R.msg}</div>}
      {flows.length > 0 && <div className="deck-h"><span>全部 Flow</span><span className="t12">{flat ? '点运行键直接跑' : '点卡片展开，点运行键直接跑'}</span></div>}
      <div className={`deck ${flat ? 'flat' : ''} ${sel && !flat ? 'has-open' : ''}`}>
        {flows.map((f, i) => {
          const c = tint(look, SHIFTS[i % 5]); const on = flat || sel === f.id
          return (
            <div key={f.id} className={`wcard mesh ${on ? 'open' : ''} ${R.running === f.id ? 'busy' : ''}`} style={{ ...meshVars(c, true), zIndex: i + 1 }}>
              <div className="wc-head" role="button" tabIndex={0} aria-expanded={on}
                onClick={() => !flat && setSel(on ? null : f.id)} onKeyDown={e => { if (!flat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(on ? null : f.id) } }}>
                <span className="wc-ic"><AppIcon app={f.app} pkg={f.pkg || pkg} s={34} /><span className="wc-gl"><Icon n={flowGlyph(f)} s={10} w={2.4} /></span></span>
                <div className="grow"><div className="wc-name ell">{f.name}</div><div className="wc-meta ell">{R.running === f.id ? '运行中…' : flowMeta(f)}</div></div>
                <button className="ft-play press" onClick={e => { e.stopPropagation(); R.start(f) }} aria-label={`运行 ${f.name}`}><Icon n="play" s={13} w={2.6} /></button>
              </div>
              <div className="wc-face" aria-hidden={on}>
                <span className="wc-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="wc-hint">{f.params.length ? `需要填写：${f.params.join('、')}` : f.desc || `${f.steps.length} 步，点开看步骤`}</span>
              </div>
              <div className="wc-body"><div className="wc-in">
                <ol className="wc-steps">{f.steps.slice(0, 6).map((st, k) => <li key={k}><span>{k + 1}</span><div className="ell">{stepLabel(st)}</div></li>)}</ol>
                {f.steps.length > 6 && <div className="wc-more">… 共 {f.steps.length} 步</div>}
                <div className="wc-btns"><button className="btn-ghost press" onClick={() => go(`flow:${f.id}` as View)}><Icon n="pen" s={15} w={2} />编辑</button>
                  <button className="wc-run press" onClick={() => R.start(f)}><Icon n="play" s={13} w={2.6} />{R.running === f.id ? '运行中…' : '运行'}</button></div>
              </div></div>
            </div>)
        })}
      </div>
      {R.ui}
    </section>
  )
}

/* ---------------- 手机操控 */
const PHONE_PROMPT = `你现在连着用户的安卓手机，可以用工具替用户操作手机。
做法：
1. 先 phone_screen 看清当前屏幕，再根据元素编号 phone_tap / phone_input / phone_scroll；每次操作后界面会变，需要时重新 phone_screen。
2. 打开应用用 phone_open_app；返回、回主屏用 phone_key。
3. phone_shell 是 ADB 命令，只在用户已连接 ADB 且确实需要时用（比如查电量 dumpsys battery、截屏 screencap）。不要执行删除数据、卸载应用、改系统设置之类的危险命令，除非用户明确要求。
4. 涉及付款、发消息给别人、删除内容等不可撤回的操作，执行前先停下来问用户确认。
5. 如果用户的请求和某个已保存的 Flow 对得上，优先 flow_run（填好参数），比一步步操作快；Flow 失败时会告诉你卡在哪，你接着手动做完，再问用户要不要用 flow_save 修好它。Flow 找不到元素时先用 phone_screen 看清再手动完成，完成后再问用户要不要把新选择器存回 Flow（不要每次都走视觉：AI 视觉每步都要一次模型往返，比原生 Flow 慢，只做首跑发现，缓存的选择器下次直接原生跑）。
6. 用户让你新建或优化 Flow 时，用 flow_save；选择器优先用 phone_screen 里看到的文字。
7. 做完后用一两句话告诉用户结果。`

/** v0.20：对话里的确认卡 / 结果卡。技能、MCP、Flow 的保存和删除先在这里确认；保存后可撤销；Flow 可试跑（AI 视觉学到的位置自动存回）。 */
const CARD_STATUS: Record<ChatCard['status'], string> = { pending: '待确认', saved: '已保存', cancelled: '已取消', undone: '已撤销', running: '运行中…', done: '已完成', failed: '没跑完' }
const CAT_TAG: Record<string, string> = { ai: 'AI 视觉', logic: '逻辑', var: '变量', cls: '类', confirm: '需确认' }
function CardView({ c, live, patch }: { c: ChatCard; live: boolean; patch: (p: Partial<ChatCard>) => void }) {
  const R = useRunner()
  const waiting = c.status === 'pending' && isWaiting(c.id)
  const fid = (c.after as { id?: string } | null)?.id || (c.before as { id?: string } | null)?.id
  const flow = (c.kind === 'flow' || c.kind === 'run') && fid ? loadFlows().find(f => f.id === fid) : undefined
  const [more, setMore] = useState(false)
  useEffect(() => { if (R.msg && !R.running) patch({ note: '试跑：' + R.msg }) }, [R.msg, R.running]) // eslint-disable-line react-hooks/exhaustive-deps
  const st = c.status === 'pending' && !waiting ? '已失效' : c.status === 'saved' && c.op === 'delete' ? '已删除' : CARD_STATUS[c.status]
  const srv = (c.after || c.before) as McpServer | null
  const lines = c.lines || []
  const shown = more ? lines : lines.slice(0, 8)
  return (
    <div className={`ccard ${c.kind} st-${c.status} ${waiting ? 'wait' : ''}`}>
      <div className="cc-head">
        {c.kind === 'skill' ? <span className={`ag-i ${c.tone || 'coral'}`}><Icon n={c.icon || 'spark'} s={20} w={1.9} /></span>
          : c.kind === 'mcp' ? <Favicon site={srv?.site || siteOf(srv?.url || '')} status={srv?.status || 'unknown'} />
            : <AppIcon app={c.app || ''} pkg={c.pkg} s={40} />}
        <div className="grow"><div className="cc-t">{c.title}</div><div className="cc-n ell">{c.name}</div>{c.sub && <div className="cc-s ell">{c.sub}</div>}</div>
        <span className={`cc-st ${c.status === 'pending' && !waiting ? 'expired' : ''}`}>{st}</span>
      </div>
      {c.fields.length > 0 && <dl className="cc-kv">{c.fields.map(f => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>}
      {lines.length > 0 && <ol className="cc-steps">{shown.map(([cat, t], k) => <li key={k} className={`cat-${cat}`}><span className="cc-no">{k + 1}</span><span className="grow">{t}</span>{CAT_TAG[cat] && <span className="cc-tag">{CAT_TAG[cat]}</span>}</li>)}
        {lines.length > 8 && <li className="cc-more"><button onClick={() => setMore(!more)}>{more ? '收起' : `展开全部 ${lines.length} 步`}</button></li>}</ol>}
      {c.warn?.length ? <ul className="cc-warn">{c.warn.map(w => <li key={w}>{w}</li>)}</ul> : null}
      {c.note && <div className={`cc-note ${c.status === 'failed' ? 'bad' : ''}`}>{c.note}</div>}
      {waiting && <div className="cc-btns"><button className="btn-ghost press" onClick={() => decide(c.id, false)}>取消</button>
        <button className={`cc-ok press ${c.op === 'delete' ? 'danger' : ''}`} onClick={() => decide(c.id, true)}><Icon n={c.op === 'delete' ? 'trash' : 'check'} s={15} w={2.4} />{c.op === 'delete' ? '删除' : '保存'}</button></div>}
      {!live && (c.status === 'saved' || ((c.status === 'done' || c.status === 'failed') && flow)) && <div className="cc-btns">
        {c.status === 'saved' && <button className="btn-ghost press" onClick={() => patch({ status: 'undone', note: undoCard(c) })}><Icon n="redo" s={14} w={2.2} />撤销</button>}
        {flow && c.op !== 'delete' && <button className="btn-ghost press" onClick={() => window.dispatchEvent(new CustomEvent('lumi-go', { detail: `flow:${flow.id}` }))}><Icon n="pen" s={14} w={2.2} />打开</button>}
        {flow && c.kind === 'flow' && c.op !== 'delete' && <button className="cc-ok press" disabled={!isNative || !!R.running} title={isNative ? '' : '需要安卓 App'} onClick={() => R.start(flow)}>
          <Icon n="play" s={13} w={2.6} />{R.running ? '试跑中…' : isNative ? '试跑' : '试跑（需安卓 App）'}</button>}
      </div>}
      {R.ui}
    </div>
  )
}

function Steps({ steps, live }: { steps: Step[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  const cur = steps[steps.length - 1]
  const phone = steps.some(x => isPhoneTool(x.name))
  return (
    <div className="steps">
      <button onClick={() => setOpen(!open)}><Icon n={phone ? 'phone' : 'bolt'} s={15} w={2} />
        <span className="grow ell">{live && cur ? (cur.result === undefined ? `正在${cur.label}…` : cur.label) : phone ? `操作了手机 · ${steps.length} 步` : `用了 ${steps.length} 个工具`}</span>
        <Icon n="down" s={14} w={2.2} /></button>
      {open && <ol>{steps.map((st, i) => (
        <li key={i} className={st.ok === false ? 'bad' : ''}><span className="sd"><Icon n={st.ok === false ? 'x' : 'check'} s={11} w={2.8} /></span>
          <div className="grow"><div>{st.label}</div>{st.result && st.name !== 'phone_screen' && <div className="sr">{st.result}</div>}</div></li>))}</ol>}
    </div>
  )
}

function Preview() {
  const [html, setHtml] = useState<string | null>(null)
  const [w, setW] = useState<'m' | 't' | 'f'>('m')
  const [k, setK] = useState(0)
  const [toast, setToast] = useState('')
  useEffect(() => {
    const on = (e: Event) => { setHtml((e as CustomEvent).detail.html); setW(window.innerWidth < 700 ? 'f' : 'm') }
    window.addEventListener('lumi-preview', on); return () => window.removeEventListener('lumi-preview', on)
  }, [])
  if (html == null) return null
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(''), 1800) }
  const save = async () => {
    if (!isNative) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = 'lumi-preview.html'; a.click(); return }
    try {
      let st = await Phone.folderStatus()
      if (!st.linked) st = await Phone.pickFolder()
      const t = (html.match(/<title>([^<]{1,40})<\/title>/i)?.[1] || '页面').replace(/[\\/:*?"<>|]/g, '_')
      const d = new Date(), name = `网页/${t}-${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.html`
      await Phone.writeText({ path: name, text: html }); say(`已保存到 ${st.name || '手机'}/${name}`)
    } catch (e) { say((e as Error).message) }
  }
  return (
    <div className="pv">
      <div className="pv-bar">
        <button className="icon-btn" onClick={() => setHtml(null)} aria-label="关闭"><Icon n="x" s={20} w={2.2} /></button>
        <div className="t16 b">预览</div>
        <div className="pv-seg">{(['m', 't', 'f'] as const).map(x => <button key={x} className={w === x ? 'on' : ''} onClick={() => setW(x)} aria-label={x}><Icon n={x === 'm' ? 'phone' : x === 't' ? 'doc' : 'monitor'} s={16} w={2} /></button>)}</div>
        <button className="icon-btn" onClick={() => setK(k + 1)} aria-label="刷新"><Icon n="redo" s={18} w={2} /></button>
        <button className="icon-btn" onClick={save} aria-label="保存"><Icon n="download" s={18} w={2} /></button>
      </div>
      <div className="pv-stage">
        <iframe key={k} className="pv-frame" title="预览" srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads"
          style={{ width: w === 'm' ? 390 : w === 't' ? 768 : '100%' }} />
      </div>
      {toast && <div className="pv-toast">{toast}</div>}
    </div>
  )
}

function PhonePage() {
  const [a11y, setA11y] = useState<boolean | null>(null)
  const [adb, setAdb] = useState<{ connected: boolean; pairPort: number; sdk: number } | null>(null)
  const [folder, setFolder] = useState<{ linked: boolean; name?: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [port, setPort] = useState(''), [code, setCode] = useState('')
  const [cmd, setCmd] = useState('getprop ro.product.model'), [out, setOut] = useState('')
  const [busy, setBusy] = useState('')
  const refresh = async () => {
    if (!isNative) return
    try { setA11y((await Phone.a11yStatus()).enabled) } catch { setA11y(false) }
    try { setAdb(await Phone.adbStatus()) } catch { /* */ }
    try { setFolder(await Phone.folderStatus()) } catch { /* */ }
  }
  useEffect(() => {
    refresh()
    if (!isNative) return
    const vis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', vis)
    const sub = Phone.addListener('adb', d => {
      setMsg(({ found: `找到配对端口 ${d.msg}，下拉通知栏输入配对码`, pairing: '正在配对…', paired: '配对成功，点「连接」', connected: '已连接 ADB', error: '配对失败：' + d.msg } as Record<string, string>)[d.state] || '')
      refresh()
    })
    return () => { document.removeEventListener('visibilitychange', vis); sub.then(s => s.remove()) }
  }, [])
  const run = async (k: string, f: () => Promise<unknown>) => { setBusy(k); setMsg(''); try { await f() } catch (e) { setMsg((e as Error).message) } finally { setBusy(''); refresh() } }
  if (!isNative) return <section className="fade"><div className="empty-card"><GlassIcon n="phone" tone="sky" s={56} /><div className="t16 b">只有安卓 App 里可以用</div><div className="t13">装上栖语 Lumi 的 APK 后，在这里连接手机</div></div></section>
  return (
    <section className="fade">
      <div className="dev-card">
        <div className="dev-top"><GlassIcon n="shield" tone="sage" s={44} /><div className="grow"><div className="t16 b">无障碍</div><div className="t13">读屏幕、点击、输入、滑动，不需要电脑</div></div>
          <span className={`pill-st ${a11y ? 'on' : ''}`}>{a11y ? '已开启' : '未开启'}</span></div>
        {!a11y && <ol className="dev-steps"><li>点下面的按钮打开系统无障碍设置</li><li>找到「已下载的应用」里的「栖语 Lumi 手机操控」</li><li>打开开关，回到这里</li></ol>}
        <div className="dev-acts"><button className={a11y ? 'btn-ghost' : 'btn-ink'} onClick={() => Phone.openA11ySettings()}>{a11y ? '无障碍设置' : '去开启'}</button></div>
      </div>

      <div className="dev-card">
        <div className="dev-top"><GlassIcon n="terminal" tone="plum" s={44} /><div className="grow"><div className="t16 b">自建 ADB</div><div className="t13">用无线调试连本机，能执行 shell 命令（Android 11 及以上）</div></div>
          <span className={`pill-st ${adb?.connected ? 'on' : ''}`}>{adb?.connected ? '已连接' : '未连接'}</span></div>
        {!adb?.connected && <ol className="dev-steps">
          <li>开发者选项里打开「无线调试」（先连上 Wi-Fi）</li>
          <li>点「开始配对」，再进 无线调试 →「使用配对码配对设备」</li>
          <li>下拉通知栏，在栖语 Lumi 的通知里填 6 位配对码</li>
          <li>配对成功后会自动连接；只需配对一次</li></ol>}
        <div className="dev-acts">
          {!adb?.connected && <button className="btn-ink" disabled={!!busy} onClick={() => run('pair', async () => { await Phone.adbPair({}); setMsg('正在找配对服务…'); await Phone.openDevSettings() })}>开始配对</button>}
          <button className="btn-ghost" disabled={!!busy} onClick={() => run('con', async () => { await Phone.adbConnect({}); setMsg('已连接 ADB') })}>{busy === 'con' ? '连接中…' : adb?.connected ? '重新连接' : '连接'}</button>
          {adb?.connected && <button className="btn-ghost" onClick={() => run('dis', () => Phone.adbDisconnect())}>断开</button>}
          <button className="btn-ghost" onClick={() => Phone.openDevSettings()}>开发者选项</button>
        </div>
        {!adb?.connected && <details><summary className="t13">分屏或手动配对</summary>
          <div className="mini-row" style={{ marginTop: 8 }}><input className="inp" inputMode="numeric" placeholder="配对端口" value={port} onChange={e => setPort(e.target.value)} />
            <input className="inp" inputMode="numeric" placeholder="配对码" value={code} onChange={e => setCode(e.target.value)} />
            <button className="btn-ink" disabled={!port || !code} onClick={() => run('mp', () => Phone.adbPair({ port: Number(port), code }))}>配对</button></div></details>}
        {adb?.connected && <>
          <div className="mini-row"><input className="inp" value={cmd} onChange={e => setCmd(e.target.value)} placeholder="shell 命令" />
            <button className="btn-ink" disabled={!!busy} onClick={() => run('sh', async () => setOut((await Phone.adbShell({ cmd })).out || '（没有输出）'))}>{busy === 'sh' ? '…' : '执行'}</button></div>
          {out && <pre className="shell-out">{out}</pre>}</>}
      </div>

      <div className="dev-card">
        <div className="dev-top"><GlassIcon n="folder" tone="gold" s={44} /><div className="grow"><div className="t16 b">手机存储</div><div className="t13 ell">{folder?.linked ? `已选择：${folder.name}` : '选一个文件夹，项目、对话和网页都存在这里'}</div></div>
          <span className={`pill-st ${folder?.linked ? 'on' : ''}`}>{folder?.linked ? '已选择' : '未选择'}</span></div>
        <div className="dev-acts"><button className={folder?.linked ? 'btn-ghost' : 'btn-ink'} onClick={() => run('f', () => Phone.pickFolder())}>{folder?.linked ? '换一个文件夹' : '选择文件夹'}</button>
          {folder?.linked && <button className="btn-ghost danger" onClick={() => run('uf', () => Phone.unlinkFolder())}>取消关联</button>}</div>
      </div>
      {msg && <div className="imp-msg ok" style={{ background: /失败|不|没/.test(msg) ? '#fdeceb' : undefined, color: /失败|不|没/.test(msg) ? '#b23a2a' : undefined }}>{msg}</div>}
      <div className="t13" style={{ marginTop: 12 }}>在对话里点「+」→「手机操控」，模型就能用上面这些能力。付款、发消息、删除前会先问你。</div>
    </section>
  )
}

/* ---------------- 角色扮演 */
/** 英文卡 + 长英文开场时，系统提示里的语言要求常被忽略；只在发给模型的最后一条用户消息后附一句，不存进对话。 */
function langHint(ms: Msg[]): Msg[] {
  const i = ms.length - 1
  if (i < 0 || ms[i].role !== 'user' || !/[\u4e00-\u9fff]/.test(ms[i].content)) return ms
  return [...ms.slice(0, i), { ...ms[i], content: ms[i].content + '\n\n（系统提示：这条回复请用简体中文写，保持角色和格式；人名可保留原文。）' }]
}
function CharAvatar({ c, s = 40 }: { c: Character; s?: number }) {
  const [u, setU] = useState<string | null>(null)
  useEffect(() => { let on = true; if (c.avatar) blobUrl(c.avatar).then(x => on && setU(x)); return () => { on = false } }, [c.avatar])
  return <span className="c-av" style={{ width: s, height: s }}>{u ? <img src={u} alt="" /> : <Icon n="mask" s={Math.round(s * 0.55)} w={1.7} c="#fff" />}</span>
}

function CharsPage({ chars, settings, add, onChat, onEdit, convs, onOpen }: {
  chars: Character[]; settings: Settings; add: (c: Character) => void; onChat: (c: Character) => void; onEdit: (c: Character) => void; convs: Conv[]; onOpen: (id: string) => void
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const done = (c: Character) => { add(c); setMsg({ ok: true, t: `已导入「${c.name}」${c.book.length ? `，含 ${c.book.length} 条世界书` : ''}` }); setLink('') }
  const fail = (e: unknown) => setMsg({ ok: false, t: (e as Error).message === 'Failed to fetch' ? '连不上服务器，检查一下网络' : (e as Error).message })
  const byLink = async () => {
    if (!link.trim() || busy) return
    setBusy(true); setMsg(null)
    try { done(await importLink(settings, link)) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const byFile = async (f?: File) => {
    if (!f) return
    setBusy(true); setMsg(null)
    try { done(await importFile(f)) } catch (e) { fail(e) } finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  const recent = convs.filter(c => c.char).slice(0, 4)
  return (
    <section className="fade">
      <div className="import-card">
        <div className="t16 b">导入角色卡</div>
        <div className="t13">粘贴 chub.ai 角色页、PNG 角色卡或 JSON 的链接，也可以选本地文件</div>
        <div className="imp-row">
          <input className="inp" placeholder="https://chub.ai/characters/…" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && byLink()} />
          <button className="btn-ink" disabled={!link.trim() || busy} onClick={byLink}>{busy ? '导入中…' : '导入'}</button>
        </div>
        <div className="imp-row2">
          <button className="btn-ghost" onClick={() => file.current?.click()} disabled={busy}><Icon n="upload" s={16} w={2} />从文件导入</button>
          <button className="btn-ghost" onClick={() => onEdit(blankChar())}><Icon n="plus" s={16} w={2} />自己写一个</button>
        </div>
        <input ref={file} type="file" accept=".png,.json,image/png,application/json" hidden onChange={e => byFile(e.target.files?.[0])} />
        {msg && <div className={`imp-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.t}</div>}
      </div>
      {chars.length === 0
        ? <div className="empty-card"><GlassIcon n="mask" tone="rose" s={56} /><div className="t16 b">还没有角色</div><div className="t13">导入一张酒馆角色卡，或者自己写一个</div></div>
        : <div className="char-grid">{chars.map(c => (
          <div key={c.id} className="char-card press-row" onClick={() => onChat(c)}>
            <CharAvatar c={c} s={64} />
            <div className="grow">
              <div className="t16 b ell">{c.name}</div>
              <div className="t13 clamp2">{macros(c.creator_notes || c.description || c.scenario, c.name, settings.rpUser || '用户').replace(/<[^>]+>/g, '').slice(0, 90) || '没有简介'}</div>
              {c.tags.length > 0 && <div className="tags">{c.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>}
            </div>
            <button className="icon-btn" aria-label="编辑" onClick={e => { e.stopPropagation(); onEdit(c) }}><Icon n="pen" s={18} w={1.9} /></button>
          </div>))}</div>}
      {recent.length > 0 && <><div className="sec">最近的角色对话</div>
        <div className="list">{recent.map(c => (
          <button key={c.id} className="row press-row" onClick={() => onOpen(c.id)}>
            <span className="grow"><span className="t16 ell">{c.title}</span><span className="t12">{c.messages.length} 条 · {when(c.updated)}</span></span><Icon n="right" s={16} w={2} />
          </button>))}</div></>}
    </section>
  )
}

function CharEdit({ c, save, remove, onChat }: { c: Character; save: (c: Character) => void; remove: () => void; onChat: (c: Character) => void }) {
  const [d, setD] = useState(c)
  const [alt, setAlt] = useState(c.alternate_greetings.join('\n\n---\n\n'))
  const isNew = !loadChars().some(x => x.id === c.id)
  const commit = (x = d) => { if (x.name.trim()) save({ ...x, name: x.name.trim(), alternate_greetings: alt.split(/\n\s*---\s*\n/).map(t => t.trim()).filter(Boolean) }) }
  const field = (k: keyof Character, label: string, ph: string, rows = 3) => (
    <label className="fld"><span className="t13 b">{label}</span>
      <textarea className="inp" rows={rows} placeholder={ph} value={String(d[k] ?? '')} onChange={e => setD({ ...d, [k]: e.target.value })} onBlur={() => !isNew && commit()} /></label>)
  return (
    <section className="fade char-edit">
      <div className="ce-head"><CharAvatar c={d} s={76} />
        <input className="inp big-name" placeholder="角色名" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} onBlur={() => !isNew && commit()} /></div>
      {d.source && <div className="t12 ell dim">来源：{d.source}</div>}
      {field('description', '角色设定', '外貌、身份、背景、说话方式……可以用 {{char}} 和 {{user}}', 6)}
      {field('personality', '性格', '一句话概括性格')}
      {field('scenario', '场景', '故事发生在哪里、你们是什么关系')}
      {field('first_mes', '开场白', '角色说的第一句话', 5)}
      <label className="fld"><span className="t13 b">备选开场白</span>
        <textarea className="inp" rows={4} placeholder="多个开场之间用单独一行 --- 隔开" value={alt} onChange={e => setAlt(e.target.value)} onBlur={() => !isNew && commit()} /></label>
      {field('mes_example', '对话示例', '<START>\n{{user}}: 你好\n{{char}}: ……', 4)}
      {field('system_prompt', '系统提示词（可选）', '留空用默认的角色扮演提示词')}
      {field('post_history', '额外要求（可选）', '比如：每次回复 200 字以内')}
      {d.book.length > 0 && <div className="t13 dim">世界书：{d.book.length} 条（{d.book.filter(e => e.constant).length} 条常驻，其余在聊到关键词时加入）</div>}
      <div className="ce-acts">
        <button className="btn-ink" disabled={!d.name.trim()} onClick={() => { commit(); onChat({ ...d, alternate_greetings: alt.split(/\n\s*---\s*\n/).map(t => t.trim()).filter(Boolean) }) }}>保存并开始聊天</button>
        {isNew ? <button className="btn-ghost" disabled={!d.name.trim()} onClick={() => commit()}>保存</button>
          : <button className="btn-ghost danger" onClick={() => { if (confirm(`删除角色「${d.name}」？`)) remove() }}><Icon n="trash" s={16} w={2} />删除</button>}
      </div>
    </section>
  )
}

function useSkills() {
  const [a, setA] = useState<Agent[]>(allAgents)
  useEffect(() => { const on = () => setA(allAgents()); window.addEventListener('lumi-skills', on); return () => window.removeEventListener('lumi-skills', on) }, [])
  return a
}

/** v0.20：「在对话里定制」入口。点开写一句话（或点示例），新开一段对话发给模型，模型用工具生成，并在对话里弹确认卡。 */
const ASK: Record<'skill' | 'mcp' | 'flow', { btn: string; title: string; hint: string; ph: string; ex: string[]; wrap: (t: string) => string }> = {
  skill: { btn: '用对话定制技能', title: '描述你想要的技能', hint: '说清楚它扮演谁、怎么做、输出什么格式。生成后会弹出确认卡，点「保存」才会加到技能里。', ph: '比如：帮我做个技能，把会议录音整理成纪要和待办',
    ex: ['帮我做个技能：小红书文案助手，标题带数字，正文分段，结尾 5 个话题标签', '帮我做个技能：英文邮件回复，语气礼貌简洁，先给中文要点再给英文全文'], wrap: t => /技能/.test(t) ? t : '帮我做个技能：' + t },
  mcp: { btn: '用对话添加 MCP', title: '添加 MCP 服务器', hint: '贴上 Streamable HTTP 地址（和令牌，如果有）。会先测试连接、读取工具，再弹确认卡。', ph: '比如：加一个 MCP https://mcp.example.com/mcp',
    ex: ['加一个 MCP：https://mcp.deepwiki.com/mcp'], wrap: t => /mcp/i.test(t) ? t : '加一个 MCP：' + t },
  flow: { btn: '按任务生成', title: '按任务生成 Flow', hint: '用一句话描述手机上要做的事。AI 生成步骤：知道的界面走原生选择器，不认识的界面用 AI 视觉步（第一次要截图问模型，找到后存回，之后走原生）。',
    ph: '比如：每天帮我在小红书收藏前5篇南京咖啡笔记', ex: ['每天帮我在小红书收藏前5篇南京咖啡笔记', '在美团搜索{店名}，把招牌菜加入购物车，停在结算页', '打开微信，把{内容}发给文件传输助手'],
    wrap: t => `按任务生成 Flow：${t}\n（不认识的界面用 AI 视觉步，会变的内容做成 {参数}，付款、发送类步骤加确认。）` },
}
const askChat = (text: string) => window.dispatchEvent(new CustomEvent('lumi-ask', { detail: text }))
function AskSheet({ kind, prefix = '', onClose }: { kind: keyof typeof ASK; prefix?: string; onClose: () => void }) {
  const a = ASK[kind]
  const [t, setT] = useState(prefix)
  const go = (x: string) => { if (!x.trim()) return; onClose(); askChat(a.wrap(x.trim())) }
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet fsheet ask-sheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <div className="t18 b" style={{ marginBottom: 4 }}>{a.title}</div>
        <div className="t13" style={{ marginBottom: 12 }}>{a.hint}</div>
        <textarea className="inp ask-in" rows={3} autoFocus placeholder={a.ph} value={t} onChange={e => setT(e.target.value)} />
        <div className="ask-ex">{a.ex.map(x => <button key={x} className="chip press" onClick={() => go(x)}>{x}</button>)}</div>
        <button className="btn-run" disabled={!t.trim()} onClick={() => go(t)}><Icon n="spark" s={15} w={2.2} />去对话里生成</button>
      </div>
    </div>
  )
}
function AskBar({ kind }: { kind: keyof typeof ASK }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="ask-bar press-row" onClick={() => setOpen(true)}><span className="ask-ic"><Icon n="spark" s={16} w={2.2} /></span>
      <div className="grow"><div className="t15 b">{ASK[kind].btn}</div><div className="t12">{ASK[kind].ph}</div></div><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
    {open && <AskSheet kind={kind} onClose={() => setOpen(false)} />}
  </>
}

function Agents({ onPick }: { onPick: (a: Agent) => void }) {
  const list = useSkills()
  return (
    <section className="fade">
      <AskBar kind="skill" />
      <div className="agents">{list.map(a => (
        <button key={a.id} className={`agent ${a.tone} press-row`} onClick={() => onPick(a)}>
          <span className="ag-i"><Icon n={a.icon} s={22} w={1.9} /></span>
          <div className="grow"><div className="ag-n">{a.name}{a.custom && <span className="ag-tag">自定义</span>}</div><div className="t13">{a.desc}</div></div>
          <Icon n="right" s={16} w={2} c="var(--label3)" />
        </button>))}
      </div>
    </section>
  )
}

/* ---------------- chat */
function MediaView({ m }: { m: Media }) {
  const [url, setUrl] = useState<string | null>(m.remote || null)
  useEffect(() => { if (!m.remote && m.status === 'done') blobUrl(m.id).then(setUrl) }, [m.id, m.status, m.remote])
  if (m.status === 'pending') return <div className={`media-skel ${m.kind}`}><div className="shimmer" /><span><Icon n={m.kind === 'video' ? 'film' : 'image'} s={16} w={2} />{m.kind === 'video' ? '视频生成中，通常需要一到几分钟' : '图片生成中'}{m.error ? ` · ${m.error}` : ''}</span></div>
  if (m.status === 'error') return <div className="err">{m.error}</div>
  if (!url) return <div className="t13">媒体文件已不在本机</div>
  return m.kind === 'video'
    ? <video className="media" src={url} controls playsInline loop />
    : <a href={url} target="_blank" rel="noreferrer"><img className="media" src={url} alt={m.prompt} /></a>
}

function Chat({ conv, settings, tier, think, pending, clearPending, project, onNew, onMode, update }: {
  conv: Conv; settings: Settings; tier: Tier; think: boolean; pending: Pending | null; clearPending: () => void; project?: Project
  onNew: () => void; onMode: () => void; update: (fn: (c: Conv) => Conv) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [gen, setGen] = useState<Gen>('chat')
  const [menu, setMenu] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const composing = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const agent = agentById(conv.agent)
  const char = charById(conv.char)
  const folder = project?.folder
  // v0.20：普通对话（非角色扮演）也带定制工具：技能 / MCP / Flow 的查看、保存（确认卡）、删除；flow_run 只在安卓 App 里有
  const custom = !char && settings.chatCustom !== false
  const toolNames = [...new Set([...(conv.phone ? ['phone_screen', 'phone_tap', 'phone_input', 'phone_scroll', 'phone_swipe', 'phone_key', 'phone_open_app', 'phone_shell', 'flow_list', 'flow_run', 'flow_save'] : []), ...(conv.phone || folder ? ['phone_save', 'phone_read', 'phone_files'] : []),
    ...(custom ? CUSTOM_NAMES.filter(n => n !== 'flow_run' || isNative) : [])])]
  const rpUser = settings.rpUser || '用户'
  useEffect(() => { if (pinned.current) scroller.current?.scrollTo({ top: 1e9 }) }, [conv.messages])

  const setLast = (fn: (m: Msg) => Msg) => update(c => { const m = [...c.messages]; m[m.length - 1] = fn(m[m.length - 1]); return { ...c, messages: m } })

  const runMedia = async (kind: 'image' | 'video', prompt: string) => {
    const base = [...conv.messages, { role: 'user' as const, content: prompt }]
    const media: Media = { kind, id: uid(), prompt, status: 'pending' }
    const title = conv.title === '新对话' ? prompt.slice(0, 18) : conv.title
    update(c => ({ ...c, title, updated: Date.now(), messages: [...base, { role: 'assistant', content: '', media }] }))
    try {
      const r = kind === 'image'
        ? await generateImage(settings, prompt, ctrl.current!.signal)
        : await generateVideo(settings, prompt, ctrl.current!.signal, p => setLast(m => ({ ...m, media: { ...m.media!, error: p ? `${Math.round(p)}%` : undefined } })))
      if (r.blob) await putBlob(media.id, r.blob)
      setLast(m => ({ ...m, media: { ...media, status: 'done', remote: r.url } }))
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '已取消' : (e as Error).message
      setLast(m => ({ ...m, media: { ...media, status: 'error', error: msg } }))
    }
  }

  const send = async (override?: Msg[], say?: string, mode: Gen = gen) => {
    const content = (say ?? text).trim()
    if (!override && !content) return
    setText(''); setErr(''); setBusy(true); pinned.current = true
    ctrl.current = new AbortController()
    if (!override && mode !== 'chat') { setGen('chat'); await runMedia(mode, content); setBusy(false); ctrl.current = null; return }
    const base = override ?? [...conv.messages, { role: 'user' as const, content }]
    const title = conv.title === '新对话' || (agent && conv.title === agent.name && conv.messages.length === 0) ? base[0].content.slice(0, 18) : conv.title
    update(c => ({ ...c, title, tier, updated: Date.now(), messages: [...base, { role: 'assistant', content: '', tier }] }))
    const t0 = performance.now()
    let thinkMs = 0
    const system = char ? rpSystem(char, rpUser, base, settings.rpMyLang !== false) : [agent?.prompt, project?.instructions ? `项目「${project.name}」的说明：\n${project.instructions}` : '',
      conv.phone ? PHONE_PROMPT + '\n\n用户保存的 Flow：\n' + flowSummary(loadFlows()) : '', folder ? `这个项目绑定了手机里的文件夹「${folder}」。用户要你写文件、做网页或保存内容时，用 phone_save 存进去（路径相对这个文件夹，比如 pages/index.html），存完告诉用户文件名。` : '',
      settings.genUI && !conv.phone ? GENUI_PROMPT : '', custom ? CUSTOM_PROMPT + (conv.phone ? '' : '\n\n用户保存的 Flow：\n' + flowSummary(loadFlows())) + (isNative ? '' : '\n\n（现在是网页版：可以保存 Flow，但不能运行，运行要在安卓 App 里。）') : ''].filter(Boolean).join('\n\n') || undefined
    if (toolNames.length && !char) { await agentLoop(base, system); return }
    try {
      const r = await streamChat({
        settings, tier, think, messages: char ? (settings.rpMyLang !== false ? langHint : (x: Msg[]) => x)(base.map(x => ({ ...x, content: runRegex(x.content, char, x.role === 'user' ? 'user' : 'ai', 'prompt', rpUser) }))) : base, signal: ctrl.current.signal, system, roleplay: !!char,
        onDelta: (t, rs) => {
          if (rs && t && !thinkMs) thinkMs = performance.now() - t0
          update(c => ({ ...c, messages: [...base, { role: 'assistant', content: t, reasoning: rs, tier, thinkMs: thinkMs || undefined }] }))
        },
      })
      addUsage(0, r.completionTokens + r.promptTokens)
      setLast(m => ({ ...m, ms: r.firstTokenMs, thinkMs: m.reasoning && !m.thinkMs ? performance.now() - t0 : m.thinkMs }))
    } catch (e) {
      if ((e as Error).name === 'AbortError') setLast(m => ({ ...m, stopped: true }))
      else setErr(friendly(e))
    } finally { setBusy(false); ctrl.current = null }
  }
  /** 执行一个工具。v0.20：保存 / 删除类先在对话里放确认卡，等用户点「保存」或「取消」；flow_run 附一张运行卡（应用图标 + 结果）。 */
  const exec = async (name: string, args: Record<string, unknown>, steps: Step[]): Promise<string> => {
    const show = (card: ChatCard) => { steps[steps.length - 1] = { ...steps[steps.length - 1], card }; update(c => { const m = [...c.messages]; m[m.length - 1] = { ...m[m.length - 1], steps: [...steps] }; return { ...c, messages: m } }) }
    if (CUSTOM_NAMES.includes(name) && name !== 'flow_run' && name !== 'flow_list') {
      const p = await proposeTool(name, args, { probe: probeMcp })
      if (!p.card) return p.text || '出错了：没有结果'
      show(p.card)
      if (!MUTATING.has(name)) return p.text || ''
      const ok = await waitDecision(p.card.id, ctrl.current?.signal)
      if (!ok) { show({ ...p.card, status: 'cancelled' }); if (ctrl.current?.signal.aborted) throw new DOMException('stop', 'AbortError'); return '用户点了「取消」，没有保存。不要再提交同样的内容，问用户想怎么改。' }
      const res = commitCard(p.card)
      show({ ...p.card, status: 'saved' })
      return res
    }
    if (name === 'flow_list') return runTool(name, args, folder)
    if (isPhoneTool(name) && !isNative) return '出错了：只有安卓 App 里才能操作手机或运行 Flow'
    if (name === 'flow_run') {
      const f = loadFlows().find(x => x.id === args.id || x.name === args.id)
      const card: ChatCard = { id: uid(), kind: 'run', op: 'run', title: '运行 Flow', name: f?.name || String(args.id), sub: f?.app, app: f?.app, pkg: f?.pkg, fields: [], status: 'running', before: null, after: f ? { id: f.id } : null }
      if (f) show(card)
      const out = await runTool(name, args, folder)
      if (f) show({ ...card, status: /^Flow\s*「[^」]*」完成/.test(out) ? 'done' : 'failed', note: out.split('\n')[0].replace(/^Flow\s*/, '').replace(/。$/, '') })
      return out
    }
    return runTool(name, args, folder)
  }
  /** 工具循环：模型要调用工具就执行，把结果喂回去，直到给出最终回答（最多 30 步）。 */
  const agentLoop = async (base: Msg[], system?: string) => {
    const tools = toolSpecs(toolNames)
    const raw: ApiMsg[] = base.filter(m => !m.media).map(m => ({ role: m.role, content: m.content }))
    const steps: Step[] = []
    takeTrace()
    const t0 = performance.now()
    let first = 0, tok = 0
    try {
      for (let round = 0; round < 30; round++) {
        const r = await streamChat({
          settings, tier, think, messages: base, raw, tools, signal: ctrl.current!.signal, system,
          onDelta: (t, rs) => update(c => ({ ...c, messages: [...base, { role: 'assistant', content: t, reasoning: rs, tier, steps: [...steps] }] })),
        })
        tok += r.promptTokens + r.completionTokens
        if (!first) first = r.firstTokenMs
        if (!r.toolCalls.length) break
        raw.push({ role: 'assistant', content: r.text, tool_calls: r.toolCalls, ...(r.reasoning ? { reasoning_content: r.reasoning } : {}) })
        for (const tc of r.toolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* */ }
          steps.push({ ...toStep(tc.function.name, args, '', true), result: undefined })
          update(c => ({ ...c, messages: [...base, { role: 'assistant', content: r.text, tier, steps: [...steps] }] }))
          if (ctrl.current?.signal.aborted) throw new DOMException('stop', 'AbortError')
          const out = await exec(tc.function.name, args, steps)
          steps[steps.length - 1] = { ...toStep(tc.function.name, args, out, !out.startsWith('出错了') && !/失败|没打开|不能/.test(out.slice(0, 12))), card: steps[steps.length - 1].card }
          raw.push({ role: 'tool', tool_call_id: tc.id, content: out })
          if (/^phone_(tap|open_app|key|swipe|scroll|input)$/.test(tc.function.name)) await new Promise(ok => setTimeout(ok, 700))
        }
        update(c => ({ ...c, messages: [...base, { role: 'assistant', content: '', tier, steps: [...steps] }] }))
      }
      addUsage(0, tok)
      const tr = takeTrace()
      setLast(m => ({ ...m, ms: first, steps: [...steps], thinkMs: m.reasoning ? performance.now() - t0 : undefined, ...(tr.length >= 2 && !steps.some(x => x.name === 'flow_save') ? { trace: tr } : {}) }))
    } catch (e) {
      if ((e as Error).name === 'AbortError') setLast(m => ({ ...m, stopped: true, steps: [...steps] }))
      else setErr(friendly(e))
    } finally { setBusy(false); ctrl.current = null }
  }
  const started = useRef(false)
  useEffect(() => {
    if (pending && !started.current) { started.current = true; const p = pending; clearPending(); send(undefined, p.text, p.gen) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const regen = () => { const m = conv.messages; if (m.length >= 2 && !m[m.length - 1].media) send(m.slice(0, -1)) }
  const patchCard = (i: number, id: string, p: Partial<ChatCard>) => update(c => ({ ...c, messages: c.messages.map((m, j) => j !== i ? m : { ...m, steps: m.steps?.map(st => st.card?.id === id ? { ...st, card: { ...st.card, ...p } } : st) }) }))
  const toggleFav = (i: number) => update(c => ({ ...c, messages: c.messages.map((m, j) => j === i ? { ...m, fav: !m.fav } : m) }))
  const last = conv.messages.length - 1
  const greets = char ? greetings(char, rpUser) : []
  const gi = char && conv.messages.length === 1 ? Math.max(0, greets.indexOf(conv.messages[0].content)) : -1
  const swipe = (d: number) => { const n = (gi + d + greets.length) % greets.length; update(c => ({ ...c, messages: [{ ...c.messages[0], content: greets[n] }] })) }
  const sub = `${MODEL_NAME[tier]}${think ? ' · 深度思考' : ''}${char ? ' · 角色扮演' : ''}${conv.phone ? ' · 手机操控' : ''}${agent ? ' · ' + agent.name : ''}${project ? ' · ' + project.name : ''}`

  return (
    <div className="chat slide-in">
      <div className="scroll" ref={scroller} onScroll={e => {
        const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}>
        <div className="chat-col">
          <div className="chat-pad" />
          {conv.messages.length === 0 && <div className="chat-empty fade">
            {agent ? <><span className={`ag-i big ${agent.tone}`}><Icon n={agent.icon} s={28} w={1.8} /></span><div className="serif greet">{agent.name}</div><div className="t15 dim">{agent.hello}</div></>
              : <><div className="serif greet">今天想聊点什么？</div><div className="t13">{sub}</div></>}
          </div>}
          {conv.messages.map((m, i) => m.role === 'user'
            ? <div key={i} className="u-row fade"><div className="u-bub">{m.content}</div></div>
            : <div key={i} className={`a-msg fade ${char ? 'rp' : ''}`}>
                <div className="a-head">{char ? <><CharAvatar c={char} s={26} />{char.name}</> : <><span className="a-dot" />栖语</>}<span className="model-pill" onClick={onMode}>{m.media ? GEN_LABEL[m.media.kind] : MODEL_NAME[asTier(m.tier || tier)]}</span></div>
                {m.reasoning && <details className="think" open={busy && i === last && !m.content}>
                  <summary><Icon n="down" s={14} w={2.2} />{busy && i === last && !m.content ? '正在深度思考…' : `已深度思考${m.thinkMs ? ` · ${Math.max(1, Math.round(m.thinkMs / 1000))} 秒` : ''}`}</summary>
                  <div>{m.reasoning}</div></details>}
                {m.steps?.length ? <Steps steps={m.steps} live={busy && i === last} /> : null}
                {m.steps?.filter(st => st.card).map(st => <CardView key={st.card!.id} c={st.card!} live={busy && i === last} patch={p => patchCard(i, st.card!.id, p)} />)}
                {m.trace && !busy && <button className="flow-save" onClick={() => { const tr = m.trace; update(c => ({ ...c, messages: c.messages.map((x, j) => j === i ? { ...x, trace: undefined } : x) })); send(undefined, `把刚才这次操作整理成一个 Flow，用 flow_save 保存。去掉多余和失败的步骤，会变的内容（搜索词、地址、商品名等）改成 {参数}，付款或提交、发送的步骤加 confirm。实际执行过的步骤：\n${JSON.stringify(tr)}`) }}>
                  <Icon n="bolt" s={15} w={2} />存成 Flow，下次一键运行</button>}
                <div className="a-body">{m.media ? <MediaView m={m.media} /> : char ? <RpView src={runRegex(m.content, char, 'ai', 'display', rpUser)} streaming={busy && i === last} /> : <Markdown src={m.content} streaming={busy && i === last} onAction={s => !busy && send(undefined, s, 'chat')} />}
                  {busy && i === last && !m.media && !m.content && !m.reasoning && <span className="caret" />}</div>
                {gi >= 0 && i === 0 && greets.length > 1 && <div className="swipe"><button onClick={() => swipe(-1)} aria-label="上一个开场"><Icon n="left" s={16} w={2.2} /></button>
                  <span className="mono t12">开场 {gi + 1}/{greets.length}</span><button onClick={() => swipe(1)} aria-label="下一个开场"><Icon n="right" s={16} w={2.2} /></button></div>}
                {m.stopped && !(busy && i === last) && <div className="stopped t13">已停止生成</div>}
                {!(busy && i === last) && (m.content || m.stopped || m.media?.status === 'done') && (
                  <div className="acts">
                    {!m.media && m.content && <button aria-label="复制" onClick={() => navigator.clipboard?.writeText(m.content)}><Icon n="copy" s={18} w={1.8} /></button>}
                    {i === last && !m.media && <button aria-label="重新回答" onClick={regen}><Icon n="redo" s={18} w={1.8} /></button>}
                    {!m.media && <button aria-label="收藏" className={m.fav ? 'faved' : ''} onClick={() => toggleFav(i)}><Icon n={m.fav ? 'starf' : 'star'} s={18} w={1.8} /></button>}
                    <span className="meta mono">{m.media ? (m.media.kind === 'video' ? settings.videoModel : settings.imageModel) : m.ms ? `首字 ${(m.ms / 1000).toFixed(1)}s` : ''}</span>
                  </div>
                )}
              </div>)}
          {err && <div className="err">{err}</div>}
          <div className="composer-pad" />
        </div>
      </div>
      <div className="edge-top" />
      <Glass className="chat-bar" radius={26}>
        <div className="cb-t" onClick={onMode}><div className="ell b">{conv.title}</div><div className="cb-sub ell">{sub}<Icon n="down" s={11} w={2.4} /></div></div>
        <button className="cb-btn ring" onClick={onNew} aria-label="新对话"><Icon n="plus" s={20} w={2} /></button>
      </Glass>
      <div className="chat-menu"><GenMenu show={menu} gen={gen} setGen={setGen} onClose={() => setMenu(false)} onMode={onMode} phone={char ? undefined : () => update(c => ({ ...c, phone: !c.phone }))} phoneOn={conv.phone}
        onTask={char || settings.chatCustom === false ? undefined : () => { const v = '按任务生成 Flow：'; setText(v); requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(v.length, v.length) } }) }} /></div>
      <div className="composer">
        <Glass className="c-field" radius={28}>
          <button className={`c-plus ${menu ? 'open' : ''}`} onClick={() => setMenu(v => !v)} aria-label="更多"><Icon n="plus" s={21} w={2} /></button>
          {conv.phone && <button className="gen-chip" onClick={() => update(c => ({ ...c, phone: false }))}><Icon n="phone" s={14} w={2.2} />手机操控<Icon n="x" s={12} w={2.4} /></button>}
          {gen !== 'chat' && <button className="gen-chip" onClick={() => setGen('chat')}><Icon n={gen === 'image' ? 'image' : 'film'} s={14} w={2.2} />{GEN_LABEL[gen]}<Icon n="x" s={12} w={2.4} /></button>}
          <textarea ref={taRef} rows={1} placeholder={gen === 'chat' ? (char ? `回复 ${char.name}…` : conv.messages.length ? '继续追问…' : '和栖语聊聊…') : gen === 'image' ? '描述想要的图片…' : '描述想要的视频…'} value={text}
            onCompositionStart={() => (composing.current = true)} onCompositionEnd={() => (composing.current = false)}
            onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !composing.current && window.innerWidth > 700) { e.preventDefault(); if (!busy) send() } }} />
          {busy
            ? <button className="send stop" onClick={() => ctrl.current?.abort()} aria-label="停止"><Icon n="stop" s={16} c="var(--ink)" /></button>
            : <button className={`send ${text.trim() ? 'on' : ''}`} onClick={() => send()} aria-label="发送"><Icon n="up" s={19} c="#fff" w={2.4} /></button>}
        </Glass>
      </div>
    </div>
  )
}

const EL: Record<Tier, { sym: string; n: number; c: string }> = {
  helium: { sym: 'He', n: 2, c: 'linear-gradient(135deg,#ffc27a,#f59a4a)' },
  neon: { sym: 'Ne', n: 10, c: 'linear-gradient(135deg,#f58a66,#e0583e)' },
  argon: { sym: 'Ar', n: 18, c: 'linear-gradient(135deg,#9a86ff,#6a4be6)' },
}
/** Model badge drawn as a periodic-table tile. */
function El({ t, s = 34 }: { t: Tier; s?: number }) {
  const e = EL[t] || EL.neon
  return <span className="el" style={{ width: s, height: s, background: e.c, fontSize: s * 0.42 }}>{s >= 30 && <i style={{ fontSize: s * 0.22 }}>{e.n}</i>}{e.sym}</span>
}
const asTier = (t: string | null | undefined): Tier => (t === 'helium' || t === 'neon' || t === 'argon' ? t : t === 'fast' ? 'argon' : 'neon')

/* ---------------- mode sheet */
function usageOf(gu: GatewayUsage | null) {
  const sub = gu?.subscription
  const limit = sub?.monthly_limit_usd || sub?.weekly_limit_usd || sub?.daily_limit_usd || 0
  const used = sub ? (sub.monthly_limit_usd ? sub.monthly_usage_usd : sub.weekly_limit_usd ? sub.weekly_usage_usd : sub.daily_usage_usd) : 0
  const win = sub?.monthly_limit_usd ? '本月' : sub?.weekly_limit_usd ? '本周' : '今日'
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const exp = sub?.expires_at ? new Date(sub.expires_at) : null
  const tokens = gu?.daily_usage?.reduce((a, d) => a + d.total_tokens, 0) || 0
  return { limit, used, win, pct, exp, tokens }
}
const fmtTok = (n: number) => n >= 1e4 ? `${+(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万` : n.toLocaleString()

function ModeSheet({ show, onClose, tier, setTier, think, setThink, plan, gu, onPlans, onUpgrade }: {
  show: boolean; onClose: () => void; tier: Tier; setTier: (t: Tier) => void; think: boolean; setThink: (b: boolean) => void
  plan: string | null; gu: GatewayUsage | null; onPlans: () => void; onUpgrade: () => void
}) {
  const [seg, setSeg] = useState<0 | 1>(0)
  const [pick, setPick] = useState<Tier>(tier)
  useEffect(() => { if (show) setPick(tier) }, [show, tier])
  const u = usageOf(gu)
  return (
    <div className={`sheet-wrap ${show ? 'show' : ''}`}>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="grabber" />
        <h3 className="serif">选择模式</h3>
        <p className="t13 sh-sub">三个模型都含在会员里，用量按套餐额度扣减</p>
        <div className="acct">
          <div><div className="t12">当前套餐</div><div className="acct-n serif">{plan || 'Free'}</div>
            <div className="t12">{u.limit ? `${u.win}已用 ${u.pct.toFixed(0)}%` : gu ? '还没有订阅' : '未连接网关'}{u.tokens ? ` · 近 14 天 ${fmtTok(u.tokens)} tokens` : ''}</div></div>
          <button className="acct-btn" onClick={plan ? onPlans : onUpgrade}>{plan ? '套餐' : '订阅'}</button>
        </div>
        <div className="seg2" style={{ ['--i' as string]: seg }}><span className="seg2-thumb" />
          <button className={seg === 0 ? 'on' : ''} onClick={() => setSeg(0)}>对话模型</button>
          <button className={seg === 1 ? 'on' : ''} onClick={() => setSeg(1)}>深度思考</button></div>
        {seg === 0 ? <div className="models">{MODELS.map(m => (
          <button key={m.id} className={`model ${pick === m.id ? 'on' : ''}`} onClick={() => setPick(m.id)}>
            <El t={m.id} s={44} />
            <div className="grow"><div className="m-n">{m.name}</div><div className="t13">{m.desc}</div></div>
            <span className="iq">{[1, 2, 3].map(i => <b key={i} className={i <= m.iq ? 'on' : ''} />)}</span>
            <span className={`radio ${pick === m.id ? 'on' : ''}`} />
          </button>))}</div>
          : <div className="models">
            <button className={`model ${!think ? 'on' : ''}`} onClick={() => setThink(false)}><span className="ag-i coral"><Icon n="bolt" s={20} w={2} /></span>
              <div className="grow"><div className="m-n">直接回答</div><div className="t13">首字更快，适合日常</div></div><span className={`radio ${!think ? 'on' : ''}`} /></button>
            <button className={`model ${think ? 'on' : ''}`} onClick={() => setThink(true)}><span className="ag-i plum"><Icon n="spark" s={20} w={2} /></span>
              <div className="grow"><div className="m-n">深度思考</div><div className="t13">先想再答，展示思考过程</div></div><span className={`radio ${think ? 'on' : ''}`} /></button>
          </div>}
        <button className="dark-btn" onClick={() => { setTier(pick); onClose() }}>使用 {MODEL_NAME[pick]}{think ? ' · 深度思考' : ''}</button>
      </div>
    </div>
  )
}

function Toggle({ on, set }: { on: boolean; set: (b: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on}><span /></button>
}

/* ---------------- 会员. Live data from Sub2API GET /v1/usage. */
function Wallet({ settings, gu, onSettings }: { settings: Settings; gu: GatewayUsage | null; onSettings: () => void }) {
  const local = useMemo(loadUsage, [])
  const days = useMemo(() => {
    const out: { day: string; tokens: number; requests: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const g = gu?.daily_usage?.find(x => x.date.slice(0, 10) === key)
      const l = local.find(x => x.day === d.toISOString().slice(0, 10))
      out.push({ day: key, tokens: g ? g.total_tokens : gu ? 0 : l?.tokens || 0, requests: g?.requests || 0 })
    }
    return out
  }, [gu, local])
  const [sel, setSel] = useState(13)
  const max = Math.max(...days.map(d => d.tokens), 1)
  const plan = gu?.planName || null
  const u = usageOf(gu)
  const connected = !!(settings.baseUrl && settings.apiKey)
  const buy = () => { const url = purchasePage(settings); if (url) openLink(url); else onSettings() }
  const ledger = [...days].reverse().filter(d => d.tokens > 0).slice(0, 8)
  const total = days.reduce((a, d) => a + d.tokens, 0)
  return (
    <section className="fade">
      <div className="acct big">
        <div className="grow">
          <div className="t12">{plan ? '当前套餐' : gu ? '还没有订阅' : connected ? '读取中…' : '未连接网关'}</div>
          <div className="acct-n serif">{plan || 'Free'}</div>
          {u.limit > 0 && <div className="meter"><div style={{ width: `${u.pct}%` }} /></div>}
          <div className="t12">{u.limit > 0 ? `${u.win}已用 ${u.pct.toFixed(0)}%` : connected ? '订阅后即可使用三个模型' : '先到设置填写网关和 API Key'}{u.exp ? ` · ${u.exp.getMonth() + 1}月${u.exp.getDate()}日到期` : ''}</div>
        </div>
        <button className="acct-btn" onClick={connected ? buy : onSettings}>{connected ? (plan ? '续费' : '订阅') : '去设置'}</button>
      </div>

      <div className="sec">订阅套餐</div>
      <div className="plan-rows">
        {PLANS.map(p => {
          const cur = plan?.toLowerCase() === p.id.toLowerCase()
          return (
            <div key={p.id} className={`plan-row ${p.id.toLowerCase()} ${cur ? 'cur' : ''}`}>
              <div className="grow">
                <div className="pr-n serif">{p.id}{cur ? <span className="plan-tag cur">当前</span> : p.id === 'Max' && <span className="plan-tag">推荐</span>}</div>
                <div className="pr-d">{p.perks.join(' · ')}</div>
              </div>
              <div className="pr-r"><div className="pr-p"><small>¥</small>{p.price}<span>/月</span></div>
                <button className="plan-btn" onClick={buy}>{cur ? '续费' : !plan || PLANS.findIndex(x => x.id.toLowerCase() === plan.toLowerCase()) < 0 ? '订阅' : PLANS.findIndex(x => x.id.toLowerCase() === plan.toLowerCase()) < PLANS.indexOf(p) ? '升级' : '切换'}</button></div>
            </div>)
        })}
      </div>

      <div className="sec">近 14 天 · {fmtTok(total)} tokens</div>
      <div className="w-box chart">
        <div className="w-chart-h"><div><div className="t12">{days[sel].day.slice(5).replace('-', '月')}日</div><b>{days[sel].tokens.toLocaleString()}<small className="t12"> tokens</small></b></div>
          <span className="t12">{gu ? `${days[sel].requests} 次请求` : '本机记录'}</span></div>
        <div className="bars">{days.map((d, i) => <button key={d.day} className={`bar ${i === sel ? 'now' : ''}`} onClick={() => setSel(i)} style={{ height: `${8 + (d.tokens / max) * 92}%`, animationDelay: `${i * 30}ms` }} />)}</div>
        <div className="t12 chart-x"><span>{days[0].day.slice(5)}</span><span>今天</span></div>
      </div>

      <div className="sec">用量记录</div>
      {ledger.length === 0 ? <div className="empty">还没有用量</div> : (
        <div className="list">{ledger.map(d => (
          <div key={d.day} className="row"><span className="ico"><Icon n="chat" s={16} w={2} /></span>
            <div className="grow"><div className="t15">{d.day}</div><div className="t12">{d.requests ? `${d.requests} 次请求` : '对话'}</div></div><b className="t15">{d.tokens.toLocaleString()}<small className="t12"> tokens</small></b></div>))}
        </div>)}
      <div className="t12 foot">订阅与支付在 platform.qigai.tech 完成，额度以网关为准</div>
    </section>
  )
}

async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1440 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.85))
}

/* ---------------- 设置 */
function SettingsPage({ s, set, plan, onWall }: { s: Settings; set: (s: Settings) => void; plan: string | null; onWall: (v: number) => void }) {
  const f = (k: keyof Settings, label: string, icon: string, ph = '', type = 'text') => (
    <label className="row field">
      <span className="ico"><Icon n={icon} s={16} w={2} /></span>
      <span className="t16 lbl">{label}</span>
      <input type={type} value={String(s[k])} placeholder={ph}
        onChange={e => set({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
    </label>
  )
  const file = useRef<HTMLInputElement>(null)
  const [adv, setAdv] = useState(false)
  const kp = keyPage(s)
  const ok = !!(s.baseUrl && s.apiKey)
  let host = ''
  try { host = s.baseUrl ? new URL(s.baseUrl).host : '' } catch { host = s.baseUrl }
  return (
    <section className="fade">
      <div className={`status ${ok ? 'ok' : ''}`}>
        <span className="st-dot" />
        <div className="grow"><div className="t16 b">{ok ? '已连接网关' : '还没连接网关'}</div><div className="t13 ell">{ok ? `${host}${plan ? ' · ' + plan : ''}` : '填写网关地址和 API Key 后即可开始'}</div></div>
      </div>
      <div className="sec">账号</div>
      <div className="list">{f('baseUrl', '网关', 'link', 'https://你的网关')}{f('apiKey', 'API Key', 'key', 'sk-…', 'password')}</div>
      <div className="key-link">
        <a href={kp} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); openLink(kp) }}>获取密钥<Icon n="up" s={12} w={2.4} /></a>
      </div>
      <div className="sec">角色扮演</div>
      <div className="list">{f('rpUser', '我的名字', 'users', '用户（角色卡里的 {{user}}）')}
        <div className="row"><span className="ico"><Icon n="globe" s={16} w={2} /></span>
          <div className="grow"><div className="t16">用我的语言回复</div><div className="t13">英文角色卡也用中文聊</div></div>
          <Toggle on={s.rpMyLang !== false} set={b => set({ ...s, rpMyLang: b })} /></div></div>
      <div className="sec">对话</div>
      <div className="list">
        <div className="row"><span className="ico"><Icon n="spark" s={16} w={2} /></span>
          <div className="grow"><div className="t16">卡片式回答</div><div className="t13">数据、步骤、对比用界面卡片展示</div></div>
          <Toggle on={s.genUI} set={b => set({ ...s, genUI: b })} /></div>
        <div className="row"><span className="ico"><Icon n="bolt" s={16} w={2} /></span>
          <div className="grow"><div className="t16">在对话里定制</div><div className="t13">说一句就能新建技能、MCP、Flow，保存前弹确认卡</div></div>
          <Toggle on={s.chatCustom !== false} set={b => set({ ...s, chatCustom: b })} /></div>
      </div>
      <div className="sec">外观</div>
      <div className="list">
        <div className="row">
          <span className="ico"><Icon n="image" s={16} w={2} /></span>
          <span className="t16">主题</span>
          <div className="mini-seg">
            <button className={s.theme === 'peach' ? 'on' : ''} onClick={() => set({ ...s, theme: 'peach' })}>橙白</button>
            <button className={s.theme === 'wallpaper' ? 'on' : ''} onClick={() => set({ ...s, theme: 'wallpaper' })}>壁纸</button>
          </div>
        </div>
        {s.theme === 'wallpaper' && <button className="row press-row" onClick={() => file.current?.click()}>
          <span className="ico"><Icon n="plus" s={16} w={2.2} /></span>
          <span className="t16">选择壁纸图片</span><span className="t13" style={{ marginLeft: 'auto' }}>仅存本机</span></button>}
        <input ref={file} type="file" accept="image/*" hidden onChange={async e => {
          const fl = e.target.files?.[0]; if (!fl) return
          const v = Date.now(); await putBlob('wallpaper:' + v, await shrinkImage(fl)); onWall(v); e.target.value = ''
        }} />
      </div>
      <div className="sec">会员与帮助</div>
      <div className="list">
        <button className="row press-row" onClick={() => openLink(purchasePage(s))}><span className="ico"><Icon n="crown" s={16} w={2} /></span><span className="t16 grow">升级会员</span><span className="t13">{plan || 'Pro / Max / Ultra'}</span><span className="ext-ic"><Icon n="up" s={12} w={2.4} /></span></button>
        <button className="row press-row" onClick={() => openLink(feedbackPage())}><span className="ico"><Icon n="chat" s={16} w={2} /></span><span className="t16 grow">提交反馈</span><span className="ext-ic"><Icon n="up" s={12} w={2.4} /></span></button>
        <button className="row press-row" onClick={() => openLink(PLATFORM_URL)}><span className="ico"><Icon n="globe" s={16} w={2} /></span><span className="t16 grow">官网</span><span className="t13">platform.qigai.tech</span><span className="ext-ic"><Icon n="up" s={12} w={2.4} /></span></button>
      </div>
      <button className="adv-toggle" onClick={() => setAdv(v => !v)}>高级设置<Icon n="down" s={14} w={2.2} /></button>
      {adv && <>
        <div className="sec">图片与视频生成</div>
        <div className="list">{f('mediaBaseUrl', '地址', 'link', '留空则同网关')}{f('mediaKey', 'Key', 'key', '留空则同上', 'password')}
          {f('imageModel', '图片模型', 'image')}{f('imageSize', '图片尺寸', 'image', '1024x1024')}{f('videoModel', '视频模型', 'film')}{f('videoSeconds', '视频秒数', 'film', '4', 'number')}</div>
        <div className="sec">页面地址</div>
        <div className="list">{f('keyUrl', '获取密钥', 'key', '默认 platform.qigai.tech/keys')}{f('purchaseUrl', '订阅页', 'wallet', '默认 platform.qigai.tech/upgrade')}</div>
      </>}
      <div className="t12 foot">Key 只保存在本机 · 栖语 Lumi v0.20 · 开源 MIT</div>
    </section>
  )
}
