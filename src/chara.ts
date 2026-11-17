/**
 * 角色扮演：酒馆（SillyTavern）角色卡导入与提示词拼装。
 * 支持 PNG 卡（tEXt/iTXt 里的 chara / ccv3）、JSON 卡（V1 / V2 / V3）、chub.ai / characterhub 页面链接、直接的 PNG / JSON 链接。
 */
import type { Msg, Settings } from './api'
import { putBlob } from './media'
import { uid } from './store'

export interface BookEntry { keys: string[]; content: string; enabled: boolean; constant?: boolean; secondary?: string[]; selective?: boolean; order?: number }
export interface Character {
  id: string; name: string; avatar?: string // media blob id
  description: string; personality: string; scenario: string
  first_mes: string; alternate_greetings: string[]; mes_example: string
  system_prompt: string; post_history: string; creator_notes: string
  tags: string[]; creator?: string; book: BookEntry[]; source?: string; created: number
}

const K = 'lumi.chars'
export const loadChars = (): Character[] => { try { return JSON.parse(localStorage.getItem(K) || '[]') } catch { return [] } }
export const saveChars = (c: Character[]) => localStorage.setItem(K, JSON.stringify(c))
export const charById = (id?: string) => id ? loadChars().find(c => c.id === id) : undefined

/* ---------- 解析 */

const s = (v: unknown) => typeof v === 'string' ? v : ''
const arr = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : []

/** 把任意版本的卡 JSON 规范成 Character（不含 id / avatar）。 */
export function normalize(raw: unknown): Omit<Character, 'id' | 'created'> {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = (j.data && typeof j.data === 'object' ? j.data : j) as Record<string, unknown>
  const name = s(d.name) || s(j.char_name) || s(j.name)
  if (!name) throw new Error('这不是角色卡：找不到角色名')
  const book = (d.character_book && typeof d.character_book === 'object' ? (d.character_book as Record<string, unknown>).entries : null)
  const entries: BookEntry[] = (Array.isArray(book) ? book : book && typeof book === 'object' ? Object.values(book) : [])
    .map((e: Record<string, unknown>) => ({
      keys: arr(e.keys ?? e.key), content: s(e.content), enabled: e.enabled !== false && e.disable !== true,
      constant: !!e.constant, secondary: arr(e.secondary_keys ?? e.keysecondary), selective: !!e.selective,
      order: typeof e.insertion_order === 'number' ? e.insertion_order : typeof e.order === 'number' ? e.order : 100,
    })).filter(e => e.content)
  return {
    name,
    description: s(d.description) || s(j.char_persona),
    personality: s(d.personality),
    scenario: s(d.scenario) || s(j.world_scenario),
    first_mes: s(d.first_mes) || s(j.char_greeting),
    alternate_greetings: arr(d.alternate_greetings),
    mes_example: s(d.mes_example) || s(j.example_dialogue),
    system_prompt: s(d.system_prompt),
    post_history: s(d.post_history_instructions),
    creator_notes: s(d.creator_notes),
    tags: arr(d.tags), creator: s(d.creator) || undefined,
    book: entries,
  }
}

function b64utf8(b64: string) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 读 PNG 里的角色数据：优先 ccv3，其次 chara。 */
export function readPng(buf: ArrayBuffer): unknown {
  const v = new DataView(buf), u8 = new Uint8Array(buf)
  if (u8[0] !== 0x89 || u8[1] !== 0x50) throw new Error('不是 PNG 图片')
  const found: Record<string, string> = {}
  const latin = new TextDecoder('latin1'), utf8 = new TextDecoder()
  for (let i = 8; i + 8 <= u8.length;) {
    const n = v.getUint32(i), type = latin.decode(u8.subarray(i + 4, i + 8)), d = u8.subarray(i + 8, i + 8 + n)
    if (type === 'tEXt' || type === 'iTXt') {
      const z = d.indexOf(0), key = latin.decode(d.subarray(0, z)).toLowerCase()
      if (key === 'chara' || key === 'ccv3') {
        let text: string
        if (type === 'tEXt') text = latin.decode(d.subarray(z + 1))
        else { // iTXt: keyword\0 flag method lang\0 translated\0 text
          let p = z + 3; p = d.indexOf(0, p) + 1; p = d.indexOf(0, p) + 1
          text = utf8.decode(d.subarray(p))
        }
        found[key] = text
      }
    }
    if (type === 'IEND') break
    i += 12 + n
  }
  const t = found.ccv3 || found.chara
  if (!t) throw new Error('这张图片里没有角色卡数据')
  return JSON.parse(b64utf8(t))
}

/* ---------- 导入 */

const gw = (st: Settings) => (st.baseUrl || '').replace(/\/+$/, '')

/** 通过网关代理下载（绕开跨域）。 */
async function proxied(st: Settings, url: string) {
  const r = await fetch(`${gw(st)}/v1/card?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${st.apiKey}` } })
  if (!r.ok) {
    let m = `下载失败（${r.status}）`
    try { m = (await r.json()).error?.message || m } catch { /* */ }
    throw new Error(m)
  }
  return { type: r.headers.get('Content-Type') || '', buf: await r.arrayBuffer() }
}

