import { useEffect, useMemo, useRef, useState } from 'react'
import { Glass } from './glass'
import { Icon } from './icons'
import { loadSettings, saveSettings, streamChat, type Msg, type Settings, type Tier } from './api'
import { addUsage, loadConvs, loadUsage, saveConvs, uid, when, type Conv } from './store'

type Tab = 'chat' | 'wallet' | 'settings'
const TIER_LABEL: Record<Tier, string> = { eco: '经济', fast: '极速' }

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [convs, setConvs] = useState<Conv[]>(loadConvs)
  const [openId, setOpenId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [tier, setTier] = useState<Tier>(() => (localStorage.getItem('lumi.tier') as Tier) || 'eco')
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

  return (
    <div className="app">
      <div className={`page ${open ? 'pushed' : ''}`}>
        {tab === 'chat' && <Home convs={convs} onOpen={setOpenId} onNew={newChat}
          onDelete={id => setConvs(cs => cs.filter(c => c.id !== id))} />}
        {tab === 'wallet' && <Wallet settings={settings} />}
        {tab === 'settings' && <SettingsPage s={settings} set={setSettings} />}
        <TabBar tab={tab} setTab={setTab} onNew={newChat} />
      </div>
      {open && <Chat conv={open} settings={settings} tier={tier} think={think}
        onBack={() => setOpenId(null)} onMode={() => setSheet(true)} update={fn => update(open.id, fn)} />}
      <ModeSheet show={sheet} onClose={() => setSheet(false)} tier={tier} setTier={setTier} think={think} setThink={setThink} s={settings} />
    </div>
  )
}

function TabBar({ tab, setTab, onNew }: { tab: Tab; setTab: (t: Tab) => void; onNew: () => void }) {
  const items: [Tab, string, string][] = [['chat', 'chat', '对话'], ['wallet', 'wallet', '钱包'], ['settings', 'gear', '设置']]
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
              <div className="ico" style={{ background: c.tier === 'fast' ? '#0088FF' : '#34C759' }}><Icon n={c.tier === 'fast' ? 'bolt' : 'leaf'} s={17} c="#fff" w={2.2} /></div>
              <div className="grow"><div className="t17 ell">{c.title}</div><div className="t13">{TIER_LABEL[c.tier]} · {when(c.updated)}</div></div>
              <button className="del" onClick={e => { e.stopPropagation(); if (confirm('删除这个对话？')) onDelete(c.id) }}><Icon n="trash" s={18} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="bottom-pad" />
    </div>
  )
}

