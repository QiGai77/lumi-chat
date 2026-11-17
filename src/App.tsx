import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass } from './glass'
import { Icon } from './icons'
import { MODEL_NAME, MODELS, PLANS, fetchUsage, generateImage, generateVideo, keyPage, loadSettings, purchasePage, saveSettings, streamChat, type GatewayUsage, type Media, type Msg, type Settings, type Tier } from './api'
import { Markdown } from './md/Markdown'
import { GENUI_PROMPT } from './genui'
import { blobUrl, putBlob } from './media'
import { addUsage, loadConvs, loadUsage, saveConvs, uid, when, type Conv } from './store'
import { AGENTS, agentById, type Agent } from './agents'

type Tab = 'chat' | 'fav' | 'agents' | 'wallet' | 'settings'
type Gen = 'chat' | 'image' | 'video'
const GEN_LABEL: Record<Gen, string> = { chat: '对话', image: '生成图片', video: '生成视频' }
const NAV: [Tab, string][] = [['chat', '对话'], ['fav', '收藏'], ['agents', '智能体'], ['wallet', '会员']]
const QUICK: [string, string][] = [
  ['润色文字', '帮我把这段文字改得更简洁专业：\n'], ['解释代码', '解释下面这段代码在做什么：\n'], ['旅行计划', '帮我做一个两日游计划，目的地：'],
  ['读论文', '帮我精读这篇论文，按问题、方法、结论拆解：\n'], ['写周报', '把下面的记录整理成周报：\n'],
]
const greeting = () => { const h = new Date().getHours(); return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好' }
const USER_NAME = 'Qi'

interface Pending { text: string; gen: Gen }

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [convs, setConvs] = useState<Conv[]>(loadConvs)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [tier, setTier] = useState<Tier>(() => asTier(localStorage.getItem('lumi.tier')))
  const [think, setThink] = useState(() => localStorage.getItem('lumi.think') === '1')
  const [sheet, setSheet] = useState(false)
  const [gu, setGu] = useState<GatewayUsage | null>(null)
  useEffect(() => saveConvs(convs), [convs])
  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => localStorage.setItem('lumi.tier', tier), [tier])
  useEffect(() => localStorage.setItem('lumi.think', think ? '1' : '0'), [think])
  useEffect(() => {
    const c = new AbortController()
    fetchUsage(settings, c.signal).then(setGu).catch(() => setGu(null))
    return () => c.abort()
  }, [settings.baseUrl, settings.apiKey])

  const open = convs.find(c => c.id === openId) || null
  const newChat = (first?: Pending, agent?: Agent) => {
    const c: Conv = { id: uid(), title: agent ? agent.name : '新对话', tier, updated: Date.now(), messages: [], agent: agent?.id }
    setConvs(cs => [c, ...cs]); setPending(first && first.text.trim() ? first : null); setOpenId(c.id)
  }
  const update = (id: string, fn: (c: Conv) => Conv) => setConvs(cs => cs.map(c => (c.id === id ? fn(c) : c)))
  const del = (id: string) => setConvs(cs => cs.filter(c => c.id !== id))

  const [wall, setWall] = useState<string | null>(null)
  const [wallVer, setWallVer] = useState(() => Number(localStorage.getItem('lumi.wallVer') || 0))
  useEffect(() => { if (settings.theme === 'wallpaper') blobUrl('wallpaper:' + wallVer).then(u => setWall(u)); else setWall(null) }, [settings.theme, wallVer])
  const plan = gu?.planName || null

  return (
    <div className={`app theme-${settings.theme}`} style={wall ? { ['--wall' as string]: `url(${wall})` } : undefined}>
      <div className="app-bg"><div className="halftone" /></div>
      <div className={`page ${open ? 'pushed' : ''}`}>
        <div className="scroll">
          <div className={`wrap ${tab === 'chat' ? 'wide' : ''}`}>
            {tab === 'settings'
              ? <div className="sub-head"><Glass className="nav-btn-s press" onClick={() => setTab('chat')}><Icon n="back" s={20} w={2.2} /></Glass><span className="sub-title">设置</span></div>
              : <TopBar tab={tab} setTab={setTab} />}
            {tab === 'chat' && <Home convs={convs} tier={tier} think={think} setThink={setThink} onMode={() => setSheet(true)}
              onSend={p => newChat(p)} onOpen={setOpenId} onDelete={del} />}
            {tab === 'fav' && <Favs convs={convs} onOpen={setOpenId} onUnfav={(cid, i) => update(cid, c => ({ ...c, messages: c.messages.map((m, j) => j === i ? { ...m, fav: false } : m) }))} />}
            {tab === 'agents' && <Agents onPick={a => newChat(undefined, a)} />}
            {tab === 'wallet' && <Wallet settings={settings} gu={gu} onSettings={() => setTab('settings')} />}
            {tab === 'settings' && <SettingsPage s={settings} set={setSettings} plan={plan} onWall={v => { localStorage.setItem('lumi.wallVer', String(v)); setWallVer(v) }} />}
            <div className="bottom-pad" />
          </div>
        </div>
      </div>
      {open && <Chat key={open.id} conv={open} settings={settings} tier={tier} think={think} pending={pending} clearPending={() => setPending(null)}
        onBack={() => setOpenId(null)} onNew={() => newChat()} onMode={() => setSheet(true)} update={fn => update(open.id, fn)} />}
      <ModeSheet show={sheet} onClose={() => setSheet(false)} tier={tier} setTier={setTier} think={think} setThink={setThink}
        plan={plan} gu={gu} onPlans={() => { setSheet(false); setOpenId(null); setTab('wallet') }} />
    </div>
  )
}

