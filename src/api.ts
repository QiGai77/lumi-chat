/** The only three models the app exposes. The gateway (Sub2API composite group) maps each to a real upstream model. */
export type Tier = 'helium' | 'neon' | 'argon'
export const MODELS: { id: Tier; name: string; desc: string; iq: number }[] = [
  { id: 'helium', name: 'Helium', desc: '轻快 · 日常问答、翻译、总结', iq: 1 },
  { id: 'neon', name: 'Neon', desc: '均衡 · 写作、代码、分析', iq: 2 },
  { id: 'argon', name: 'Argon', desc: '最强 · 复杂推理、长任务', iq: 3 },
]
export const MODEL_NAME: Record<Tier, string> = { helium: 'Helium', neon: 'Neon', argon: 'Argon' }
export const PLANS = [
  { id: 'Pro', price: 50, perks: ['三模型可用', '日常用量'] },
  { id: 'Max', price: 100, perks: ['2.5 倍用量', '高峰优先'] },
  { id: 'Ultra', price: 200, perks: ['6 倍用量', '长任务优先'] },
]

export interface Settings {
  baseUrl: string        // Sub2API gateway
  apiKey: string
  keyUrl: string         // where 获取密钥 goes; empty = {baseUrl}/keys
  purchaseUrl: string    // where 订阅 goes; empty = {baseUrl}/purchase
  genUI: boolean
  rpUser: string         // 角色扮演里 {{user}} 的名字
  rpMyLang: boolean      // 角色卡是外语时也用我的语言回复
  mediaBaseUrl: string
  mediaKey: string
  imageModel: string
  imageSize: string
  videoModel: string
  videoSeconds: number
  theme: 'peach' | 'wallpaper'
}
/** 内置网关的公开客户端密钥：装好就能用，服务端按 IP 限流。 */
export const APP_KEY = 'lumi-app-7f3c9a2e'

export const defaultSettings: Settings = {
  baseUrl: 'https://api.qigai.tech', apiKey: APP_KEY, keyUrl: '', purchaseUrl: '',
  genUI: true, rpUser: '', rpMyLang: true,
  mediaBaseUrl: '', mediaKey: '',
  imageModel: 'gpt-image-1', imageSize: '1024x1024',
  videoModel: 'sora-2', videoSeconds: 4,
  theme: 'peach',
}
const SK = 'lumi.settings'
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SK) || '{}')
    if (!raw.apiKey && (raw.ecoKey || raw.fastKey)) raw.apiKey = raw.ecoKey || raw.fastKey // v0.7 → v0.8
    if (!raw.baseUrl || raw.baseUrl === 'https://api.deepseek.com') delete raw.baseUrl // 空地址用默认网关
    if (!raw.apiKey) delete raw.apiKey // 空密钥用内置密钥
    const s: Record<string, unknown> = { ...defaultSettings }
    for (const k of Object.keys(defaultSettings)) if (k in raw) s[k] = raw[k]
    return s as unknown as Settings
  } catch { return defaultSettings }
}
export const gw = (s: Settings) => s.baseUrl.trim().replace(/\/+$/, '')
export const keyPage = (s: Settings) => s.keyUrl || (gw(s) ? gw(s) + '/keys' : '')
export const purchasePage = (s: Settings) => s.purchaseUrl || (gw(s) ? gw(s) + '/purchase' : '')
export function saveSettings(s: Settings) { localStorage.setItem(SK, JSON.stringify(s)) }

export interface Media { kind: 'image' | 'video'; id: string; prompt: string; status: 'pending' | 'done' | 'error'; error?: string; remote?: string }
export interface Step { name: string; label: string; args: Record<string, unknown>; result?: string; ok?: boolean }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ApiMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
export interface Msg { role: 'user' | 'assistant'; content: string; steps?: Step[]; reasoning?: string; tier?: Tier; cost?: number; ms?: number; media?: Media; fav?: boolean; thinkMs?: number; stopped?: boolean }

