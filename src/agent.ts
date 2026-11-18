/** AI 接管（v0.24）的循环：每一轮 等页面安静 → 截图 + 元素列表 → 模型给一个动作 → 安全检查 → 执行 → 下一轮确认屏幕变了。
 * 在 Flow 里由原生 agent 步触发（flowAgent 事件，结果用 flowAgentAnswer 回传）；对比卡上的「继续去下单」「换一个」单独调用。
 * 准确优先：默认用最强的模型（Argon），每轮都等页面安静再看；付款永远不点。 */
import { Phone, isNative } from './phone'
import { gw, loadSettings, type Settings } from './api'
import type { StopKind } from './flowcore'
import { ACT_TOOL, AGENT_SYSTEM, actionLabel, agentUserText, dangerOf, elText, fingerprint, guardSource, mergeCandidates, outcomeText, parseAction, parseElements, screenGate, STOP_LABEL, textNear,
  type AgentAction, type AgentCfg, type AgentOutcome, type AgentStatus, type AgentTurn, type Candidate } from './agentcore'
export * from './agentcore'

export interface Obs { elements: string; image?: string; w: number; h: number; pkg?: string; act?: string; stopped?: boolean; waitMs?: number }

/* ---------- 实时一行：悬浮条 + App 里 */
export interface AgentLive { running: boolean; turn: number; max: number; line: string; cands: number }
let live: AgentLive = { running: false, turn: 0, max: 0, line: '', cands: 0 }
export const agentLive = () => live
const emit = (l: Partial<AgentLive>) => { live = { ...live, ...l }; window.dispatchEvent(new CustomEvent('lumi-agent', { detail: live })) }

/* ---------- 模型调用：OpenAI 兼容网关（设置里的网关和密钥），优先 tool call，网关不收工具 / 图片时自动退回 */
const NO_IMG = 'lumi.visionNoImage', NO_TOOLS = 'lumi.agentNoTools'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function callModel(s: Settings, tier: string, msgs: unknown[], image?: string): Promise<{ text: string; ms: number; calls: number }> {
  const t0 = performance.now()
  let calls = 0
  let useImg = !!image && sessionStorage.getItem(NO_IMG) !== '1'
  let useTools = sessionStorage.getItem(NO_TOOLS) !== '1'
  for (let attempt = 0; attempt < 5; attempt++) {
    const m = [...msgs] as { role: string; content: unknown }[]
    const last = m[m.length - 1]
    if (useImg && typeof last.content === 'string') m[m.length - 1] = { ...last, content: [{ type: 'text', text: last.content }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image, detail: 'high' } }] }
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 60000)
    let res: Response
    calls++
    try {
      res = await fetch(gw(s) + '/v1/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: tier, stream: false, temperature: 0.1, max_tokens: 900, messages: m,
          ...(useTools ? { tools: [ACT_TOOL], tool_choice: { type: 'function', function: { name: 'act' } } } : {}) }),
      })
    } catch (e) { clearTimeout(tm); if (attempt < 2) { await sleep(1500); continue } throw new Error('模型请求失败：' + ((e as Error).message || '网络错误')) }
    clearTimeout(tm)
    if (res.status === 429) { await sleep(4000 + attempt * 2000); continue }
    if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 401) {
      if (useImg) { useImg = false; sessionStorage.setItem(NO_IMG, '1'); continue }
      if (useTools) { useTools = false; sessionStorage.setItem(NO_TOOLS, '1'); continue }
    }
    if (res.status >= 500 && attempt < 2) { await sleep(2000); continue }
    if (!res.ok) throw new Error(`模型请求失败 ${res.status}`)
    const j = await res.json() as { choices?: { message?: { content?: string; tool_calls?: { function?: { arguments?: string } }[] } }[] }
    const msg = j.choices?.[0]?.message
    const text = msg?.tool_calls?.[0]?.function?.arguments || msg?.content || ''
    return { text, ms: Math.round(performance.now() - t0), calls }
  }
  throw new Error('模型请求太频繁，稍后再试')
}

/* ---------- 循环 */
export interface RunAgentOpts { inFlow?: boolean; settings?: Settings; onTurn?: (t: AgentTurn) => void }
const uid = () => Math.random().toString(36).slice(2, 10)

