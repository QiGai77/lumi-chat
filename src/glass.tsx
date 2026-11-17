/*
 * Liquid Glass surface for the web / Android WebView.
 * Material numbers follow miuix-glass (compose-miuix-ui/miuix, Apache-2.0):
 *   PuredThinGlass  - blur, 60% white soft-light + 40% white hard-light, 0.8dp lit edge stroke
 *   DialogGlass     - wider blur, heavier white
 * Rim refraction: a displacement map with a hemispheric bevel is generated per surface and fed to an
 * SVG feDisplacementMap used as backdrop-filter (Chromium / Android WebView). Other engines fall back
 * to blur + saturate.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const supportsSvgBackdrop = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Chrome|Chromium|wv\)/.test(ua) && !/Firefox/.test(ua)
})()

function sdf(px: number, py: number, w: number, h: number, r: number) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r)
  const qy = Math.abs(py - h / 2) - (h / 2 - r)
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

const cache = new Map<string, string>()
function displacementMap(w: number, h: number, r: number) {
  const key = `${w}x${h}r${r}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const edge = Math.min(r, Math.min(w, h) / 2) * 0.9 + 1e-3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5
      const d = sdf(px, py, w, h, r)
      const depth = Math.min(Math.max(-d / edge, 0), 1)
      const height = Math.sqrt(1 - (1 - depth) ** 2)
      const bend = (1 - height) ** 1.5
      const gx = sdf(px + 1, py, w, h, r) - sdf(px - 1, py, w, h, r)
      const gy = sdf(px, py + 1, w, h, r) - sdf(px, py - 1, w, h, r)
      const n = Math.hypot(gx, gy) || 1
      const i = (y * w + x) * 4
      img.data[i] = 128 + (gx / n) * bend * 127
      img.data[i + 1] = 128 + (gy / n) * bend * 127
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const url = c.toDataURL()
  if (cache.size > 40) cache.clear()
  cache.set(key, url)
  return url
}

export type GlassVariant = 'regular' | 'clear' | 'dialog' | 'tint'

export function Glass({ children, radius, variant = 'regular', className = '', style, onClick, refract = true }: {
  children?: ReactNode; radius?: number; variant?: GlassVariant; className?: string; style?: CSSProperties
  onClick?: () => void; refract?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = 'lg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight)
      setSize(s => (s && s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const r = size ? Math.min(radius ?? Math.min(size.w, size.h) / 2, size.w / 2, size.h / 2) : radius ?? 999
  const useSvg = refract && supportsSvgBackdrop && size && size.w > 0 && size.h > 0
  const [map, setMap] = useState<string | null>(null)
  useEffect(() => {
    if (useSvg && size) setMap(displacementMap(size.w, size.h, r))
  }, [useSvg, size?.w, size?.h, r])

  const blur = { regular: 6, clear: 1.6, dialog: 22, tint: 6 }[variant]
  const scale = Math.min(r, 40) * (variant === 'dialog' ? 0.8 : 1.1)
  const backdrop = useSvg && map
    ? `url(#${id}) blur(${blur}px) saturate(170%)`
    : `blur(${blur}px) saturate(170%)`

  return (
    <div ref={ref} className={`glass glass-${variant} ${className}`} onClick={onClick}
      style={{ borderRadius: r, backdropFilter: backdrop, WebkitBackdropFilter: `blur(${blur}px) saturate(170%)`, ...style }}>
      {useSvg && map && size && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width={size.w} height={size.h} result="map" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={-scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  )
}
