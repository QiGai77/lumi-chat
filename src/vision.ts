/** Flow 的 AI 视觉定位（v0.17）。
 * 只在选择器没命中时调用：原生把截图（长边 720px、JPEG q60）和精简元素列表发过来，这里用 Helium 一次非流式请求定位，
 * 关闭深度思考（不发 reasoning_effort，网关会设 thinking: disabled）、max_tokens 很小、只要一行 JSON。
 * 诚实口径：这一步一定有一次模型往返，快慢取决于网络与模型；缓存命中的步骤走原生，不经过这里。
 * 网关上游如果不支持图片，会自动退回只发元素列表（本次会话记住，不再发图）。 */
import { gw, type Settings } from './api'

export interface VisionReq { id: string; goal: string; act: string; elements: string; image?: string; w: number; h: number }
export interface VisionAns { i?: number; x?: number; y?: number; none?: boolean; ms: number; image: boolean }

const NO_IMG = 'lumi.visionNoImage'
const SYSTEM = '你是手机界面定位器。根据目标，在元素列表（和截图）里找出要操作的那一个。只输出一行 JSON：{"i":元素编号}；列表里没有但截图里有时输出 {"x":0到1,"y":0到1}（占屏幕宽高的比例）；确实没有输出 {"none":true}。不要解释。'

export function visionPrompt(r: VisionReq): string {
  const els = r.elements.length > 3500 ? r.elements.slice(0, 3500) + '\n…' : r.elements
  return `目标：${r.act === 'input' ? '要输入文字的输入框：' : r.act === 'long' ? '要长按的：' : '要点击的：'}${r.goal}\n屏幕 ${r.w}x${r.h}，元素（[编号] 类型 "文字" (描述) {属性} @像素中心）：\n${els}`
}

/** 从模型回答里取第一个 JSON 对象；像素坐标会换成比例。 */
export function parseAnswer(text: string, w: number, h: number): Omit<VisionAns, 'ms' | 'image'> {
  const m = /\{[^{}]*\}/.exec(text || '')
  if (!m) return { none: true }
  try {
    const j = JSON.parse(m[0]) as { i?: unknown; x?: unknown; y?: unknown; none?: unknown }
    if (j.none) return { none: true }
    if (j.i != null && Number.isInteger(Number(j.i))) return { i: Number(j.i) }
    let x = Number(j.x), y = Number(j.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x > 1 || y > 1) { x /= w || 1; y /= h || 1 }
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
    }
  } catch { /* 不是合法 JSON */ }
  return { none: true }
}

export async function visionLocate(s: Settings, r: VisionReq, timeoutMs = 12000): Promise<VisionAns> {
  const useImg = !!r.image && sessionStorage.getItem(NO_IMG) !== '1'
  const t0 = performance.now()
  const call = async (img: boolean) => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const content = img
        ? [{ type: 'text', text: visionPrompt(r) }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + r.image, detail: 'low' } }]
        : visionPrompt(r)
      return await fetch(gw(s) + '/v1/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: 'helium', stream: false, temperature: 0, max_tokens: 40, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
      })
    } finally { clearTimeout(tm) }
  }
  let res = await call(useImg)
  let sentImg = useImg
  if (!res.ok && useImg && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
    sessionStorage.setItem(NO_IMG, '1') // 上游不收图：退回只发元素列表
    res = await call(false); sentImg = false
  }
  if (!res.ok) throw new Error(`模型请求失败 ${res.status}`)
  const j = await res.json() as { choices?: { message?: { content?: string } }[] }
  return { ...parseAnswer(j.choices?.[0]?.message?.content || '', r.w, r.h), ms: Math.round(performance.now() - t0), image: sentImg }
}
