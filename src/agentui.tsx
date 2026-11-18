/** AI 接管（v0.24）的界面：运行中的实时一行、结果对比卡（候选表、AI 的选择、继续去下单 / 换一个 / 结束）。 */
import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Phone, isNative } from './phone'
import { agentFinish, agentLive, pickIndex, runAgent, saveAgentRun, STATUS_LABEL, STOP_LABEL, type AgentCfg, type AgentLive, type AgentOutcome } from './agent'

export function useAgentLive(): AgentLive {
  const [l, setL] = useState<AgentLive>(agentLive)
  useEffect(() => { const on = (e: Event) => setL({ ...(e as CustomEvent).detail }); window.addEventListener('lumi-agent', on); return () => window.removeEventListener('lumi-agent', on) }, [])
  return l
}

/** 运行中：一行 AI 的想法 + 第几轮 + 停止。 */
export function AgentLiveLine({ force }: { force?: AgentLive }) {
  const l0 = useAgentLive(); const l = force || l0
  if (!l.running) return null
  return (
    <div className="ag-live" role="status">
      <span className="ag-pulse" aria-hidden="true" />
      <span className="ag-live-k">AI 接管 {l.turn}/{l.max}</span>
      <span className="grow ell">{l.line || '正在看屏幕…'}</span>
      {l.cands > 0 && <span className="ag-live-n">候选 {l.cands}</span>}
      {isNative && <button className="ag-live-x press" onClick={() => Phone.flowStop().catch(() => {})}>停止</button>}
    </div>
  )
}

const QUICK = ['换一个', '再多看几款', '便宜一点', '评分更高', '换个店铺']
const s1 = (ms: number) => (ms / 1000).toFixed(1)