/* ---------------- top bar + pill nav */
function TopBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const idx = NAV.findIndex(n => n[0] === tab)
  return (
    <header className="top">
      <div className="brand"><span className="logo">栖</span><b>栖语</b><span className="brand-en">Lumi</span></div>
      <nav className="pill-nav" style={{ ['--i' as string]: idx, ['--n' as string]: NAV.length }}>
        {idx >= 0 && <span className="pill-ind" />}
        {NAV.map(([t, l]) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </nav>
      <div className="top-r">
        <button className="avatar press" onClick={() => setTab('settings')} aria-label="设置">{USER_NAME[0]}</button>
      </div>
    </header>
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
      <div className="page-h"><h1 className="serif">收藏</h1><p>回答下方点星标，好答案就留在这里。</p></div>
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
function Agents({ onPick }: { onPick: (a: Agent) => void }) {
  return (
    <section className="fade">
      <div className="page-h"><h1 className="serif">智能体</h1><p>预设好角色和方法，点开就能用。</p></div>
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

function Chat({ conv, settings, tier, think, pending, clearPending, onBack, onNew, onMode, update }: {
  conv: Conv; settings: Settings; tier: Tier; think: boolean; pending: Pending | null; clearPending: () => void
  onBack: () => void; onNew: () => void; onMode: () => void; update: (fn: (c: Conv) => Conv) => void
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
    const system = [agent?.prompt, settings.genUI ? GENUI_PROMPT : ''].filter(Boolean).join('\n\n') || undefined
    try {
      const r = await streamChat({
        settings, tier, think, messages: base, signal: ctrl.current.signal, system,
        onDelta: (t, rs) => {
          if (rs && t && !thinkMs) thinkMs = performance.now() - t0
          update(c => ({ ...c, messages: [...base, { role: 'assistant', content: t, reasoning: rs, tier, thinkMs: thinkMs || undefined }] }))
        },
      })
      addUsage(0, r.completionTokens + r.promptTokens)
      setLast(m => ({ ...m, ms: r.firstTokenMs, thinkMs: m.reasoning && !m.thinkMs ? performance.now() - t0 : m.thinkMs }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message || String(e))
    } finally { setBusy(false); ctrl.current = null }
  }
  const started = useRef(false)
  useEffect(() => {
    if (pending && !started.current) { started.current = true; const p = pending; clearPending(); send(undefined, p.text, p.gen) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const regen = () => { const m = conv.messages; if (m.length >= 2 && !m[m.length - 1].media) send(m.slice(0, -1)) }
  const toggleFav = (i: number) => update(c => ({ ...c, messages: c.messages.map((m, j) => j === i ? { ...m, fav: !m.fav } : m) }))
  const last = conv.messages.length - 1
  const sub = `${MODEL_NAME[tier]}${think ? ' · 深度思考' : ''}${agent ? ' · ' + agent.name : ''}`

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
            : <div key={i} className="a-msg fade">
                <div className="a-head"><span className="a-dot" />栖语<span className="model-pill" onClick={onMode}>{m.media ? GEN_LABEL[m.media.kind] : MODEL_NAME[asTier(m.tier || tier)]}</span></div>
                {m.reasoning && <details className="think" open={busy && i === last && !m.content}>
                  <summary><Icon n="down" s={14} w={2.2} />{busy && i === last && !m.content ? '正在深度思考…' : `已深度思考${m.thinkMs ? ` · ${Math.max(1, Math.round(m.thinkMs / 1000))} 秒` : ''}`}</summary>
                  <div>{m.reasoning}</div></details>}
                <div className="a-body">{m.media ? <MediaView m={m.media} /> : <Markdown src={m.content} streaming={busy && i === last} onAction={s => !busy && send(undefined, s, 'chat')} />}
                  {busy && i === last && !m.media && !m.content && !m.reasoning && <span className="caret" />}</div>
                {!(busy && i === last) && (m.content || m.media?.status === 'done') && (
                  <div className="acts">
                    {!m.media && <button aria-label="复制" onClick={() => navigator.clipboard?.writeText(m.content)}><Icon n="copy" s={18} w={1.8} /></button>}
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
        <button className="cb-btn" onClick={onBack} aria-label="返回"><Icon n="menu" s={22} w={2} /></button>
        <div className="cb-t" onClick={onMode}><div className="ell b">{conv.title}</div><div className="cb-sub ell">{sub}<Icon n="down" s={11} w={2.4} /></div></div>
        <button className="cb-btn ring" onClick={onNew} aria-label="新对话"><Icon n="plus" s={20} w={2} /></button>
      </Glass>
      <div className="chat-menu"><GenMenu show={menu} gen={gen} setGen={setGen} onClose={() => setMenu(false)} onMode={onMode} /></div>
      <div className="composer">
        <Glass className="c-field" radius={28}>
          <button className={`c-plus ${menu ? 'open' : ''}`} onClick={() => setMenu(v => !v)} aria-label="更多"><Icon n="plus" s={21} w={2} /></button>
          {gen !== 'chat' && <button className="gen-chip" onClick={() => setGen('chat')}><Icon n={gen === 'image' ? 'image' : 'film'} s={14} w={2.2} />{GEN_LABEL[gen]}<Icon n="x" s={12} w={2.4} /></button>}
          <textarea rows={1} placeholder={gen === 'chat' ? (conv.messages.length ? '继续追问…' : '和栖语聊聊…') : gen === 'image' ? '描述想要的图片…' : '描述想要的视频…'} value={text}
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
      <div className="page-h"><h1 className="serif">会员</h1><p>Helium · Neon · Argon 三个模型，按套餐额度使用。</p></div>
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
      <div className="t12 foot">Key 只保存在本机 · 栖语 Lumi v0.9 · 开源 MIT</div>
    </section>
  )
}
