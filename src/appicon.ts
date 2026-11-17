/** 应用图标 + 从图标取色，结果缓存在 localStorage。 */
import { useEffect, useState } from 'react'
import { Phone, isNative } from './phone'

export interface AppLook { src?: string; hue: number; sat: number; light: number; pkg?: string }
const K = 'lumi.appicons'
const cache: Record<string, AppLook> = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
const persist = () => { try { localStorage.setItem(K, JSON.stringify(cache)) } catch { /* 太大就算了 */ } }

/** 名字算一个稳定的色相，没有图标时用。 */
export const nameHue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

function analyze(src: string): Promise<{ hue: number; sat: number; light: number }> {
  return new Promise(res => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 32
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 32, 32)
      const d = g.getImageData(0, 0, 32, 32).data
      // 按色相分桶，取最「有颜色」的那一桶
      const bins = new Array(36).fill(0).map(() => ({ w: 0, s: 0, l: 0 }))
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue
        const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dl = mx - mn
        if (dl < 0.12 || l > 0.94 || l < 0.08) continue
        const sat = dl / (1 - Math.abs(2 * l - 1))
        let h = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4
        h = (h * 60 + 360) % 360
        const bin = bins[Math.floor(h / 10)]; const w = sat * sat
        bin.w += w; bin.s += sat * w; bin.l += l * w
      }
      let bi = -1, bw = 0; bins.forEach((x, i) => { if (x.w > bw) { bw = x.w; bi = i } })
      if (bi < 0 || bw < 3) return res({ hue: 222, sat: 0.15, light: 0.25 })
      const b = bins[bi]
      res({ hue: bi * 10 + 5, sat: b.s / b.w, light: b.l / b.w })
    }
    img.onerror = () => res({ hue: 222, sat: 0.15, light: 0.25 })
    img.src = src
  })
}

const pending: Record<string, Promise<AppLook>> = {}
export async function appLook(app: string, pkg?: string): Promise<AppLook> {
  const k = pkg || app
  if (cache[k] && cache[k].hue != null && (cache[k].src || !isNative)) return cache[k]
  if (!pending[k]) pending[k] = (async () => {
    let look: AppLook = { hue: nameHue(app), sat: 0.55, light: 0.5 }
    if (cache[k]?.src) look = { ...cache[k], ...(await analyze(cache[k].src!)) }
    else if (isNative) try {
      const r = await Phone.appIcon({ pkg, name: app })
      look = { src: r.src, pkg: r.pkg, ...(await analyze(r.src)) }
    } catch { /* 没装这个应用 */ }
    cache[k] = look; persist(); return look
  })()
  return pending[k]
}

export function useAppLook(app: string, pkg?: string) {
  const k = pkg || app
  const [l, setL] = useState<AppLook | undefined>(cache[k]?.hue != null ? cache[k] : undefined)
  useEffect(() => { let on = true; appLook(app, pkg).then(x => on && setL(x)); return () => { on = false } }, [app, pkg]) // eslint-disable-line react-hooks/exhaustive-deps
  return l || { hue: nameHue(app), sat: 0.55, light: 0.5 }
}

/** 卡片配色：保证白字可读。 */
export function tint(l: AppLook, shift = 0) {
  const grey = l.sat < 0.2
  const h = (l.hue + shift + 360) % 360
  const s = grey ? 14 : Math.round(Math.min(88, Math.max(52, l.sat * 100)))
  const L = grey ? 26 : Math.round(Math.min(58, Math.max(44, l.light * 100)))
  const yellow = !grey && h >= 40 && h <= 78
  return {
    fg: yellow ? 'hsl(' + h + ' 60% 14%)' : '#fff',
    bg: `linear-gradient(150deg, hsl(${h} ${s}% ${L + 9}%) 0%, hsl(${(h + 12) % 360} ${s}% ${L - 5}%) 100%)`,
    glow: `hsl(${h} ${s}% ${L}% / .38)`,
    solid: `hsl(${h} ${s}% ${L}%)`,
    soft: `hsl(${h} ${Math.min(s, 70)}% 95%)`,
    ink: `hsl(${h} ${s}% ${Math.max(28, L - 16)}%)`,
  }
}
