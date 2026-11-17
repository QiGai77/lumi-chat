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
  genUI: boolean         // let the model answer with lumi-ui cards
  mediaBaseUrl: string   // image / video endpoint (OpenAI-compatible); empty = same as baseUrl
  mediaKey: string       // empty = eco key
  imageModel: string
  imageSize: string
  videoModel: string
  videoSeconds: number
  theme: 'peach' | 'wallpaper'
}
export const defaultSettings: Settings = {
  baseUrl: 'https://api.deepseek.com',
  ecoKey: '', fastKey: '',
  ecoModel: 'deepseek-chat', fastModel: 'deepseek-chat', thinkModel: 'deepseek-reasoner',
  ecoPrice: 4, fastPrice: 12,
  rechargeUrl: '',
  genUI: true,
  mediaBaseUrl: '', mediaKey: '',
  imageModel: 'gpt-image-1', imageSize: '1024x1024',
  videoModel: 'sora-2', videoSeconds: 4,
  theme: 'peach',
}
const SK = 'lumi.settings'
export function loadSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SK) || '{}') } } catch { return defaultSettings }
}
export function saveSettings(s: Settings) { localStorage.setItem(SK, JSON.stringify(s)) }

export interface Media { kind: 'image' | 'video'; id: string; prompt: string; status: 'pending' | 'done' | 'error'; error?: string; remote?: string }
export interface Msg { role: 'user' | 'assistant'; content: string; reasoning?: string; tier?: Tier; cost?: number; ms?: number; media?: Media }

export async function streamChat(opts: {
  settings: Settings; tier: Tier; think: boolean; messages: Msg[]; signal: AbortSignal; system?: string
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
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        ...opts.messages.filter(m => !m.media).map(m => ({ role: m.role, content: m.content })),
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

const root = (s: Settings) => (s.mediaBaseUrl || s.baseUrl).replace(/\/+$/, '') + '/v1'
const mkey = (s: Settings) => {
  const k = s.mediaKey || s.ecoKey || s.fastKey
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
