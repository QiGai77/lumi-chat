import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass } from './glass'
import { Icon } from './icons'
import { MODEL_NAME, MODELS, PLANS, fetchUsage, generateImage, generateVideo, keyPage, loadSettings, purchasePage, saveSettings, streamChat, type GatewayUsage, type Media, type Msg, type Settings, type Tier } from './api'
import { Markdown } from './md/Markdown'
import { GENUI_PROMPT } from './genui'
import { blobUrl, putBlob } from './media'
import { addUsage, loadConvs, loadUsage, saveConvs, uid, when, type Conv } from './store'

type Tab = 'chat' | 'wallet' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [convs, setConvs] = useState<Conv[]>(loadConvs)
  const [openId, setOpenId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [tier, setTier] = useState<Tier>(() => asTier(localStorage.getItem('lumi.tier')))
  const [think, setThink] = useState(false)
  const [sheet, setSheet] = useState(false)
  useEffect(() => saveConvs(convs), [convs])
  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => localStorage.setItem('lumi.tier', tier), [tier])

  const open = convs.find(c => c.id === openId) || null
  const newChat = () => {
    const c: Conv = { id: uid(), title: '新对话', tier, updated: Date.now(), messages: [] }
    setConvs(cs => [c, ...cs]); setOpenId(c.id); setTab('chat')
  }
  const update = (id: string, fn: (c: Conv) => Conv) => setConvs(cs => cs.map(c => (c.id === id ? fn(c) : c)))

  const [wall, setWall] = useState<string | null>(null)
  const [wallVer, setWallVer] = useState(0)
  useEffect(() => { if (settings.theme === 'wallpaper') blobUrl('wallpaper:' + wallVer).then(u => setWall(u)); else setWall(null) }, [settings.theme, wallVer])
  useEffect(() => { const v = Number(localStorage.getItem('lumi.wallVer') || 0); setWallVer(v) }, [])
  return (
    <div className={`app theme-${settings.theme}`} style={wall ? { ['--wall' as string]: `url(${wall})` } : undefined}>
      <div className="app-bg" />
      <div className={`page ${open ? 'pushed' : ''}`}>
        {tab === 'chat' && <Home convs={convs} onOpen={setOpenId} onNew={newChat}
          onDelete={id => setConvs(cs => cs.filter(c => c.id !== id))} />}
        {tab === 'wallet' && <Wallet settings={settings} onSettings={() => setTab('settings')} />}
        {tab === 'settings' && <SettingsPage s={settings} set={setSettings} onWall={v => { localStorage.setItem('lumi.wallVer', String(v)); setWallVer(v) }} />}
        <TabBar tab={tab} setTab={setTab} onNew={newChat} />
      </div>
      {open && <Chat conv={open} settings={settings} tier={tier} think={think}
        onBack={() => setOpenId(null)} onMode={() => setSheet(true)} update={fn => update(open.id, fn)} />}
      <ModeSheet show={sheet} onClose={() => setSheet(false)} tier={tier} setTier={setTier} think={think} setThink={setThink} />
    </div>
  )
}

function TabBar({ tab, setTab, onNew }: { tab: Tab; setTab: (t: Tab) => void; onNew: () => void }) {
  const items: [Tab, string, string][] = [['chat', 'chat', '对话'], ['wallet', 'wallet', '会员'], ['settings', 'gear', '设置']]
  const idx = items.findIndex(i => i[0] === tab)
  return (
    <>
      <Glass className="tabbar" style={{ ['--i' as string]: idx }}>
        <div className="tab-ind" />
        {items.map(([t, ic, l]) => (
          <button key={t} className={`tab ${t === tab ? 'on' : ''}`} onClick={() => setTab(t)}>
            <Icon n={ic} s={24} w={t === tab ? 2.1 : 1.9} /><span>{l}</span>
          </button>
        ))}
      </Glass>
      <Glass className="tab-fab press" onClick={onNew}><Icon n="compose" s={24} w={2} /></Glass>
    </>
  )
}