export async function runAgent(cfg: AgentCfg, opts: RunAgentOpts = {}): Promise<AgentOutcome> {
  const s = opts.settings || loadSettings()
  const t0 = Date.now()
  const turns: AgentTurn[] = []
  const history: string[] = []
  let cands: Candidate[] = [...(cfg.prior || [])]
  let modelCalls = 0, modelMs = 0
  let lastFp = '', same = 0, recovered = false, lastType = ''
  const guard = guardSource(cfg.stopBefore, cfg.mode)
  const out = (status: AgentStatus, p: Partial<AgentOutcome> = {}): AgentOutcome => ({
    id: uid(), status, at: Date.now(), cfg: { ...cfg, prior: undefined }, summary: '', reason: '', candidates: cands, turns, modelCalls, modelMs, ms: Date.now() - t0, ...p,
  })
  if (!isNative) return out('fail', { reason: 'AI 接管要在安卓 App 里运行' })
  if (!cfg.goal) return out('fail', { reason: 'AI 接管缺少目标' })
  if (!opts.inFlow) await Phone.agentBegin().catch(() => {})
  emit({ running: true, turn: 0, max: cfg.maxSteps, line: 'AI 接管：准备看屏幕…', cands: cands.length })
  const bar = (t: string) => Phone.agentBar({ text: t.length > 46 ? t.slice(0, 45) + '…' : t }).catch(() => {})
  let note = ''
  try {
    for (let turn = 1; turn <= cfg.maxSteps; turn++) {
      if (Date.now() - t0 > cfg.maxMinutes * 60000) return out('limit', { reason: `到了 ${cfg.maxMinutes} 分钟上限`, summary: cands.length ? `看了 ${cands.length} 个候选，还没来得及选` : '' })
      const s0 = performance.now()
      const obs = await Phone.agentObserve({ max: 150, shot: true, quiet: 450, maxWait: 3500 })
      if (obs.stopped) return out('stopped', { reason: '你停止了 AI 接管' })
      // 上一步有没有让屏幕变化
      const fp = fingerprint(obs.elements)
      const prev = turns[turns.length - 1]
      if (prev && lastType && !['note', 'wait'].includes(lastType)) {
        prev.changed = fp !== lastFp
        if (!prev.changed) history[history.length - 1] += '（屏幕没有变化）'
      }
      if (fp === lastFp && !['note'].includes(lastType)) same++; else same = 1
      lastFp = fp
      // 连续 3 次同一屏：先自救一次（滚动或返回），还不行就停
      if (same >= 3) {
        if (recovered) return out('fail', { reason: '屏幕连续几次没有变化，AI 卡住了' })
        recovered = true; same = 1
        const op = lastType === 'scroll' ? 'back' : 'scroll'
        await Phone.agentAct({ op, dir: 'down' }).catch(() => ({ ok: false }))
        history.push(`- 第 ${turn} 轮 自动${op === 'back' ? '返回' : '向下滚动'}（同一屏停留太久）`)
        note = '刚才在同一屏停留太久，已自动换了一屏，请换一种做法'
        lastType = op
        continue
      }
      // 登录 / 验证码：交给用户
      const gate = screenGate(obs.elements)
      if (gate) {
        await bar(gate.kind === 'captcha' ? 'AI 接管停下：需要你完成验证' : 'AI 接管停下：需要你登录')
        return out('login', { reason: `屏幕上出现「${gate.word}」`, question: gate.kind === 'captcha' ? '出现了验证码 / 滑块，请在手机上完成验证后点「继续」' : '需要登录，请在手机上登录后点「继续」' })
      }
      // 问模型
      const user = agentUserText({ cfg, turn, elapsedS: (Date.now() - t0) / 1000, cands, history, elements: obs.elements, pkg: obs.pkg, note })
      note = ''
      const msgs: unknown[] = [{ role: 'system', content: AGENT_SYSTEM }, { role: 'user', content: user }]
      let r = await callModel(s, cfg.model, msgs, obs.image)
      modelCalls += r.calls; let mMs = r.ms
      let p = parseAction(r.text, obs.w, obs.h)
      if ('error' in p) {
        const r2 = await callModel(s, cfg.model, [...msgs, { role: 'assistant', content: r.text.slice(0, 1500) }, { role: 'user', content: `上一条不是合法动作（${p.error}）。只输出一个 JSON 动作。` }])
        modelCalls += r2.calls; mMs += r2.ms; r = r2
        p = parseAction(r2.text, obs.w, obs.h)
      }
      modelMs += mMs
      if ('error' in p) {
        turns.push({ i: turn, ms: Math.round(performance.now() - s0), modelMs: mMs, calls: r.calls, label: '模型回答无法解析', thought: p.error })
        history.push(`- 第 ${turn} 轮 回答无法解析`)
        note = '上一轮的回答不是合法 JSON 动作'
        lastType = 'note'
        continue
      }
      const a: AgentAction = p.action
      if (a.notes.length) cands = mergeCandidates(cands, a.notes, turn)
      const els = parseElements(obs.elements)
      const target = a.id != null ? elText(els.find(e => e.id === a.id)) : a.x != null ? textNear(els, a.x, a.y || 0, obs.w, obs.h) : ''
      const label = actionLabel(a, a.id != null ? target : '')
      const turnRec: AgentTurn = { i: turn, ms: 0, modelMs: mMs, calls: r.calls, label, thought: a.thought }
      const finish = () => { turnRec.ms = Math.round(performance.now() - s0); turns.push(turnRec); opts.onTurn?.(turnRec) }
      emit({ turn, line: a.thought || label, cands: cands.length })
      await bar(`AI 接管 ${turn}/${cfg.maxSteps} · ${a.thought || label}`)
      lastType = a.type
      if (a.type === 'done') { finish(); return out('done', { summary: a.summary || '', pick: a.pick, reason: '' }) }
      if (a.type === 'ask_user') { finish(); return out('ask', { question: a.question, reason: a.question || '' }) }
      if (a.type === 'note') { finish(); history.push(`- 第 ${turn} 轮 ${label}`); continue }
      // 安全：点击前先按元素文字查一次，原生执行时再按真实节点（含可点祖先）查一次
      if (a.type === 'tap' || a.type === 'long') {
        const d = dangerOf(target, cfg.stopBefore, cfg.mode)
        if (d) { finish(); return blocked(d.kind, d.word, target) }
      }
      if (a.type === 'enter' && cfg.stopBefore.includes('send')) {
        const words = els.map(elText).join(' ')
        if (/发送/.test(words) && !/搜索|search/i.test(words)) { finish(); return blocked('send', '回车发送', '当前输入框') }
      }
      const res = await Phone.agentAct({ op: a.type, id: a.id, x: a.x, y: a.y, text: a.text, dir: a.dir, ms: a.ms, guard: a.type === 'tap' || a.type === 'long' ? guard : undefined })
        .catch((e: Error) => ({ ok: false, err: e.message } as { ok: boolean; blocked?: boolean; text?: string; err?: string }))
      if (res.blocked) {
        const d = dangerOf(res.text || '', cfg.stopBefore, cfg.mode)
        finish(); return blocked(d?.kind || 'submit', d?.word || '敏感按钮', (res.text || '').slice(0, 40))
      }
      finish()
      history.push(`- 第 ${turn} 轮 ${label}${res.ok ? '' : `（失败：${res.err || '没成功'}）`}`)
    }
    return out('limit', { reason: `用完了 ${cfg.maxSteps} 轮`, summary: cands.length ? `看了 ${cands.length} 个候选，还没来得及选` : '' })
  } catch (e) {
    return out('fail', { reason: (e as Error).message || String(e) })
  } finally {
    emit({ running: false, line: '' })
  }
  function blocked(kind: StopKind, word: string, tgt: string): AgentOutcome {
    return out('safety', { blocked: { kind, word, target: tgt }, reason: `AI 准备点「${word}」（${STOP_LABEL[kind]}），已停下，需要你自己确认`, summary: '' })
  }
}

/** 结束后：没完成（停在敏感操作前、要登录、要你决定、失败）就回到栖语看卡片；完成时悬浮条给「查看对比」。 */
export async function agentFinish(o: AgentOutcome, inFlow: boolean) {
  if (!isNative) return
  const back = o.status !== 'done' && o.status !== 'stopped'
  if (back) { await Phone.agentEnd({ back: true }).catch(() => {}); return }
  if (o.status === 'done' && !inFlow) await Phone.agentEnd({ text: o.pick ? `AI 选好了：${o.pick.name.slice(0, 18)}` : 'AI 接管完成', offer: o.cfg.output !== 'none' }).catch(() => {})
}

/* ---------- 结果记录（Flow 运行记录里也有一份） */
const K = 'lumi.agentRuns'
export const loadAgentRuns = (): AgentOutcome[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export function saveAgentRun(o: AgentOutcome) {
  const all = [o, ...loadAgentRuns().filter(x => x.id !== o.id)].slice(0, 20)
  try { localStorage.setItem(K, JSON.stringify(all)) } catch { /* 存不下就算了 */ }
}
export { outcomeText }