export async function streamChat(opts: {
  settings: Settings; tier: Tier; think: boolean; messages: Msg[]; signal: AbortSignal; system?: string; roleplay?: boolean
  raw?: ApiMsg[]; tools?: unknown[]
  onDelta: (text: string, reasoning: string) => void
}): Promise<{ promptTokens: number; completionTokens: number; firstTokenMs: number; text: string; reasoning: string; toolCalls: ToolCall[] }> {
  const { settings: s, tier, think } = opts
  const key = s.apiKey
  if (!gw(s)) throw new Error('还没有填写网关地址，请到「设置」里填写。')
  if (!key) throw new Error('还没有填写 API Key，请到「设置」里填写。')
  const model = tier
  const t0 = performance.now()
  let first = 0
  const res = await fetch(gw(s) + '/v1/chat/completions', {
    method: 'POST', signal: opts.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, stream: true, stream_options: { include_usage: true },
      ...(opts.roleplay ? { lumi_mode: 'roleplay', temperature: 1 } : {}),
      ...(think ? { reasoning_effort: 'high' } : {}),
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        ...(opts.raw ?? opts.messages.filter(m => !m.media).map(m => ({ role: m.role, content: m.content }))),
      ],
    }),
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`请求失败 ${res.status}${t ? '：' + t.slice(0, 200) : ''}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', text = '', reasoning = '', pt = 0, ct = 0
  const calls: ToolCall[] = []
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
        for (const tc of d?.tool_calls || []) {
          const k = tc.index ?? calls.length
          const c = calls[k] || (calls[k] = { id: '', type: 'function', function: { name: '', arguments: '' } })
          if (tc.id) c.id = tc.id
          if (tc.function?.name) c.function.name += tc.function.name
          if (tc.function?.arguments) c.function.arguments += tc.function.arguments
        }
        if (j.usage) { pt = j.usage.prompt_tokens || 0; ct = j.usage.completion_tokens || 0 }
      } catch { /* partial line */ }
    }
  }
  return { promptTokens: pt, completionTokens: ct, firstTokenMs: first, text, reasoning, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })) }
}

const root = (s: Settings) => (s.mediaBaseUrl || s.baseUrl).replace(/\/+$/, '') + '/v1'
const mkey = (s: Settings) => {
  const k = s.mediaKey || s.apiKey
  if (!k) throw new Error('还没有填写 API Key，请到「设置」里填写。')
  return k
}
async function fail(res: Response): Promise<never> {
  const t = await res.text().catch(() => '')
  throw new Error(`请求失败 ${res.status}${t ? '：' + t.slice(0, 200) : ''}`)
}

/** OpenAI-compatible POST /v1/images/generations. Returns a Blob (from b64_json) or a remote URL. */
export async function generateImage(s: Settings, prompt: string, signal: AbortSignal): Promise<{ blob?: Blob; url?: string }> {
  const res = await fetch(root(s) + '/images/generations', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mkey(s)}` },
    body: JSON.stringify({ model: s.imageModel, prompt, size: s.imageSize, n: 1 }),
  })
  if (!res.ok) await fail(res)
  const j = await res.json()
  const d = j.data?.[0] || {}
  if (d.b64_json) return { blob: await (await fetch('data:image/png;base64,' + d.b64_json)).blob() }
  if (d.url) return { url: d.url }
  throw new Error('接口没有返回图片')
}

/** OpenAI-compatible video jobs: POST /v1/videos → poll GET /v1/videos/{id} → GET /v1/videos/{id}/content. */
export async function generateVideo(s: Settings, prompt: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<{ blob?: Blob; url?: string }> {
  const h = { Authorization: `Bearer ${mkey(s)}` }
  const res = await fetch(root(s) + '/videos', {
    method: 'POST', signal, headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.videoModel, prompt, seconds: String(s.videoSeconds) }),
  })
  if (!res.ok) await fail(res)
  let j = await res.json()
  const direct = (x: Record<string, unknown>) => (x.url || x.video_url || (x as { data?: { url?: string }[] }).data?.[0]?.url) as string | undefined
  if (direct(j)) return { url: direct(j) }
  const id = j.id
  if (!id) throw new Error('接口没有返回任务 id')
  for (let i = 0; i < 360; i++) {
    if (j.status === 'completed' || j.status === 'succeeded') break
    if (j.status === 'failed' || j.status === 'cancelled') throw new Error(j.error?.message || '视频生成失败')
    onProgress(Number(j.progress) || 0)
    await new Promise(r => setTimeout(r, 5000))
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const r = await fetch(`${root(s)}/videos/${id}`, { headers: h, signal })
    if (!r.ok) await fail(r)
    j = await r.json()
    if (direct(j)) return { url: direct(j) }
  }
  const c = await fetch(`${root(s)}/videos/${id}/content`, { headers: h, signal })
  if (!c.ok) await fail(c)
  return { blob: await c.blob() }
}

export interface GatewayUsage {
  planName?: string
  mode?: string
  remaining?: number
  balance?: number
  subscription?: { daily_usage_usd: number; weekly_usage_usd: number; monthly_usage_usd: number; daily_limit_usd?: number | null; weekly_limit_usd?: number | null; monthly_limit_usd?: number | null; expires_at?: string }
  daily_usage?: { date: string; requests: number; total_tokens: number; cost: number; actual_cost: number }[]
}
/** Sub2API GET /v1/usage — plan, limits and per-day usage for this API key. */
export async function fetchUsage(s: Settings, signal?: AbortSignal): Promise<GatewayUsage> {
  if (!gw(s) || !s.apiKey) throw new Error('未配置网关')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const res = await fetch(`${gw(s)}/v1/usage?days=14&timezone=${encodeURIComponent(tz)}`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal })
  if (!res.ok) await fail(res)
  return await res.json()
}
