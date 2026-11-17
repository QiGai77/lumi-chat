import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass } from './glass'
import { GlassIcon, Icon } from './icons'
import { MODEL_NAME, MODELS, PLANS, fetchUsage, generateImage, generateVideo, keyPage, loadSettings, purchasePage, saveSettings, streamChat, type GatewayUsage, type Media, type Msg, type Settings, type Tier } from './api'
import { Markdown } from './md/Markdown'
import { GENUI_PROMPT } from './genui'
import { blobUrl, putBlob } from './media'
import { addUsage, loadConvs, loadUsage, saveConvs, uid, when, type Conv } from './store'
import { AGENTS, agentById, type Agent } from './agents'
import { RpView } from './rp'
import { blankChar, charById, greetings, macros, runRegex, importFile, importLink, loadChars, rpSystem, saveChars, type Character } from './chara'
import { isDue, loadMcp, loadProjects, loadTasks, probeMcp, saveMcp, saveProjects, saveTasks, type McpServer, type Project, type Task } from './extras'

type View = 'home' | 'chars' | `char:${string}` | 'skills' | 'mcp' | 'tasks' | 'projects' | `project:${string}` | 'me' | 'fav' | 'wallet' | 'settings'
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

export default function App() {
  const [view, setView] = useState<View>('home')
  const wide = () => window.innerWidth >= 980
  const [side, setSide] = useState(wide)
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
  const go = (v: View) => { setView(v); setOpenId(null); shut() }
  const openConv = (id: string) => { setOpenId(id); shut() }
  const newChat = (first?: Pending, extra?: { agent?: Agent; project?: string; char?: Character }) => {
    const ch = extra?.char, g = ch ? greetings(ch, settings.rpUser || '用户')[0] : ''
    const c: Conv = { id: uid(), title: ch ? ch.name : extra?.agent ? extra.agent.name : '新对话', tier, updated: Date.now(), messages: g ? [{ role: 'assistant', content: g, tier }] : [], agent: extra?.agent?.id, project: extra?.project, char: ch?.id }
    setConvs(cs => [c, ...cs]); setPending(first && first.text.trim() ? first : null); setOpenId(c.id); shut()
  }
  const update = (id: string, fn: (c: Conv) => Conv) => setConvs(cs => cs.map(c => (c.id === id ? fn(c) : c)))
  const del = (id: string) => { setConvs(cs => cs.filter(c => c.id !== id)); if (openId === id) setOpenId(null) }

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
  const menuBtn = <button className="side-btn press" onClick={() => setSide(true)} aria-label="侧栏"><Icon n="side" s={22} w={1.9} /></button>
  const back = (to: View, title: string) => <div className="sub-head">{menuBtn}<button className="nav-back press" onClick={() => go(to)} aria-label="返回"><Icon n="back" s={20} w={2.2} /></button><span className="sub-title">{title}</span></div>
  const head = (title: string, sub: string, right?: React.ReactNode) => <div className="page-h">{menuBtn}<div className="grow"><h1 className="serif">{title}</h1><p>{sub}</p></div>{right}</div>
  const proj = view.startsWith('project:') ? projects.find(p => 'project:' + p.id === view) : null

  return (
    <div className={`app theme-${settings.theme} ${side ? 'side-open' : ''}`} style={wall ? { ['--wall' as string]: `url(${wall})` } : undefined}>
      <div className="app-bg"><div className="halftone" /></div>
      <Sidebar view={view} go={go} convs={convs} openId={openId} onOpen={openConv} onNew={() => { go('home') }} onDelete={del}
        plan={plan} onClose={() => setSide(false)} />
      <div className="side-scrim" onClick={() => setSide(false)} />
      <main className="main">
        <div className={`page ${open ? 'pushed' : ''}`}>
          <div className="scroll">
            <div className={`wrap ${view === 'home' ? 'wide' : ''}`}>
              {view === 'home' && <><div className="home-top">{menuBtn}</div>
                <Home convs={convs} tier={tier} think={think} setThink={setThink} onMode={() => setSheet(true)}
                  onSend={p => newChat(p)} onOpen={openConv} onDelete={del} /></>}
              {view === 'chars' && <>{head('角色', '和角色卡里的人物沉浸式聊天，支持导入酒馆角色卡')}<CharsPage chars={chars} settings={settings}
                add={c => setChars(cs => [c, ...cs])} onChat={c => newChat(undefined, { char: c })} onEdit={c => go(`char:${c.id}`)} convs={convs} onOpen={openConv} /></>}
              {view.startsWith('char:') && <>{back('chars', editing?.name || '新角色')}<CharEdit key={view} c={editing || { ...blankChar(), id: view.slice(5) }}
                save={c => setChars(cs => cs.some(x => x.id === c.id) ? cs.map(x => x.id === c.id ? c : x) : [c, ...cs])}
                remove={() => { setChars(cs => cs.filter(x => x.id !== view.slice(5))); go('chars') }} onChat={c => newChat(undefined, { char: c })} /></>}
              {view === 'skills' && <>{head('技能', '预设好角色和方法，点开就能用')}<Agents onPick={a => newChat(undefined, { agent: a })} /></>}
              {view === 'mcp' && <>{head('MCP', '连接你的 MCP 服务器（Streamable HTTP）')}<McpPage servers={servers} setServers={setServers} /></>}
              {view === 'tasks' && <>{head('定时任务', '到点自动提问，结果存成一段新对话')}<TasksPage tasks={tasks} setTasks={setTasks} onRun={runTask} onOpen={openConv} /></>}
              {view === 'projects' && <>{head('项目', '把相关对话放在一起，共用一套说明')}<ProjectsPage projects={projects} setProjects={setProjects} convs={convs} onOpen={p => go(`project:${p}`)} /></>}
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
          project={projects.find(p => p.id === open.project)} onMenu={() => setSide(true)} onNew={() => go('home')} onMode={() => setSheet(true)} update={fn => update(open.id, fn)} />}
      </main>
      <ModeSheet show={sheet} onClose={() => setSheet(false)} tier={tier} setTier={setTier} think={think} setThink={setThink}
        plan={plan} gu={gu} onPlans={() => { setSheet(false); go('wallet') }} />
    </div>
  )
}