/** 对比卡。o 变了（继续运行）通过 onChange 交给上层保存（运行记录 / 对话消息）。 */
export function AgentCard({ o, onChange, mock }: { o: AgentOutcome; onChange?: (o: AgentOutcome) => void; mock?: boolean }) {
  const [cur, setCur] = useState(o)
  useEffect(() => setCur(o), [o])
  const [busy, setBusy] = useState(false)
  const [fb, setFb] = useState<string | null>(null)
  const [ans, setAns] = useState('')
  const [log, setLog] = useState(false)
  const [err, setErr] = useState('')
  const c = cur
  const pi = pickIndex(c.candidates, c.pick?.name)
  const order = c.cfg.mode === 'order'
  const appName = c.cfg.app || '应用'
  const put = (n: AgentOutcome) => { setCur(n); onChange?.(n) }
  const resume = async (extra: Partial<AgentCfg>) => {
    if (!isNative || mock) { setErr('继续运行要在安卓 App 里'); return }
    setBusy(true); setErr(''); setFb(null)
    try {
      const target = c.cfg.pkg || c.cfg.app
      if (target) { await Phone.launch({ name: target }).catch(() => {}); await new Promise(r => setTimeout(r, 1200)) }
      const prior = [c.summary, c.pick ? `选了 ${c.pick.name}（${c.pick.reason}）` : ''].filter(Boolean).join('；')
      const n = await runAgent({ ...c.cfg, prior: c.candidates, priorSummary: prior || undefined, feedback: undefined, ...extra })
      saveAgentRun(n); await agentFinish(n, false)
      put(n)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const end = () => { put({ ...c, ended: true }); if (isNative && !mock) Phone.agentEnd({}).catch(() => {}) }
  const toOrder = () => resume({
    mode: 'order', maxSteps: Math.min(c.cfg.maxSteps, 15),
    goal: `打开「${c.pick?.name || '刚才选中的商品'}」的商品详情页（如果当前不在），点「立即购买」或「领券购买」，规格不确定就保持默认或问用户，停在提交订单页。绝对不要点提交订单和付款。`,
  })
  const again = (text: string) => resume({ feedback: text || '换一个', goal: c.cfg.goal })
  const showTable = c.cfg.output !== 'text' && c.candidates.length > 0
  const tone = c.status === 'done' ? 'ok' : c.status === 'safety' || c.status === 'login' || c.status === 'ask' ? 'warn' : c.status === 'stopped' ? '' : 'bad'
  return (
    <div className={`ag-card ${tone}`}>
      <div className="ag-head">
        <span className="ag-badge"><Icon n="agent" s={18} w={2} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ag-t">AI 接管{order ? ' · 去下单' : ''}</div>
          <div className="ag-goal ell">{c.cfg.goal}</div>
        </div>
        <span className={`ag-st ${tone}`}>{busy ? '运行中…' : STATUS_LABEL[c.status]}</span>
      </div>

      {c.cfg.criteria && <div className="ag-crit"><span>挑选标准</span>{c.cfg.criteria}</div>}

      {c.status === 'safety' && c.blocked && <div className="ag-alert">
        <Icon n="shield" s={16} w={2} />
        <div className="grow">AI 准备点「{c.blocked.word}」（{STOP_LABEL[c.blocked.kind]}），已经停下。{c.blocked.kind === 'pay' || c.blocked.kind === 'submit' ? '下单和付款请你自己在手机上确认。' : '这一步需要你自己确认。'}</div>
      </div>}
      {(c.status === 'ask' || c.status === 'login') && <div className="ag-alert">
        <Icon n="user" s={16} w={2} /><div className="grow">{c.question || c.reason}</div>
      </div>}
      {(c.status === 'fail' || c.status === 'limit') && c.reason && <div className="ag-alert bad"><Icon n="x" s={16} w={2.2} /><div className="grow">{c.reason}</div></div>}

      {c.pick && <div className="ag-pick">
        <div className="ag-pick-k">AI 的选择</div>
        <div className="ag-pick-n">{c.pick.name}</div>
        {pi >= 0 && <div className="ag-pick-m">{[c.candidates[pi].price, c.candidates[pi].rating && `评分 ${c.candidates[pi].rating}`, c.candidates[pi].sales, c.candidates[pi].shop].filter(Boolean).join(' · ')}</div>}
        {c.pick.reason && <div className="ag-pick-r">{c.pick.reason}</div>}
      </div>}
      {c.summary && <div className="ag-sum">{c.summary}</div>}

      {showTable && <div className="ag-tbl-wrap"><table className="ag-tbl">
        <thead><tr><th>候选（{c.candidates.length}）</th><th>价格</th><th>评分 / 销量</th><th>店铺</th><th>优缺点</th></tr></thead>
        <tbody>{c.candidates.map((x, k) => <tr key={k} className={k === pi ? 'picked' : ''}>
          <td className="ag-name"><span className="ag-no">{k + 1}</span><span className="ag-nm">{x.name}{k === pi && <em>推荐</em>}</span></td>
          <td className="ag-price">{x.price || '—'}</td>
          <td>{[x.rating, x.sales].filter(Boolean).join(' · ') || '—'}</td>
          <td>{x.shop || '—'}</td>
          <td className="ag-pc">{x.pros && <span className="pro">优 {x.pros}</span>}{x.cons && <span className="con">缺 {x.cons}</span>}{!x.pros && !x.cons && '—'}</td>
        </tr>)}</tbody>
      </table></div>}

      <button className="ag-meta" onClick={() => setLog(!log)}>
        <span className="grow">{c.turns.length} 轮 · {s1(c.ms)} 秒 · 模型 {c.modelCalls} 次{c.turns.length ? ` · 平均 ${s1(c.turns.reduce((a, t) => a + t.ms, 0) / c.turns.length)} 秒一轮` : ''}</span>
        <span>{log ? '收起过程' : '看过程'}</span><Icon n="down" s={13} w={2.2} />
      </button>
      {log && <ol className="ag-log">{c.turns.map(t => <li key={t.i} className={t.changed === false ? 'nochg' : ''}>
        <span className="ag-li">{t.i}</span>
        <div className="grow" style={{ minWidth: 0 }}><div className="ell">{t.label}{t.changed === false ? '（屏幕没变）' : ''}</div>{t.thought && <div className="ag-th">{t.thought}</div>}</div>
        <span className="ag-ms">{s1(t.ms)}s<i>模型 {s1(t.modelMs)}s</i></span>
      </li>)}</ol>}

      {busy && <AgentLiveLine />}
      {err && <div className="ag-err">{err}</div>}

      {!c.ended && !busy && fb != null && <div className="ag-fb">
        <div className="ag-chips">{QUICK.map(q => <button key={q} className="chip-t" onClick={() => setFb(q)}>{q}</button>)}</div>
        <input className="inp" autoFocus value={fb} onChange={e => setFb(e.target.value)} placeholder="说说想要什么样的，比如 不要入耳式、预算 300 以内" />
        <div className="ag-btns"><button className="btn-ghost press" onClick={() => setFb(null)}>取消</button><button className="ag-go press" onClick={() => again(fb)}>继续挑</button></div>
      </div>}

      {!c.ended && !busy && fb == null && <div className="ag-btns">
        {c.status === 'done' && !order && <>
          {c.pick && <button className="ag-go press" onClick={toOrder}><Icon n="right" s={14} w={2.4} />继续去下单</button>}
          <button className="btn-ghost press" onClick={() => setFb('')}>换一个 / 再看看</button>
        </>}
        {c.status === 'done' && order && <button className="ag-go press" onClick={() => target(c)}>回到{appName}</button>}
        {c.status === 'safety' && <>
          <button className="ag-go press" onClick={() => target(c)}>回到{appName}自己确认</button>
          {!order && <button className="btn-ghost press" onClick={() => setFb('')}>换一个 / 再看看</button>}
        </>}
        {(c.status === 'ask' || c.status === 'login') && <div className="ag-fb">
          <input className="inp" value={ans} onChange={e => setAns(e.target.value)} placeholder={c.status === 'login' ? '处理好后点继续（可留言）' : '你的回答'} />
          <div className="ag-btns"><button className="ag-go press" onClick={() => resume({ feedback: ans || '我已经处理好了，请继续' })}>继续</button></div>
        </div>}
        {(c.status === 'limit' || c.status === 'fail' || c.status === 'stopped') && <button className="ag-go press" onClick={() => resume({ feedback: '接着刚才的进度继续' })}>继续</button>}
        <button className="btn-ghost press" onClick={end}>结束</button>
      </div>}
      {c.ended && <div className="ag-ended">已结束。付款、下单这类操作 AI 不会替你点。</div>}
    </div>
  )
}
const target = (c: AgentOutcome) => { const t = c.cfg.pkg || c.cfg.app; if (isNative && t) Phone.launch({ name: t }).catch(() => {}) }

/** 截图和网页预览用的示例数据（不是真实运行结果）。 */
export const MOCK_OUTCOME: AgentOutcome = {
  id: 'mock', status: 'done', at: 0, reason: '', ms: 96400, modelCalls: 15, modelMs: 61200,
  cfg: { goal: '在搜索结果里比较至少 5 款蓝牙耳机，按 300 元以内 和口碑挑最合适的一款，停在商品详情页', criteria: '300 元以内，降噪优先', maxSteps: 25, maxMinutes: 5, stopBefore: ['pay', 'submit', 'send', 'delete'], output: 'compare', model: 'argon', app: '淘宝', pkg: 'com.taobao.taobao' },
  summary: '看了 6 款，按价格和评价筛掉 2 款超预算的，剩下 4 款里降噪和续航最均衡的是第 3 款。',
  pick: { name: '示例耳机 C 主动降噪蓝牙耳机', reason: '279 元在预算内，评价里降噪和续航提得最多，差评主要是盒子偏大' },
  candidates: [
    { name: '示例耳机 A 半入耳蓝牙耳机', price: '¥199', rating: '4.8', sales: '月销 1 万+', shop: '示例 A 旗舰店', pros: '轻、便宜', cons: '无降噪' },
    { name: '示例耳机 B 运动挂耳式', price: '¥239', rating: '4.7', sales: '月销 5000+', shop: '示例 B 官方店', pros: '不掉', cons: '通话一般' },
    { name: '示例耳机 C 主动降噪蓝牙耳机', price: '¥279', rating: '4.9', sales: '月销 2 万+', shop: '示例 C 旗舰店', pros: '降噪好、续航 30 小时', cons: '盒子偏大' },
    { name: '示例耳机 D 头戴式降噪', price: '¥459', rating: '4.9', sales: '月销 3000+', shop: '示例 D 自营', pros: '音质好', cons: '超预算' },
    { name: '示例耳机 E 开放式', price: '¥329', rating: '4.6', sales: '月销 800+', shop: '示例 E 专卖店', pros: '不堵耳', cons: '漏音、超预算' },
  ],
  turns: [
    { i: 1, ms: 5200, modelMs: 3900, calls: 1, label: '记下 3 个候选', thought: '搜索结果第一屏有 3 款，先记下' },
    { i: 2, ms: 6100, modelMs: 4300, calls: 1, label: '向下滚动', thought: '继续往下看更多款', changed: true },
    { i: 3, ms: 5800, modelMs: 4100, calls: 1, label: '点击「示例耳机 C 主动降噪…」', thought: 'C 价格合适，进详情看评价', changed: true },
  ],
}
