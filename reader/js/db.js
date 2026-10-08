// IndexedDB storage for everything the reader owns.
// Bibliotheca's own data (mybooks.v1 in localStorage) is only touched by bridge.js.

const NAME = 'bibliotheca-reader'
const VERSION = 1
const STORES = {
  books: 'id',        // metadata, cover blob, position, link to Bibliotheca
  files: 'id',        // original file blob, same id as the book
  reflow: 'id',       // cached PDF reflow output
  highlights: 'id',   // { id, bookId, cfi, text, color, style, note, chapter, page, created }
  notes: 'id',        // { id, bookId, kind, body, chapter, cfi, created, updated }
}

let dbp
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue
        const store = db.createObjectStore(name, { keyPath })
        if (name === 'highlights' || name === 'notes') store.createIndex('bookId', 'bookId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Close other tabs of this app and try again.'))
  })
  return dbp
}

const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

async function tx(store, mode, fn) {
  const db = await open()
  const t = db.transaction(store, mode)
  const result = await fn(t.objectStore(store))
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Storage write was aborted (device may be full).'))
  })
  return result
}

export const get = (store, id) => tx(store, 'readonly', s => done(s.get(id)))
export const all = store => tx(store, 'readonly', s => done(s.getAll()))
export const put = (store, value) => tx(store, 'readwrite', s => done(s.put(value)))
export const del = (store, id) => tx(store, 'readwrite', s => done(s.delete(id)))
export const byBook = (store, bookId) =>
  tx(store, 'readonly', s => done(s.index('bookId').getAll(bookId)))

export async function update(store, id, patch) {
  return tx(store, 'readwrite', async s => {
    const cur = await done(s.get(id))
    if (!cur) return
    const next = { ...cur, ...patch }
    await done(s.put(next))
    return next
  })
}

export async function deleteBook(id) {
  const db = await open()
  const t = db.transaction(Object.keys(STORES), 'readwrite')
  for (const name of ['books', 'files', 'reflow']) t.objectStore(name).delete(id)
  for (const name of ['highlights', 'notes']) {
    const keys = await done(t.objectStore(name).index('bookId').getAllKeys(id))
    for (const k of keys) t.objectStore(name).delete(k)
  }
  return new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error) })
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// Ask the browser not to evict our data under storage pressure.
export async function persist() {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return await navigator.storage?.persist?.() ?? false
  } catch { return false }
}

export async function usage() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, persisted: await navigator.storage.persisted?.() }
  } catch { return null }
}

// ---------- backup / restore ----------
// One JSON file: books (with files and covers as base64), highlights, notes.

const toB64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})
const fromB64 = async url => (await fetch(url)).blob()

export async function backup({ includeFiles = true, onProgress } = {}) {
  const books = await all('books')
  const out = { app: 'bibliotheca-reader', version: 1, created: new Date().toISOString(), books: [], highlights: await all('highlights'), notes: await all('notes') }
  for (const [i, b] of books.entries()) {
    const entry = { ...b, cover: b.cover ? await toB64(b.cover) : null }
    if (includeFiles) {
      const f = await get('files', b.id)
      if (f) entry.file = { name: f.name, type: f.blob.type, data: await toB64(f.blob) }
    }
    out.books.push(entry)
    onProgress?.((i + 1) / books.length)
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' })
}

export async function restore(file) {
  const data = JSON.parse(await file.text())
  if (data?.app !== 'bibliotheca-reader') throw new Error('This is not a Reader backup file.')
  let n = 0
  for (const b of data.books ?? []) {
    const { file: f, cover, ...meta } = b
    await put('books', { ...meta, cover: cover ? await fromB64(cover) : null })
    if (f) await put('files', { id: b.id, name: f.name, blob: await fromB64(f.data) })
    n++
  }
  for (const h of data.highlights ?? []) await put('highlights', h)
  for (const x of data.notes ?? []) await put('notes', x)
  return n
}
