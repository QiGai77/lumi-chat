/** 项目、MCP 服务器、定时任务：都只存本机 localStorage。 */
export interface Project { id: string; name: string; instructions: string; tone: 'coral' | 'sage' | 'gold' | 'plum'; created: number }
export interface McpTool { name: string; description?: string }
export interface McpServer { id: string; name: string; url: string; site?: string; token: string; enabled: boolean; tools: McpTool[]; status: 'unknown' | 'ok' | 'error'; error?: string }
export interface Task { id: string; name: string; prompt: string; time: string; days: number[]; enabled: boolean; lastRun?: number; lastConv?: string }

const load = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
export const loadProjects = () => load<Project>('lumi.projects')
export const saveProjects = (v: Project[]) => save('lumi.projects', v)
export const loadMcp = () => load<McpServer>('lumi.mcp')
export const saveMcp = (v: McpServer[]) => save('lumi.mcp', v)
export const loadTasks = () => load<Task>('lumi.tasks')
export const saveTasks = (v: Task[]) => save('lumi.tasks', v)

/** Most recent scheduled moment (today or earlier this week) at or before now, or 0. */
export function lastDue(t: Task, now = new Date()): number {
  const [h, m] = t.time.split(':').map(Number)
  for (let back = 0; back < 8; back++) {
    const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(h || 0, m || 0, 0, 0)
    if (d.getTime() > now.getTime()) continue
    if (t.days.length === 0 || t.days.includes(d.getDay())) return d.getTime()
  }
  return 0
}
export const isDue = (t: Task) => { if (!t.enabled) return false; const d = lastDue(t); return d > 0 && (t.lastRun || 0) < d && Date.now() - d < 6 * 3600e3 }

/** MCP Streamable HTTP: initialize → notifications/initialized → tools/list. Returns the tool list. */
async function rpc(s: McpServer, body: object, session?: string): Promise<{ json: any; session?: string }> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}`)
  const sid = res.headers.get('mcp-session-id') || session
  const text = await res.text()
  if (!text) return { json: null, session: sid }
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean)
    return { json: data.length ? JSON.parse(data[data.length - 1]) : null, session: sid }
  }
  return { json: JSON.parse(text), session: sid }
}
export async function probeMcp(s: McpServer): Promise<McpTool[]> {
  const init = await rpc(s, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lumi-chat', version: '0.11' } } })
  if (init.json?.error) throw new Error(init.json.error.message || '初始化失败')
  await rpc(s, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session).catch(() => null)
  const list = await rpc(s, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.session)
  if (list.json?.error) throw new Error(list.json.error.message || '读取工具失败')
  return (list.json?.result?.tools || []).map((t: McpTool) => ({ name: t.name, description: t.description }))
}