/* ---------------- sidebar (ChatGPT 式) */
function Sidebar({ view, go, convs, openId, onOpen, onNew, onDelete, plan, onClose }: {
  view: View; go: (v: View) => void; convs: Conv[]; openId: string | null; onOpen: (id: string) => void; onNew: () => void
  onDelete: (id: string) => void; plan: string | null; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = convs.filter(c => !q || c.title.includes(q) || c.messages.some(m => m.content.includes(q)))
  const item = (v: View, icon: string, label: string, tone: string) => (
    <button className={`s-item ${view === v || (v === 'projects' && view.startsWith('project:')) ? 'on' : ''}`} onClick={() => go(v)}><GlassIcon n={icon} tone={tone} s={30} />{label}</button>)
  return (
    <aside className="side">
      <div className="s-head">
        <button className="side-btn" onClick={onClose} aria-label="收起侧栏"><Icon n="side" s={22} w={1.9} /></button>
        <div className="s-search"><Icon n="search" s={15} w={2} /><input placeholder="搜索" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <button className={`s-item new ${view === 'home' && !openId ? 'on' : ''}`} onClick={onNew}><GlassIcon n="compose" tone="coral" s={30} />新建对话</button>
      {item('chars', 'mask', '角色', 'rose')}
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
        {!plan && <span className="up-tag">升级</span>}
      </button>
    </aside>
  )
}

/* ---------------- 我的 */
function MePage({ plan, gu, settings, favCount, go }: { plan: string | null; gu: GatewayUsage | null; settings: Settings; favCount: number; go: (v: View) => void }) {
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
        <button className="acct-btn" onClick={() => go('wallet')}>{plan ? '管理' : '升级'}</button>
      </div>
      <div className="list" style={{ marginTop: 18 }}>
        <button className="row press-row" onClick={() => go('wallet')}><GlassIcon n="crown" tone="gold" s={32} /><span className="t16 grow">升级会员</span><span className="t13">{plan ? plan : 'Pro / Max / Ultra'}</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
        <button className="row press-row" onClick={() => go('fav')}><GlassIcon n="star" tone="coral" s={32} /><span className="t16 grow">收藏</span><span className="t13">{favCount || ''}</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
        <button className="row press-row" onClick={() => go('settings')}><GlassIcon n="gear" tone="slate" s={32} /><span className="t16 grow">设置</span><Icon n="right" s={15} w={2} c="var(--label3)" /></button>
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
function ProjectsPage({ projects, setProjects, convs, onOpen }: { projects: Project[]; setProjects: (f: (p: Project[]) => Project[]) => void; convs: Conv[]; onOpen: (id: string) => void }) {
  const [name, setName] = useState<string | null>(null)
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
function GenMenu({ show, gen, setGen, onClose, onMode }: { show: boolean; gen: Gen; setGen: (g: Gen) => void; onClose: () => void; onMode: () => void }) {
  return <>
    {show && <div className="gen-scrim" onClick={onClose} />}
    <div className={`gen-menu ${show ? 'show' : ''}`}>
      {(['chat', 'image', 'video'] as Gen[]).map(g => (
        <button key={g} className={gen === g ? 'on' : ''} onClick={() => { setGen(g); onClose() }}>
          <span className="gi"><Icon n={g === 'chat' ? 'chat' : g === 'image' ? 'image' : 'film'} s={18} w={2} /></span>{GEN_LABEL[g]}
          {gen === g && <Icon n="check" s={16} w={2.4} />}
        </button>))}
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
          <button className={`chip ${think ? 'on' : ''}`} onClick={() => setThink(!think)}><Icon n="spark" s={14} w={2.2} />深度思考</button>
          <button className={`send big ${text.trim() ? 'on' : ''}`} onClick={go} aria-label="发送"><Icon n="up" s={20} c="#fff" w={2.4} /></button>
        </div>
        <div className="home-menu"><GenMenu show={menu} gen={gen} setGen={setGen} onClose={() => setMenu(false)} onMode={onMode} /></div>
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

function Agents({ onPick }: { onPick: (a: Agent) => void }) {
  return (
    <section className="fade">
      <div className="agents">{AGENTS.map(a => (
        <button key={a.id} className={`agent ${a.tone} press-row`} onClick={() => onPick(a)}>
          <span className="ag-i"><Icon n={a.icon} s={22} w={1.9} /></span>
          <div className="grow"><div className="ag-n">{a.name}</div><div className="t13">{a.desc}</div></div>
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

function Chat({ conv, settings, tier, think, pending, clearPending, project, onMenu, onNew, onMode, update }: {
  conv: Conv; settings: Settings; tier: Tier; think: boolean; pending: Pending | null; clearPending: () => void; project?: Project
  onMenu: () => void; onNew: () => void; onMode: () => void; update: (fn: (c: Conv) => Conv) => void
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
  const agent = agentById(conv.agent)
  const char = charById(conv.char)
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
    const system = char ? rpSystem(char, rpUser, base, settings.rpMyLang !== false) : [agent?.prompt, project?.instructions ? `项目「${project.name}」的说明：\n${project.instructions}` : '', settings.genUI ? GENUI_PROMPT : ''].filter(Boolean).join('\n\n') || undefined
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
  const started = useRef(false)
  useEffect(() => {
    if (pending && !started.current) { started.current = true; const p = pending; clearPending(); send(undefined, p.text, p.gen) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const regen = () => { const m = conv.messages; if (m.length >= 2 && !m[m.length - 1].media) send(m.slice(0, -1)) }
  const toggleFav = (i: number) => update(c => ({ ...c, messages: c.messages.map((m, j) => j === i ? { ...m, fav: !m.fav } : m) }))
  const last = conv.messages.length - 1
  const greets = char ? greetings(char, rpUser) : []
  const gi = char && conv.messages.length === 1 ? Math.max(0, greets.indexOf(conv.messages[0].content)) : -1
  const swipe = (d: number) => { const n = (gi + d + greets.length) % greets.length; update(c => ({ ...c, messages: [{ ...c.messages[0], content: greets[n] }] })) }
  const sub = `${MODEL_NAME[tier]}${think ? ' · 深度思考' : ''}${char ? ' · 角色扮演' : ''}${agent ? ' · ' + agent.name : ''}${project ? ' · ' + project.name : ''}`

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
        <button className="cb-btn cb-side" onClick={onMenu} aria-label="侧栏"><Icon n="side" s={22} w={1.9} /></button>
        <div className="cb-t" onClick={onMode}><div className="ell b">{conv.title}</div><div className="cb-sub ell">{sub}<Icon n="down" s={11} w={2.4} /></div></div>
        <button className="cb-btn ring" onClick={onNew} aria-label="新对话"><Icon n="plus" s={20} w={2} /></button>
      </Glass>
      <div className="chat-menu"><GenMenu show={menu} gen={gen} setGen={setGen} onClose={() => setMenu(false)} onMode={onMode} /></div>
      <div className="composer">
        <Glass className="c-field" radius={28}>
          <button className={`c-plus ${menu ? 'open' : ''}`} onClick={() => setMenu(v => !v)} aria-label="更多"><Icon n="plus" s={21} w={2} /></button>
          {gen !== 'chat' && <button className="gen-chip" onClick={() => setGen('chat')}><Icon n={gen === 'image' ? 'image' : 'film'} s={14} w={2.2} />{GEN_LABEL[gen]}<Icon n="x" s={12} w={2.4} /></button>}
          <textarea rows={1} placeholder={gen === 'chat' ? (char ? `回复 ${char.name}…` : conv.messages.length ? '继续追问…' : '和栖语聊聊…') : gen === 'image' ? '描述想要的图片…' : '描述想要的视频…'} value={text}
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

function ModeSheet({ show, onClose, tier, setTier, think, setThink, plan, gu, onPlans }: {
  show: boolean; onClose: () => void; tier: Tier; setTier: (t: Tier) => void; think: boolean; setThink: (b: boolean) => void
  plan: string | null; gu: GatewayUsage | null; onPlans: () => void
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
          <button className="acct-btn" onClick={onPlans}>{plan ? '套餐' : '订阅'}</button>
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
  const buy = () => { const url = purchasePage(settings); if (url) window.open(url, '_blank'); else onSettings() }
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
      <div className="t12 foot">订阅与支付在网关的用户中心完成，额度以网关为准</div>
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
        {kp ? <a href={kp} target="_blank" rel="noreferrer">获取密钥<Icon n="up" s={12} w={2.4} /></a> : <span className="t13">填写网关后可直接跳转获取密钥</span>}
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
      <button className="adv-toggle" onClick={() => setAdv(v => !v)}>高级设置<Icon n="down" s={14} w={2.2} /></button>
      {adv && <>
        <div className="sec">图片与视频生成</div>
        <div className="list">{f('mediaBaseUrl', '地址', 'link', '留空则同网关')}{f('mediaKey', 'Key', 'key', '留空则同上', 'password')}
          {f('imageModel', '图片模型', 'image')}{f('imageSize', '图片尺寸', 'image', '1024x1024')}{f('videoModel', '视频模型', 'film')}{f('videoSeconds', '视频秒数', 'film', '4', 'number')}</div>
        <div className="sec">页面地址</div>
        <div className="list">{f('keyUrl', '获取密钥', 'key', '默认 网关/keys')}{f('purchaseUrl', '订阅页', 'wallet', '默认 网关/purchase')}</div>
      </>}
      <div className="t12 foot">Key 只保存在本机 · 栖语 Lumi v0.11 · 开源 MIT</div>
    </section>
  )
}