function Chat({ conv, settings, tier, think, onBack, onMode, update }: {
  conv: Conv; settings: Settings; tier: Tier; think: boolean; onBack: () => void; onMode: () => void; update: (fn: (c: Conv) => Conv) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ctrl = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const composing = useRef(false)
  useEffect(() => { if (pinned.current) scroller.current?.scrollTo({ top: 1e9 }) }, [conv.messages])

  const send = async (override?: Msg[]) => {
    const base = override ?? [...conv.messages, { role: 'user' as const, content: text.trim() }]
    if (!override && !text.trim()) return
    setText(''); setErr(''); setBusy(true); pinned.current = true
    const title = conv.title === '新对话' ? base[0].content.slice(0, 18) : conv.title
    update(c => ({ ...c, title, tier, updated: Date.now(), messages: [...base, { role: 'assistant', content: '', tier }] }))
    ctrl.current = new AbortController()
    try {
      const r = await streamChat({
        settings, tier, think, messages: base, signal: ctrl.current.signal,
        onDelta: (t, rs) => update(c => ({ ...c, messages: [...base, { role: 'assistant', content: t, reasoning: rs, tier }] })),
      })
      const price = tier === 'fast' ? settings.fastPrice : settings.ecoPrice
      const cost = ((r.completionTokens + r.promptTokens * 0.25) / 1e6) * price
      addUsage(cost, r.completionTokens + r.promptTokens)
      update(c => {
        const m = [...c.messages]; const last = m[m.length - 1]
        m[m.length - 1] = { ...last, cost, ms: r.firstTokenMs }
        return { ...c, messages: m }
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message || String(e))
    } finally { setBusy(false); ctrl.current = null }
  }
  const regen = () => { const m = conv.messages; if (m.length >= 2) send(m.slice(0, -1)) }

  return (
    <div className="chat slide-in">
      <div className="scroll" ref={scroller} onScroll={e => {
        const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}>
        <div className="chat-pad" />
        {conv.messages.length === 0 && <div className="empty" style={{ marginTop: 120 }}>问点什么吧。当前：{TIER_LABEL[tier]}{think ? ' · 深度思考' : ''}</div>}
        {conv.messages.map((m, i) => m.role === 'user'
          ? <div key={i} className="u-row fade"><div className="u-bub">{m.content}</div></div>
          : <div key={i} className="a-msg fade">
              {m.reasoning && <details className="think"><summary><Icon n="spark" s={14} c="#0088FF" w={2} />思考过程</summary><div>{m.reasoning}</div></details>}
              <div className="a-txt">{m.content}{busy && i === conv.messages.length - 1 && <span className="caret" />}</div>
              {!(busy && i === conv.messages.length - 1) && m.content && (
                <div className="acts">
                  <button onClick={() => navigator.clipboard?.writeText(m.content)}><Icon n="copy" s={18} w={1.8} /></button>
                  {i === conv.messages.length - 1 && <button onClick={regen}><Icon n="redo" s={18} w={1.8} /></button>}
                  <span className="t13 meta">{m.tier ? TIER_LABEL[m.tier] : ''}{m.ms ? ` · 首字 ${(m.ms / 1000).toFixed(1)}s` : ''}{m.cost != null ? ` · ¥${m.cost.toFixed(4)}` : ''}</span>
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
        <div className="nav-sub"><Icon n={tier === 'fast' ? 'bolt' : 'leaf'} s={11} w={2.4} />{TIER_LABEL[tier]}{think ? ' · 深度思考' : ''} ›</div>
      </div>
      <Glass className="nav-btn right press" onClick={onMode}><Icon n="more" s={22} /></Glass>
      <div className="composer">
        <Glass className="c-plus press" onClick={onMode}><Icon n="plus" s={22} w={2} /></Glass>
        <Glass className="c-field" radius={25}>
          <textarea rows={1} placeholder="和栖语聊聊…" value={text}
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

function ModeSheet({ show, onClose, tier, setTier, think, setThink, s }: {
  show: boolean; onClose: () => void; tier: Tier; setTier: (t: Tier) => void; think: boolean; setThink: (b: boolean) => void; s: Settings
}) {
  return (
    <div className={`sheet-wrap ${show ? 'show' : ''}`}>
      <div className="scrim" onClick={onClose} />
      <Glass variant="dialog" radius={38} className="sheet">
        <div className="grabber" />
        <div className="sheet-head">
          <button className="circle" onClick={onClose}><Icon n="x" s={18} w={2.2} /></button>
          <div className="t17 b">回答模式</div>
          <button className="circle blue" onClick={onClose}><Icon n="check" s={20} c="#fff" w={2.6} /></button>
        </div>
        <div className="seg" style={{ ['--i' as string]: tier === 'eco' ? 0 : 1 }}>
          <div className="seg-thumb" />
          <button onClick={() => setTier('eco')}><Icon n="leaf" s={15} c="#34C759" w={2.2} />经济 0.5×</button>
          <button onClick={() => setTier('fast')}><Icon n="bolt" s={15} c="#0088FF" w={2.2} />极速 1.5×</button>
        </div>
        <div className="list glassy">
          <div className="row"><div className="ico" style={{ background: tier === 'fast' ? '#0088FF' : '#34C759' }}><Icon n={tier === 'fast' ? 'bolt' : 'leaf'} s={17} c="#fff" w={2.2} /></div>
            <div><div className="t17">{tier === 'fast' ? '官方直连线路' : '经济线路'}</div><div className="t13">{tier === 'fast' ? '首字更快 · 不排队' : '价格减半 · 高峰可能排队'}</div></div></div>
          <div className="row"><div className="ico" style={{ background: '#5E5CE6' }}><Icon n="spark" s={17} c="#fff" w={2.2} /></div>
            <div className="t17">深度思考</div><Toggle on={think} set={setThink} /></div>
        </div>
        <div className="t13 sheet-note">按 1000 字回复估算：经济约 ¥{(s.ecoPrice * 0.0015).toFixed(3)}，极速约 ¥{(s.fastPrice * 0.0015).toFixed(3)}。</div>
      </Glass>
    </div>
  )
}

function Toggle({ on, set }: { on: boolean; set: (b: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on}><span /></button>
}

function Wallet({ settings }: { settings: Settings }) {
  const usage = useMemo(loadUsage, [])
  const days = useMemo(() => {
    const out: { day: string; cost: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)
      out.push({ day: d, cost: usage.find(u => u.day === d)?.cost || 0 })
    }
    return out
  }, [usage])
  const month = new Date().toISOString().slice(0, 7)
  const monthCost = usage.filter(u => u.day.startsWith(month)).reduce((a, b) => a + b.cost, 0)
  const tokens = usage.filter(u => u.day.startsWith(month)).reduce((a, b) => a + b.tokens, 0)
  const max = Math.max(...days.map(d => d.cost), 0.0001)
  const [amt, setAmt] = useState(30)
  return (
    <div className="scroll">
      <div className="top-pad" />
      <div className="lt">钱包</div>
      <div className="balance">
        <div className="balance-bg" />
        <div className="b-l">本月估算消费 · 元</div>
        <div className="b-n">{monthCost.toFixed(2)}</div>
        <div className="b-s">{tokens.toLocaleString()} tokens · 实际余额以网关为准</div>
      </div>
      <div className="sec">充值</div>
      <div className="grid3">
        {[[10, '尝鲜'], [30, '送 ¥3'], [68, '送 ¥10']].map(([v, l]) => (
          <button key={v} className={`amt ${amt === v ? 'on' : ''}`} onClick={() => setAmt(v as number)}><b>¥{v}</b><span>{l}</span></button>
        ))}
      </div>
      <button className="primary" onClick={() => settings.rechargeUrl ? window.open(settings.rechargeUrl, '_blank') : alert('请先在「设置」里填写充值页地址（Sub2API 用户中心）。')}>去充值 ¥{amt}</button>
      <div className="sec">近 14 天</div>
      <div className="list chart">
        <div className="bars">{days.map((d, i) => <div key={d.day} className={`bar ${i === 13 ? 'now' : ''}`} style={{ height: `${8 + (d.cost / max) * 100}%`, animationDelay: `${i * 30}ms` }} />)}</div>
        <div className="t12 chart-x"><span>{days[0].day.slice(5)}</span><span>今天</span></div>
      </div>
      <div className="t12 foot">经济 = 官方价 0.5× · 极速 = 官方价 1.5× · 单价可在设置中调整</div>
      <div className="bottom-pad" />
    </div>
  )
}

function SettingsPage({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const f = (k: keyof Settings, label: string, icon: string, ph = '', type = 'text') => (
    <label className="row field">
      <div className="ico" style={{ background: '#8E8E93' }}><Icon n={icon} s={16} c="#fff" w={2.2} /></div>
      <span className="t17 lbl">{label}</span>
      <input type={type} value={String(s[k])} placeholder={ph}
        onChange={e => set({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
    </label>
  )
  return (
    <div className="scroll">
      <div className="top-pad" />
      <div className="lt">设置</div>
      <div className="sec">网关（Sub2API 或任何 OpenAI 兼容接口）</div>
      <div className="list">{f('baseUrl', '地址', 'link', 'https://')}{f('ecoKey', '经济 Key', 'key', 'sk-…', 'password')}{f('fastKey', '极速 Key', 'key', '留空则同经济', 'password')}</div>
      <div className="sec">模型</div>
      <div className="list">{f('ecoModel', '经济', 'leaf')}{f('fastModel', '极速', 'bolt')}{f('thinkModel', '深度思考', 'spark')}</div>
      <div className="sec">显示用单价（元 / 百万输出 tokens）</div>
      <div className="list">{f('ecoPrice', '经济', 'leaf', '', 'number')}{f('fastPrice', '极速', 'bolt', '', 'number')}</div>
      <div className="sec">充值</div>
      <div className="list">{f('rechargeUrl', '充值页', 'wallet', 'Sub2API 用户中心地址')}</div>
      <div className="t12 foot">Key 只保存在本机。栖语 Lumi v0.5 · 开源 MIT</div>
      <div className="bottom-pad" />
    </div>
  )
}
