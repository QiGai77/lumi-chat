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

/** 卡片配色（v0.17）：iOS 快捷指令式的饱和渐变卡，白字。
 * 每个色族三色：deep（文字所在的左下区域，白字对比度 ≥5.8:1，WCAG AA）、mid（主色）、hi（右上角高光，不放文字）。
 * 背景是 CSS 写的 mesh gradient（几层 radial-gradient 叠在线性渐变上）+ 底部淡黑纱 + SVG 颗粒（见 index.css .mesh），
 * 全部是本仓库自己写的，CC0，不依赖外部图片。低饱和图标（黑白灰）用石墨色。
 * 返回结构与 v0.16 兼容：fg 文字色、bg 背景、glow 阴影、solid 主色（时间线节点）、soft 浅底（时间线连线 / 浅色头卡）。 */
export const FAMILIES = [
  { name: 'coral', deep: '#B8361F', mid: '#E85A3C', hi: '#FFB08A', soft: '#FFE7DE' },
  { name: 'amber', deep: '#A84A0B', mid: '#E07A1C', hi: '#FFD08A', soft: '#FFEEDB' },
  { name: 'green', deep: '#0C6E4C', mid: '#1E9A66', hi: '#93E3B8', soft: '#DDF4E8' },
  { name: 'teal', deep: '#0A6372', mid: '#138E9E', hi: '#86DCE2', soft: '#DAF2F4' },
  { name: 'blue', deep: '#1C47B0', mid: '#3471E6', hi: '#A3C6FF', soft: '#E1ECFF' },
  { name: 'indigo', deep: '#33289C', mid: '#5848D8', hi: '#B8ADFF', soft: '#E9E6FF' },
  { name: 'violet', deep: '#6E2491', mid: '#9A42C6', hi: '#E6ADFF', soft: '#F3E3FB' },
  { name: 'rose', deep: '#A41F52', mid: '#D63F78', hi: '#FFAACA', soft: '#FFE3EE' },
] as const
const GRAPHITE = { name: 'graphite', deep: '#273042', mid: '#465372', hi: '#A6B2C8', soft: '#E6EAF1' }
const familyOf = (hue: number) => hue < 18 || hue >= 345 ? 0 : hue < 48 ? 1 : hue < 72 ? 1 : hue < 165 ? 2 : hue < 196 ? 3 : hue < 236 ? 4 : hue < 266 ? 5 : hue < 300 ? 6 : 7
export const meshBg = (f: { deep: string; mid: string; hi: string }) =>
  `radial-gradient(85% 70% at 100% 0%, ${f.hi}cc 0%, ${f.hi}00 62%), radial-gradient(70% 55% at 12% 6%, ${f.mid} 0%, ${f.mid}00 70%), radial-gradient(110% 90% at 0% 100%, ${f.deep} 0%, ${f.deep}00 72%), linear-gradient(160deg, ${f.mid} 0%, ${f.deep} 100%)`
export function tint(l: AppLook, shift = 0) {
  const base = l.sat < 0.18 ? -1 : familyOf((l.hue + 360) % 360)
  const step = Math.round(shift / 18)
  const f = base < 0 ? (step ? FAMILIES[(4 + step + 80) % 8] : GRAPHITE) : FAMILIES[(base + step + 80) % 8]
  return { fg: '#FFFFFF', bg: meshBg(f), glow: f.deep + '66', solid: f.mid, soft: f.soft, ink: f.deep, family: f.name }
}
