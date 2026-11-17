export type Tier = 'eco' | 'fast'
export interface Settings {
  baseUrl: string        // OpenAI-compatible endpoint, e.g. your Sub2API gateway
  ecoKey: string         // key bound to the economy group
  fastKey: string        // key bound to the fast group (can equal ecoKey)
  ecoModel: string
  fastModel: string
  thinkModel: string     // used when 深度思考 is on
  ecoPrice: number       // ¥ per 1M output tokens shown in the app (estimate only)
  fastPrice: number
  rechargeUrl: string
}
export const defaultSettings: Settings = {
  baseUrl: 'https://api.deepseek.com',
  ecoKey: '', fastKey: '',
  ecoModel: 'deepseek-chat', fastModel: 'deepseek-chat', thinkModel: 'deepseek-reasoner',
  ecoPrice: 4, fastPrice: 12,
  rechargeUrl: '',
}
const SK = 'lumi.settings'
export function loadSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SK) || '{}') } } catch { return defaultSettings }
}
export function saveSettings(s: Settings) { localStorage.setItem(SK, JSON.stringify(s)) }

export interface Msg { role: 'user' | 'assistant'; content: string; reasoning?: string; tier?: Tier; cost?: number; ms?: number }

export async function streamChat(opts: {
  settings: Settings; tier: Tier; think: boolean; messages: Msg[]; signal: AbortSignal
  onDelta: (text: string, reasoning: string) => void
}): Promise<{ promptTokens: number; completionTokens: number; firstTokenMs: number }> {
  const { settings: s, tier, think } = opts
  const key = tier === 'fast' ? (s.fastKey || s.ecoKey) : (s.ecoKey || s.fastKey)
  if (!key) throw new Error('还没有填写 API Key，请到「设置」里填写。')
  const model = think ? s.thinkModel : tier === 'fast' ? s.fastModel : s.ecoModel
  const t0 = performance.now()
  let first = 0
  const res = await fetch(s.baseUrl.replace(/\/+$/, '') + '/v1/chat/completions', {
    method: 'POST', signal: opts.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, stream: true, stream_options: { include_usage: true },
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
    }),
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`请求失败 ${res.status}${t ? '：' + t.slice(0, 200) : ''}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', text = '', reasoning = '', pt = 0, ct = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const l = line.trim()
      if (!l.startsWith('data:')) continue
      const data = l.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const d = j.choices?.[0]?.delta
        if (d?.content || d?.reasoning_content) {
          if (!first) first = performance.now() - t0
          text += d.content || ''
          reasoning += d.reasoning_content || ''
          opts.onDelta(text, reasoning)
        }
        if (j.usage) { pt = j.usage.prompt_tokens || 0; ct = j.usage.completion_tokens || 0 }
      } catch { /* partial line */ }
    }
  }
  return { promptTokens: pt, completionTokens: ct, firstTokenMs: first }
}
