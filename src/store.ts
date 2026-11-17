import type { Msg, Tier } from './api'
export interface Conv { id: string; title: string; tier: Tier; updated: number; messages: Msg[]; agent?: string }
export interface Usage { day: string; cost: number; tokens: number }
const CK = 'lumi.convs', UK = 'lumi.usage'
export const loadConvs = (): Conv[] => { try { return JSON.parse(localStorage.getItem(CK) || '[]') } catch { return [] } }
export const saveConvs = (c: Conv[]) => localStorage.setItem(CK, JSON.stringify(c.slice(0, 200)))
export const loadUsage = (): Usage[] => { try { return JSON.parse(localStorage.getItem(UK) || '[]') } catch { return [] } }
export function addUsage(cost: number, tokens: number) {
  const day = new Date().toISOString().slice(0, 10)
  const u = loadUsage()
  const e = u.find(x => x.day === day)
  if (e) { e.cost += cost; e.tokens += tokens } else u.push({ day, cost, tokens })
  localStorage.setItem(UK, JSON.stringify(u.slice(-60)))
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
export function when(t: number) {
  const d = new Date(t), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5)
  const diff = (now.getTime() - t) / 864e5
  if (diff < 2) return '昨天'
  if (diff < 7) return '周' + '日一二三四五六'[d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