function Home({ convs, onOpen, onNew, onDelete }: { convs: Conv[]; onOpen: (id: string) => void; onNew: () => void; onDelete: (id: string) => void }) {
  const [q, setQ] = useState('')
  const list = convs.filter(c => !q || c.title.includes(q) || c.messages.some(m => m.content.includes(q)))
  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  return (
    <div className="scroll">
      <div className="top-pad" />
      <div className="lt">栖语</div>
      <div className="hero" onClick={onNew}>
        <div className="hero-bg" />
        <div className="hero-txt"><div className="eyebrow">{greet}</div><div className="hero-h">今天想聊点什么？</div></div>
      </div>
      <div className="searchbox"><Icon n="search" s={17} w={2} /><input placeholder="搜索对话" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="sec">最近</div>
      {list.length === 0 ? <div className="empty">还没有对话。点右下角开始。</div> : (
        <div className="list">
          {list.map(c => (
            <div key={c.id} className="row press-row" onClick={() => onOpen(c.id)}>
              <El t={asTier(c.tier)} s={30} />
              <div className="grow"><div className="t17 ell">{c.title}</div><div className="t13">{MODEL_NAME[asTier(c.tier)]} · {when(c.updated)}</div></div>
              <button className="del" onClick={e => { e.stopPropagation(); if (confirm('删除这个对话？')) onDelete(c.id) }}><Icon n="trash" s={18} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="bottom-pad" />
    </div>
  )
}

type Gen = 'chat' | 'image' | 'video'
const GEN_LABEL: Record<Gen, string> = { chat: '对话', image: '生成图片', video: '生成视频' }

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

function Chat({ conv, settings, tier, think, onBack, onMode, update }: {
  conv: Conv; settings: Settings; tier: Tier; think: boolean; onBack: () => void; onMode: () => void; update: (fn: (c: Conv) => Conv) => void
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

  const send = async (override?: Msg[], say?: string) => {
    const content = (say ?? text).trim()
    if (!override && !content) return
    setText(''); setErr(''); setBusy(true); pinned.current = true
    ctrl.current = new AbortController()
    if (!override && !say && gen !== 'chat') { await runMedia(gen, content); setBusy(false); ctrl.current = null; return }
    const base = override ?? [...conv.messages, { role: 'user' as const, content }]
    const title = conv.title === '新对话' ? base[0].content.slice(0, 18) : conv.title
    update(c => ({ ...c, title, tier, updated: Date.now(), messages: [...base, { role: 'assistant', content: '', tier }] }))
    try {
      const r = await streamChat({
        settings, tier, think, messages: base, signal: ctrl.current.signal, system: settings.genUI ? GENUI_PROMPT : undefined,
        onDelta: (t, rs) => update(c => ({ ...c, messages: [...base, { role: 'assistant', content: t, reasoning: rs, tier }] })),
      })
      addUsage(0, r.completionTokens + r.promptTokens)
      setLast(m => ({ ...m, ms: r.firstTokenMs }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message || String(e))
    } finally { setBusy(false); ctrl.current = null }
  }
  const regen = () => { const m = conv.messages; if (m.length >= 2 && !m[m.length - 1].media) send(m.slice(0, -1)) }
  const last = conv.messages.length - 1

  return (
    <div className="chat slide-in">
      <div className="scroll" ref={scroller} onScroll={e => {
        const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}>
        <div className="chat-pad" />
        {conv.messages.length === 0 && <div className="chat-empty"><div className="serif greet">今天想聊点什么？</div><div className="t13">当前：{MODEL_NAME[tier]}{think ? ' · 深度思考' : ''}{settings.genUI ? ' · 智能界面' : ''}</div></div>}
        {conv.messages.map((m, i) => m.role === 'user'
          ? <div key={i} className="u-row fade"><div className="u-bub">{m.content}</div></div>
          : <div key={i} className="a-msg fade">
              {m.reasoning && <details className="think"><summary><Icon n="spark" s={14} c="var(--accent)" w={2} />思考过程</summary><div>{m.reasoning}</div></details>}
              {m.media ? <MediaView m={m.media} /> : <Markdown src={m.content} streaming={busy && i === last} onAction={s => !busy && send(undefined, s)} />}
              {busy && i === last && !m.media && !m.content && <span className="caret" />}
              {!(busy && i === last) && (m.content || m.media?.status === 'done') && (
                <div className="acts">
                  {!m.media && <button onClick={() => navigator.clipboard?.writeText(m.content)}><Icon n="copy" s={18} w={1.8} /></button>}
                  {i === last && !m.media && <button onClick={regen}><Icon n="redo" s={18} w={1.8} /></button>}
                  <span className="t13 meta">{m.media ? (m.media.kind === 'video' ? settings.videoModel : settings.imageModel) : m.tier ? MODEL_NAME[asTier(m.tier)] : ''}{m.ms ? ` · 首字 ${(m.ms / 1000).toFixed(1)}s` : ''}</span>
                </div>
              )}
            </div>)}
        {err && <div className="err">{err}</div>}
        <div className="composer-pad" />
      </div>
      <div className="edge-top" />
      <Glass className="nav-btn left press" onClick={onBack}><Icon n="back" s={22} w={2.2} /></Glass>
      <div className="nav-title" onClick={onMode}>
        <div className="ell">{conv.title}</div>
        <div className="nav-sub"><span className="dot" style={{ background: EL[tier].c }} />{MODEL_NAME[tier]}{think ? ' · 深度思考' : ''} ›</div>
      </div>
      <Glass className="nav-btn right press" onClick={onMode}><Icon n="more" s={22} /></Glass>
      {menu && <div className="gen-scrim" onClick={() => setMenu(false)} />}
      <div className={`gen-menu ${menu ? 'show' : ''}`}>
        {(['chat', 'image', 'video'] as Gen[]).map(g => (
          <button key={g} className={gen === g ? 'on' : ''} onClick={() => { setGen(g); setMenu(false) }}>
            <span className="gi"><Icon n={g === 'chat' ? 'chat' : g === 'image' ? 'image' : 'film'} s={18} w={2} /></span>{GEN_LABEL[g]}
            {gen === g && <Icon n="check" s={16} w={2.4} />}
          </button>))}
        <button onClick={() => { setMenu(false); onMode() }}><span className="gi"><Icon n="spark" s={18} w={2} /></span>回答模式</button>
      </div>
      <div className="composer">
        <Glass className={`c-plus press ${menu ? 'open' : ''}`} onClick={() => setMenu(v => !v)}><Icon n="plus" s={22} w={2} /></Glass>
        <Glass className="c-field" radius={25}>
          {gen !== 'chat' && <button className="gen-chip" onClick={() => setGen('chat')}><Icon n={gen === 'image' ? 'image' : 'film'} s={14} w={2.2} />{GEN_LABEL[gen]}<Icon n="x" s={12} w={2.4} /></button>}
          <textarea rows={1} placeholder={gen === 'chat' ? '和栖语聊聊…' : gen === 'image' ? '描述想要的图片…' : '描述想要的视频…'} value={text}
            onCompositionStart={() => (composing.current = true)} onCompositionEnd={() => (composing.current = false)}
            onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !composing.current && window.innerWidth > 700) { e.preventDefault(); if (!busy) send() } }} />
          {busy
            ? <button className="send stop" onClick={() => ctrl.current?.abort()}><Icon n="stop" s={18} c="#fff" /></button>
            : <button className={`send ${text.trim() ? 'on' : ''}`} onClick={() => send()}><Icon n="up" s={19} c="#fff" w={2.4} /></button>}
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
/** Model badge drawn as a periodic-table tile (增强). */
function El({ t, s = 34 }: { t: Tier; s?: number }) {
  const e = EL[t] || EL.neon
  return <span className="el" style={{ width: s, height: s, background: e.c, fontSize: s * 0.42 }}><i style={{ fontSize: s * 0.22 }}>{e.n}</i>{e.sym}</span>
}
const asTier = (t: string | null | undefined): Tier => (t === 'helium' || t === 'neon' || t === 'argon' ? t : t === 'fast' ? 'argon' : 'neon')

function ModeSheet({ show, onClose, tier, setTier, think, setThink }: {
  show: boolean; onClose: () => void; tier: Tier; setTier: (t: Tier) => void; think: boolean; setThink: (b: boolean) => void
}) {
  return (
    <div className={`sheet-wrap ${show ? 'show' : ''}`}>
      <div className="scrim" onClick={onClose} />
      <Glass variant="dialog" radius={38} className="sheet">
        <div className="grabber" />
        <div className="sheet-head">
          <button className="circle" onClick={onClose}><Icon n="x" s={18} w={2.2} /></button>
          <div className="t17 b">选择模型</div>
          <button className="circle blue" onClick={onClose}><Icon n="check" s={20} c="#fff" w={2.6} /></button>
        </div>
        <div className="models">
          {MODELS.map(m => (
            <button key={m.id} className={`model ${tier === m.id ? 'on' : ''}`} onClick={() => setTier(m.id)}>
              <El t={m.id} s={42} />
              <div className="grow"><div className="t17 b">{m.name}</div><div className="t13">{m.desc}</div></div>
              <span className="iq">{[1, 2, 3].map(i => <b key={i} className={i <= m.iq ? 'on' : ''} />)}</span>
            </button>))}
        </div>
        <div className="list glassy">
          <div className="row"><div className="ico" style={{ background: '#5E5CE6' }}><Icon n="spark" s={17} c="#fff" w={2.2} /></div>
            <div className="grow"><div className="t17">深度思考</div><div className="t13">想得更久，答得更稳</div></div><Toggle on={think} set={setThink} /></div>
        </div>
        <div className="t13 sheet-note">三个模型都包含在会员里，用量按套餐额度计算。</div>
      </Glass>
    </div>
  )
}

function Toggle({ on, set }: { on: boolean; set: (b: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on}><span /></button>
}

/* Membership (was 钱包). Card layout after the Figma community files "InsureTech UI Cards" (Maietry) and
   "100 card design templates UI kit" (Yan Liu), both CC BY 4.0. Live data from Sub2API GET /v1/usage. */
function Wallet({ settings, onSettings }: { settings: Settings; onSettings: () => void }) {
  const local = useMemo(loadUsage, [])
  const [gu, setGu] = useState<GatewayUsage | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const c = new AbortController()
    fetchUsage(settings, c.signal).then(setGu).catch(e => { if (e.name !== 'AbortError') setErr(e.message) })
    return () => c.abort()
  }, [settings])
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
  const sub = gu?.subscription
  const plan = gu?.planName && PLANS.find(p => p.id.toLowerCase() === gu.planName!.toLowerCase()) ? gu.planName : gu?.planName ? gu.planName : null
  const limit = sub?.monthly_limit_usd || sub?.weekly_limit_usd || sub?.daily_limit_usd || 0
  const used = sub ? (sub.monthly_limit_usd ? sub.monthly_usage_usd : sub.weekly_limit_usd ? sub.weekly_usage_usd : sub.daily_usage_usd) : 0
  const win = sub?.monthly_limit_usd ? '本月' : sub?.weekly_limit_usd ? '本周' : '今日'
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const exp = sub?.expires_at ? new Date(sub.expires_at) : null
  const buy = () => { const u = purchasePage(settings); if (u) window.open(u, '_blank'); else onSettings() }
  const ledger = [...days].reverse().filter(d => d.tokens > 0).slice(0, 8)
  return (
    <div className="scroll">
      <div className="top-pad" />
      <div className="lt">会员</div>

      <div className={`w-card plan-${(plan || 'none').toLowerCase()}`}>
        <div className="w-card-glow" />
        <div className="w-row"><span className="w-brand">LUMI</span><span className="w-chip" /></div>
        <div className="w-lbl">{plan ? '当前套餐' : gu ? '还没有订阅' : err ? '未连接网关' : '读取中…'}</div>
        <div className="w-amt">{plan || 'Free'}</div>
        {limit > 0 && <div className="w-meter"><div style={{ width: `${pct}%` }} /></div>}
        <div className="w-row w-foot">
          <span>{limit > 0 ? `${win}已用 ${pct.toFixed(0)}%` : err ? '到「设置」填写网关和 Key' : 'Helium · Neon · Argon'}</span>
          <span>{exp ? `${exp.getMonth() + 1}月${exp.getDate()}日到期` : ''}</span>
        </div>
      </div>

      <div className="sec">订阅套餐</div>
      <div className="plans">
        {PLANS.map(p => {
          const cur = plan?.toLowerCase() === p.id.toLowerCase()
          return (
            <div key={p.id} className={`plan-card ${p.id.toLowerCase()} ${cur ? 'cur' : ''}`}>
              <div className="plan-top"><span className="plan-name">{p.id}</span>{p.id === 'Max' && <span className="plan-tag">推荐</span>}{cur && <span className="plan-tag cur">当前</span>}</div>
              <div className="plan-price"><small>¥</small>{p.price}<span>/ 月</span></div>
              <ul>{p.perks.map(x => <li key={x}><Icon n="check" s={14} w={2.6} />{x}</li>)}</ul>
              <button className="plan-btn" onClick={buy}>{cur ? '续费' : '订阅'}</button>
            </div>)
        })}
      </div>

      <div className="sec">近 14 天</div>
      <div className="w-box chart">
        <div className="w-chart-h"><div><div className="t12">{days[sel].day.slice(5).replace('-', '月')}日</div><b>{days[sel].tokens.toLocaleString()}<small className="t12"> tokens</small></b></div>
          <span className="t12">{gu ? `${days[sel].requests} 次请求` : '本机记录'}</span></div>
        <div className="bars">{days.map((d, i) => <button key={d.day} className={`bar ${i === sel ? 'now' : ''}`} onClick={() => setSel(i)} style={{ height: `${8 + (d.tokens / max) * 100}%`, animationDelay: `${i * 30}ms` }} />)}</div>
        <div className="t12 chart-x"><span>{days[0].day.slice(5)}</span><span>今天</span></div>
      </div>

      <div className="sec">用量记录</div>
      {ledger.length === 0 ? <div className="empty">还没有用量</div> : (
        <div className="w-ledger">{ledger.map(u => (
          <div key={u.day} className="w-li"><span className="w-li-i"><Icon n="chat" s={16} w={2} /></span>
            <div className="grow"><div className="t15">{u.day}</div><div className="t12">{u.requests ? `${u.requests} 次请求` : '对话'}</div></div><b>{u.tokens.toLocaleString()}<small className="t12"> tokens</small></b></div>))}
        </div>)}
      <div className="t12 foot">订阅与支付在网关的用户中心完成，额度以网关为准</div>
      <div className="bottom-pad" />
    </div>
  )
}

async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1440 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.85))
}

function SettingsPage({ s, set, onWall }: { s: Settings; set: (s: Settings) => void; onWall: (v: number) => void }) {
  const f = (k: keyof Settings, label: string, icon: string, ph = '', type = 'text') => (
    <label className="row field">
      <div className="ico" style={{ background: '#8E8E93' }}><Icon n={icon} s={16} c="#fff" w={2.2} /></div>
      <span className="t17 lbl">{label}</span>
      <input type={type} value={String(s[k])} placeholder={ph}
        onChange={e => set({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
    </label>
  )
  const file = useRef<HTMLInputElement>(null)
  const [adv, setAdv] = useState(false)
  const kp = keyPage(s)
  return (
    <div className="scroll">
      <div className="top-pad" />
      <div className="lt">设置</div>
      <div className="sec">账号</div>
      <div className="list">{f('baseUrl', '网关', 'link', 'https://你的网关')}{f('apiKey', 'API Key', 'key', 'sk-…', 'password')}</div>
      <div className="key-link">
        {kp ? <a href={kp} target="_blank" rel="noreferrer">获取密钥<Icon n="up" s={12} w={2.4} /></a> : <span className="t13">填写网关后可直接跳转获取密钥</span>}
      </div>
      <div className="sec">外观</div>
      <div className="list">
        <div className="row">
          <div className="ico" style={{ background: 'var(--accent)' }}><Icon n="image" s={16} c="#fff" w={2.2} /></div>
          <span className="t17">主题</span>
          <div className="mini-seg">
            <button className={s.theme === 'peach' ? 'on' : ''} onClick={() => set({ ...s, theme: 'peach' })}>橙白</button>
            <button className={s.theme === 'wallpaper' ? 'on' : ''} onClick={() => set({ ...s, theme: 'wallpaper' })}>壁纸</button>
          </div>
        </div>
        {s.theme === 'wallpaper' && <button className="row press-row" onClick={() => file.current?.click()}>
          <div className="ico" style={{ background: '#5E5CE6' }}><Icon n="plus" s={16} c="#fff" w={2.4} /></div>
          <span className="t17">选择壁纸图片</span><span className="t13" style={{ marginLeft: 'auto' }}>仅存本机</span></button>}
        <input ref={file} type="file" accept="image/*" hidden onChange={async e => {
          const fl = e.target.files?.[0]; if (!fl) return
          const v = Date.now(); await putBlob('wallpaper:' + v, await shrinkImage(fl)); onWall(v); e.target.value = ''
        }} />
      </div>
      <div className="sec">智能界面</div>
      <div className="list">
        <div className="row"><div className="ico" style={{ background: '#5E5CE6' }}><Icon n="spark" s={16} c="#fff" w={2.2} /></div>
          <div className="grow"><div className="t17">卡片式回答</div><div className="t13">数据、步骤、对比等用界面卡片展示</div></div>
          <Toggle on={s.genUI} set={b => set({ ...s, genUI: b })} /></div>
      </div>
      <button className="adv-toggle" onClick={() => setAdv(v => !v)}>高级设置 {adv ? '收起' : '展开'}</button>
      {adv && <>
        <div className="sec">图片与视频生成</div>
        <div className="list">{f('mediaBaseUrl', '地址', 'link', '留空则同网关')}{f('mediaKey', 'Key', 'key', '留空则同上', 'password')}
          {f('imageModel', '图片模型', 'image')}{f('imageSize', '图片尺寸', 'image', '1024x1024')}{f('videoModel', '视频模型', 'film')}{f('videoSeconds', '视频秒数', 'film', '4', 'number')}</div>
        <div className="sec">页面地址</div>
        <div className="list">{f('keyUrl', '获取密钥', 'key', '默认 网关/keys')}{f('purchaseUrl', '订阅页', 'wallet', '默认 网关/purchase')}</div>
      </>}
      <div className="t12 foot">Key 只保存在本机。栖语 Lumi v0.8 · 开源 MIT</div>
      <div className="bottom-pad" />
    </div>
  )
}
