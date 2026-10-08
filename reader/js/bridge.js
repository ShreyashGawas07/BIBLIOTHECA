// The only place that reads or writes Bibliotheca's data (localStorage "mybooks.v1").
// Every write re-reads the latest data first so we never overwrite changes made in Bibliotheca.
// Rules mirror Bibliotheca's setCur(): forward progress adds to today's log,
// first progress marks the book "reading", reaching the last page marks it "finished".

const K = 'mybooks.v1'
const ds = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10)

function read() {
  try { return JSON.parse(localStorage.getItem(K) || 'null') } catch { return null }
}
function write(D) {
  localStorage.setItem(K, JSON.stringify(D))
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

export const available = () => !!read()

export function books() {
  return (read()?.books ?? []).map(b => ({ id: b.id, title: b.title, author: b.author, cur: b.cur, total: b.total, status: b.status, cover: b.cover }))
}

export const find = id => books().find(b => b.id === id)

// Best guess at an existing Bibliotheca entry for an imported file.
export function match(title) {
  const t = norm(title)
  if (!t) return null
  const list = books()
  return list.find(b => norm(b.title) === t)
    ?? list.find(b => t.length > 6 && (norm(b.title).startsWith(t) || t.startsWith(norm(b.title)))) ?? null
}

export function create({ title, author, total, source }) {
  const D = read() ?? { books: [] }
  D.books ??= []
  const b = {
    id: Date.now().toString(36) + 'r', title: title || 'Untitled', author: author || '',
    source: source || '', status: 'want', cur: 0, total: total || 0, rating: 0,
    finished: '', started: '', notes: '', cover: '', added: Date.now(), upd: Date.now(),
  }
  D.books.push(b)
  write(D)
  return b.id
}

// Fix a title we created earlier (e.g. with a download-site tag), leaving names you edited alone.
export function retitle(id, oldTitle, title, author) {
  const D = read(); const b = D?.books?.find(x => x.id === id)
  if (!b || b.title !== oldTitle) return
  b.title = title; if (!b.author && author) b.author = author
  b.upd = Date.now(); write(D)
}

export function setTotal(id, total) {
  const D = read(); const b = D?.books?.find(x => x.id === id)
  if (!b || !total || b.total) return
  b.total = total; b.upd = Date.now(); write(D)
}

// Record that the reader is now on `page`. Only forward movement counts.
// With log=false (a jump via contents/search) the page moves but nothing is added to the day's log.
// Returns the number of pages added to today's log.
export function progress(id, page, { log = true } = {}) {
  const D = read(); const b = D?.books?.find(x => x.id === id)
  if (!b) return 0
  let v = Math.max(0, Math.round(page))
  if (b.total) v = Math.min(b.total, v)
  const d = v - (b.cur || 0)
  if (d <= 0) return 0
  const today = ds()
  D.log ??= {}
  if (log) D.log[today] = (+D.log[today] || 0) + d
  b.cur = v; b.upd = Date.now()
  if (b.status === 'want' || b.status === 'dropped') { b.status = 'reading'; b.started ||= today }
  if (log && b.total && v >= b.total && b.status !== 'finished') { b.status = 'finished'; b.finished = today }
  write(D)
  return log ? d : 0
}

export function pagesToday() {
  return +(read()?.log?.[ds()]) || 0
}
