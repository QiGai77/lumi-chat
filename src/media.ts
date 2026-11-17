/* Generated images / videos live in IndexedDB (localStorage is too small for them). */
const DB = 'lumi-media', ST = 'blobs'
function db(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(ST)
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error)
  })
}
export async function putBlob(id: string, b: Blob) {
  const d = await db()
  await new Promise((ok, bad) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(b, id); t.oncomplete = ok; t.onerror = () => bad(t.error) })
}
const urls = new Map<string, string>()
export async function blobUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!
  const d = await db()
  const b = await new Promise<Blob | undefined>((ok, bad) => { const r = d.transaction(ST).objectStore(ST).get(id); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error) })
  if (!b) return null
  const u = URL.createObjectURL(b); urls.set(id, u); return u
}
export async function putKV(id: string, v: string) { await putBlob(id, new Blob([v])) }
export async function getKV(id: string) { const u = await blobUrl(id); return u ? await (await fetch(u)).text() : null }