/** 把常见角色站页面链接转成能直接下载卡片的地址。 */
export function cardUrl(link: string): string[] {
  const u = new URL(link.trim())
  const h = u.hostname.replace(/^www\./, '')
  const path = u.pathname.replace(/\/+$/, '')
  // chub.ai / characterhub.org：/characters/作者/角色名
  const m = path.match(/^\/characters\/([^/]+\/[^/]+)/)
  if ((h.endsWith('chub.ai') || h.endsWith('characterhub.org')) && m) {
    return [`https://avatars.charhub.io/avatars/${m[1]}/chara_card_v2.png`, `https://api.chub.ai/api/characters/${m[1]}?full=true`]
  }
  return [u.toString()]
}

async function fromBuffer(type: string, buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf.slice(0, 8))
  if (u8[0] === 0x89 && u8[1] === 0x50) return { data: normalize(readPng(buf)), png: new Blob([buf], { type: 'image/png' }) }
  const text = new TextDecoder().decode(buf).trim()
  if (text.startsWith('{')) {
    const j = JSON.parse(text)
    // chub API：{ node: { definition: {...}, max_res_url } }
    if (j.node?.definition) {
      const d = j.node.definition
      return { data: normalize({ data: { ...d, name: d.name || j.node.name, first_mes: d.first_message, mes_example: d.example_dialogs, system_prompt: d.system_prompt, post_history_instructions: d.post_history_instructions, character_book: d.embedded_lorebook, tags: j.node.topics, creator: j.node.fullPath?.split('/')[0] } }), img: j.node.max_res_url || j.node.avatar_url }
    }
    return { data: normalize(j) }
  }
  if (/html/.test(type) || text.startsWith('<')) {
    const og = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
    if (og) return { next: og }
    throw new Error('这个页面里找不到角色卡，换成 PNG 卡或 JSON 的直链试试')
  }
  throw new Error('认不出这个文件，只支持 PNG 角色卡或 JSON')
}

async function finish(data: Omit<Character, 'id' | 'created'>, png?: Blob, source?: string): Promise<Character> {
  const c: Character = { ...data, id: uid(), created: Date.now(), source }
  if (png) { const id = 'char-' + c.id; await putBlob(id, png); c.avatar = id }
  return c
}

export async function importLink(st: Settings, link: string): Promise<Character> {
  let urls: string[]
  try { urls = cardUrl(link) } catch { throw new Error('链接格式不对') }
  let last: Error | null = null
  for (let url of urls) {
    try {
      for (let hop = 0; hop < 2; hop++) {
        const { type, buf } = await proxied(st, url)
        const r = await fromBuffer(type, buf)
        if ('next' in r && r.next) { url = new URL(r.next, url).toString(); continue }
        if (!('data' in r) || !r.data) break
        let png = 'png' in r ? r.png : undefined
        if (!png && 'img' in r && r.img) { try { const im = await proxied(st, r.img); png = new Blob([im.buf], { type: im.type || 'image/png' }) } catch { /* 没头像也能用 */ } }
        return await finish(r.data, png, link.trim())
      }
    } catch (e) { last = e as Error }
  }
  throw last || new Error('导入失败')
}

export async function importFile(f: File): Promise<Character> {
  const buf = await f.arrayBuffer()
  const r = await fromBuffer(f.type, buf)
  if (!('data' in r) || !r.data) throw new Error('认不出这个文件')
  return finish(r.data, 'png' in r ? r.png : undefined)
}

export const blankChar = (): Character => ({ id: uid(), name: '', description: '', personality: '', scenario: '', first_mes: '', alternate_greetings: [], mes_example: '', system_prompt: '', post_history: '', creator_notes: '', tags: [], book: [], created: Date.now() })

/* ---------- 提示词 */

export function macros(t: string, char: string, user: string) {
  return t.replace(/\{\{char\}\}|<BOT>/gi, char).replace(/\{\{user\}\}|<USER>/gi, user).replace(/\{\{original\}\}/gi, '').replace(/\{\{\/?(trim|noop)\}\}/gi, '')
}

/** 世界书：常驻条目 + 最近几条消息里命中关键词的条目。 */
function lore(c: Character, recent: string) {
  const low = recent.toLowerCase()
  const hit = (k: string) => k && low.includes(k.toLowerCase())
  return c.book.filter(e => e.enabled && (e.constant || (e.keys.some(hit) && (!e.selective || !e.secondary?.length || e.secondary.some(hit)))))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)).map(e => e.content)
}

export function rpSystem(c: Character, user: string, history: Msg[], myLang = true) {
  const m = (t: string) => macros(t, c.name, user).trim()
  const recent = history.slice(-6).map(x => x.content).join('\n')
  const parts = [
    m(c.system_prompt) || `你将扮演 ${c.name}，和 ${user} 进行沉浸式角色扮演。保持人设一致，主动推进情节，描写细腻，不要替 ${user} 说话或行动。`,
    c.description && `【${c.name} 的设定】\n${m(c.description)}`,
    c.personality && `【性格】\n${m(c.personality)}`,
    c.scenario && `【场景】\n${m(c.scenario)}`,
    ...lore(c, recent).map(t => `【世界设定】\n${m(t)}`),
    c.mes_example && `【对话示例（只参考语气和格式，不是已经发生的事）】\n${m(c.mes_example).replace(/<START>/gi, '---')}`,
    c.post_history && `【额外要求】\n${m(c.post_history)}`,
    myLang && `【语言】角色卡可能是用别的语言写的；请始终使用 ${user} 最近一条消息所用的语言来写回复（人名、专有名词可以保留原文）。`,
  ]
  return parts.filter(Boolean).join('\n\n')
}

export const greetings = (c: Character, user: string) => [c.first_mes, ...c.alternate_greetings].filter(Boolean).map(g => macros(g, c.name, user))
