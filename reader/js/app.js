// Library, import, routing, storage & backup.

import * as db from './db.js'
import * as bridge from './bridge.js'
import * as prefs from './settings.js'
import { detect, checkDRM, fingerprint, thumbnail, LABEL, SUPPORTED, ReaderError, formatTitle, formatAuthor, titleFromFilename, cleanTitle } from './formats.js'
import { $, $$, esc, icon, toast, sheet, close, fmtBytes, fmtDate, download } from './ui.js'

let books = []
let coverURLs = new Map()
let reader // lazy-loaded reader module
let pendingBib = null // Bibliotheca book id we are importing a file for

// ---------- boot ----------
init()
async function init() {
  document.documentElement.dataset.theme = prefs.themeName()
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!reader?.isOpen()) document.documentElement.dataset.theme = prefs.themeName() })
  $('#add').innerHTML = icon('add')
  $('#more').innerHTML = icon('more')
  $('#to-bib').insertAdjacentHTML('afterbegin', icon('library', 18))
  $('#add').onclick = () => $('#file').click()
  $('#more').onclick = openStorage
  $('#file').accept = SUPPORTED
  $('#file').onchange = e => { importFiles([...e.target.files]); e.target.value = '' }
  setupDrop()
  // opened straight into a book: don't flash the library first
  if (/^#\/read\//.test(location.hash)) { document.body.classList.add('reading'); $('#reader').hidden = false }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {})
  addEventListener('popstate', route)
  await refresh()
  route()
}

async function refresh() {
  books = (await db.all('books')).sort((a, b) => (b.lastOpened || b.added) - (a.lastOpened || a.added))
  // tidy titles imported before cleanTitle existed
  for (const b of books) {
    const c = cleanTitle(b.title, b.author)
    if (c.title !== b.title || c.author !== b.author) {
      if (b.bibId) bridge.retitle(b.bibId, b.title, c.title, c.author)
      Object.assign(b, c); db.update('books', b.id, c)
    }
  }
  renderLibrary()
}

// ---------- routing ----------
// #/read/<id>      open a book
// #/open?bib=<id>  coming from Bibliotheca's "Read" button
async function route() {
  const h = location.hash
  const read = h.match(/^#\/read\/([\w-]+)/)
  if (read) return openBook(read[1])
  if (reader?.isOpen()) await reader.closeReader()
  document.documentElement.dataset.theme = prefs.themeName()
  const bib = h.match(/^#\/open\?bib=([\w-]+)/)
  if (bib) {
    history.replaceState(null, '', '#/')
    const linked = books.find(b => b.bibId === bib[1])
    if (linked) return go(`#/read/${linked.id}`)
    const entry = bridge.find(bib[1])
    if (entry) askForFile(entry)
  }
  refresh()
}
let inApp = false // true once we've pushed our own history entries
const go = hash => { inApp = true; location.hash = hash }

async function openBook(id) {
  try {
    reader ??= await import('./reader.js')
    await reader.openReader(id, { onExit: () => { if (inApp) history.back(); else { history.replaceState(null, '', '#/'); route() } } })
  } catch (e) {
    console.error(e)
    history.replaceState(null, '', '#/')
    showError(e)
    refresh()
  }
}

function showError(e) {
  const kind = e instanceof ReaderError ? e.kind : 'broken'
  sheet({
    id: 'err', title: kind === 'drm' ? 'This book is locked' : kind === 'unsupported' ? 'Not supported' : 'Couldn’t open this',
    body: `<p class="msg-p">${esc(e.message || 'Something went wrong.')}</p><div class="acts"><span class="grow"></span><button type="button" class="solid" data-ok>OK</button></div>`,
  }).querySelector('[data-ok]').onclick = () => close($('#err'))
}

// ---------- library ----------
function renderLibrary() {
  for (const u of coverURLs.values()) URL.revokeObjectURL(u)
  coverURLs = new Map()
  const main = $('#lib')
  if (!books.length) {
    main.innerHTML = `<div class="drop" id="drop-empty">
      <p class="serif big">Your books, ready for your phone</p>
      <p>EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT and HTML files reflow to fit your screen.</p>
      <button type="button" class="solid lg" data-pick>${icon('upload', 18)}Choose books</button>
      <p class="lbl">or drop files anywhere</p>
    </div>`
    main.querySelector('[data-pick]').onclick = () => $('#file').click()
    return
  }
  const recent = books.find(b => b.lastOpened)
  const today = bridge.pagesToday()
  main.innerHTML = `
    ${recent ? `<section class="cont" aria-label="Continue reading">
      <button type="button" class="cont-card" data-open="${esc(recent.id)}">
        ${cover(recent)}
        <span class="m"><span class="lbl">Continue reading</span><span class="t serif">${esc(recent.title)}</span>
        <span class="lbl a">${esc(recent.author || '')}</span>
        <span class="bar" aria-hidden="true"><i style="width:${Math.round((recent.fraction || 0) * 100)}%"></i></span>
        <span class="lbl">${Math.round((recent.fraction || 0) * 100)}%${today ? ` · ${today} pages today` : ''}</span></span>
      </button></section>` : ''}
    <section aria-label="All books"><div class="hd"><h2 class="serif">Library</h2><span class="lbl">${books.length} book${books.length === 1 ? '' : 's'}</span></div>
    <ul class="grid">${books.map(b => `<li class="bk">
      <button type="button" class="bk-open" data-open="${esc(b.id)}" aria-label="Open ${esc(b.title)}${b.fraction ? `, ${Math.round(b.fraction * 100)}% read` : ''}">${cover(b)}
        ${b.fraction ? `<span class="bar" aria-hidden="true"><i style="width:${Math.round(b.fraction * 100)}%"></i></span>` : ''}</button>
      <div class="bk-m"><div><span class="t serif">${esc(b.title)}</span><span class="lbl">${esc(LABEL[b.format] ?? '')}${b.bibId ? ' · linked' : ''}</span></div>
      <button type="button" class="ib sm" data-info="${esc(b.id)}" aria-label="Details for ${esc(b.title)}">${icon('more', 18)}</button></div>
    </li>`).join('')}</ul></section>`
  $$('[data-open]', main).forEach(el => el.onclick = () => go(`#/read/${el.dataset.open}`))
  $$('[data-info]', main).forEach(el => el.onclick = () => openInfo(books.find(b => b.id === el.dataset.info)))
}

const HUES = ['#4d6b52', '#6b4d4d', '#4d5a6b', '#6b604d', '#5c4d6b', '#3f5f5f', '#6b4d60']
function cover(b) {
  if (b.cover) {
    const u = URL.createObjectURL(b.cover); coverURLs.set(b.id, u)
    return `<span class="cv"><img src="${u}" alt="" loading="lazy"></span>`
  }
  let h = 0; for (const c of b.title) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `<span class="cv gen" style="--h:${HUES[h % HUES.length]}" aria-hidden="true"><span class="serif">${esc(b.title)}</span><small>${esc((b.author || '').split(',')[0])}</small></span>`
}

// ---------- import ----------
function setupDrop() {
  let depth = 0
  addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging') } })
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging') } })
  addEventListener('dragover', e => e.preventDefault())
  addEventListener('drop', e => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging')
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length && !reader?.isOpen()) importFiles(files)
  })
}

async function importFiles(files) {
  if (!files.length) return
  const box = $('#imports')
  box.hidden = false
  const results = []
  for (const file of files) {
    const row = document.createElement('div')
    row.className = 'imp'
    row.innerHTML = `<span class="t">${esc(file.name)}</span><span class="lbl s">Reading…</span><span class="p" aria-hidden="true"><i></i></span>`
    box.append(row)
    const status = (t, p) => { row.querySelector('.s').textContent = t; if (p != null) row.querySelector('.p i').style.width = Math.round(p * 100) + '%' }
    try {
      const b = await importOne(file, status)
      results.push(b)
      row.classList.add(b.duplicate ? 'dup' : 'ok')
      status(b.duplicate ? 'Already in library' : 'Added', 1)
    } catch (e) {
      row.classList.add('bad')
      status(e.message || 'Could not import this file')
      row.setAttribute('role', 'alert')
    }
  }
  const added = results.filter(b => !b.duplicate)
  await refresh()
  setTimeout(() => { $$('.imp.ok, .imp.dup', box).forEach(r => r.remove()); if (!box.children.length) box.hidden = true }, 4000)
  const dismiss = () => { box.replaceChildren(); box.hidden = true }
  if ($$('.imp.bad', box).length) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ghost sm'; btn.textContent = 'Dismiss'; btn.onclick = dismiss
    box.append(btn)
  }
  if (added.length) {
    if (!(await db.persist())) console.info('Persistent storage not granted; books may be evicted under storage pressure.')
    if (added.length === 1 && files.length === 1) go(`#/read/${added[0].id}`)
    else toast(`${added.length} book${added.length === 1 ? '' : 's'} added`)
  }
}

async function importOne(file, status) {
  const format = await detect(file)
  await checkDRM(file, format)
  status('Checking…', .15)
  const fp = await fingerprint(file)
  const dup = books.find(b => b.fp === fp)
  if (dup) { if (pendingBib) linkTo(dup, pendingBib); pendingBib = null; return { ...dup, duplicate: true } }

  let title = '', author = '', coverBlob = null, pages = 0
  status('Reading details…', .35)
  if (format === 'pdf') {
    const { openPDF, pdfInfo, pdfCover } = await import('./pdf-reflow.js')
    const pdf = await openPDF(file)
    try {
      const info = await pdfInfo(pdf)
      title = info.title; author = info.author; pages = info.pages
      coverBlob = await pdfCover(pdf)
    } finally { pdf.destroy() }
  } else if (format !== 'txt' && format !== 'html') {
    const { makeBook } = await import('../vendor/foliate/view.js')
    let book
    try { book = await makeBook(file) }
    catch { throw new ReaderError('broken', `This ${LABEL[format]} file looks damaged and can’t be opened.`) }
    title = formatTitle(book.metadata?.title)
    author = formatAuthor(book.metadata?.author)
    try { const c = await book.getCover?.(); if (c) coverBlob = await thumbnail(c) } catch {}
    book.destroy?.()
  }
  title = (title || '').trim() || titleFromFilename(file.name)
  // Some PDFs carry junk titles like "Microsoft Word - draft.docx"
  if (/^(microsoft word|untitled|document)\b|\.(docx?|indd|pdf)$/i.test(title)) title = titleFromFilename(file.name)
  ;({ title, author } = cleanTitle(title, author))

  status('Saving…', .7)
  const id = db.uid()
  const rec = { id, title, author, format, size: file.size, fp, cover: coverBlob, added: Date.now(), lastOpened: 0, fraction: 0, pos: {}, bibId: null }
  await db.put('files', { id, name: file.name, blob: file })
  await db.put('books', rec)
  linkTo(rec, pendingBib ?? autoLink(rec, pages))
  pendingBib = null
  return rec
}

function autoLink(rec, pages) {
  if (!bridge.available()) return bridge.create({ title: rec.title, author: rec.author, total: pages, source: LABEL[rec.format] })
  const m = bridge.match(rec.title)
  if (m) { if (pages) bridge.setTotal(m.id, pages); return m.id }
  return bridge.create({ title: rec.title, author: rec.author, total: pages, source: LABEL[rec.format] === 'PDF' ? 'PDF' : 'eBook' })
}

function linkTo(rec, bibId) {
  rec.bibId = bibId || null
  db.update('books', rec.id, { bibId: rec.bibId })
}

function askForFile(entry) {
  const d = sheet({
    id: 'askfile', title: 'Add the book file',
    body: `<p class="msg-p">“${esc(entry.title)}” isn’t in the reader yet. Choose its file on your phone and it will be linked to Bibliotheca, so pages you read are counted there.</p>
      <div class="acts"><button type="button" class="ghost" data-x>Not now</button><span class="grow"></span><button type="button" class="solid" data-pick>${icon('upload', 18)}Choose file</button></div>`,
  })
  d.querySelector('[data-x]').onclick = () => close(d)
  d.querySelector('[data-pick]').onclick = () => { pendingBib = entry.id; close(d); $('#file').click() }
}

// ---------- book details ----------
async function openInfo(b) {
  const bibs = bridge.books()
  const hl = (await db.byBook('highlights', b.id)).length
  const nt = (await db.byBook('notes', b.id)).length
  const d = sheet({
    id: 'info', title: b.title,
    body: `<dl class="facts">
        ${b.author ? `<dt>Author</dt><dd>${esc(b.author)}</dd>` : ''}
        <dt>Format</dt><dd>${esc(LABEL[b.format])} · ${fmtBytes(b.size)}</dd>
        <dt>Added</dt><dd>${fmtDate(b.added)}</dd>
        <dt>Notebook</dt><dd>${hl} highlight${hl === 1 ? '' : 's'}, ${nt} note${nt === 1 ? '' : 's'}</dd>
      </dl>
      <label class="fld-l"><span class="lbl">Counts pages toward Bibliotheca book</span>
        <select class="fld" data-bib>
          <option value="">Not linked</option>
          ${bibs.map(x => `<option value="${esc(x.id)}" ${x.id === b.bibId ? 'selected' : ''}>${esc(x.title)}${x.total ? ` (${x.total} p.)` : ''}</option>`).join('')}
          <option value="__new">+ New entry in Bibliotheca</option>
        </select></label>
      <div class="acts wrap">
        <button type="button" class="ghost" data-md ${hl + nt ? '' : 'disabled'}>${icon('download', 18)}Export notes (.md)</button>
        <span class="grow"></span>
        <button type="button" class="ghost danger" data-del>${icon('trash', 18)}Remove book</button>
      </div>`,
  })
  d.querySelector('[data-bib]').onchange = e => {
    let v = e.target.value
    if (v === '__new') v = bridge.create({ title: b.title, author: b.author, source: LABEL[b.format] })
    linkTo(b, v); toast(v ? 'Linked to Bibliotheca' : 'Unlinked'); refresh()
  }
  d.querySelector('[data-md]').onclick = async () => { const { exportMarkdown } = await import('./notes.js'); exportMarkdown(b) }
  d.querySelector('[data-del]').onclick = async () => {
    if (!confirm(`Remove “${b.title}” from this device? Its highlights and notes are removed too. Bibliotheca keeps its entry.`)) return
    await db.deleteBook(b.id); close(d); toast('Book removed'); refresh()
  }
}

// ---------- storage & backup ----------
async function openStorage() {
  const u = await db.usage()
  const d = sheet({
    id: 'storage', title: 'Storage & backup',
    body: `<p class="msg-p">Books, highlights and notes are stored only on this device, in this browser. Nothing is uploaded.</p>
      ${u ? `<dl class="facts"><dt>Used</dt><dd>${fmtBytes(u.usage)} of ${fmtBytes(u.quota)}</dd><dt>Protected</dt><dd>${u.persisted ? 'Yes, the browser won’t clear it to save space' : 'Not yet; granted after you add a book (or install the app)'}</dd></dl>` : ''}
      <div class="stack">
        <button type="button" class="ghost" data-b="1">${icon('download', 18)}Back up everything (books + notes)</button>
        <button type="button" class="ghost" data-b="0">${icon('download', 18)}Back up notes & highlights only</button>
        <button type="button" class="ghost" data-r>${icon('upload', 18)}Restore from backup</button>
      </div>
      <p class="hint">Clearing Chrome’s site data deletes your library. Keep a backup somewhere safe.</p>
      <h3 class="lbl set-h">About</h3>
      <p class="hint">Hide the browser bar: Chrome menu → <b>Install app</b> (or Add to Home screen), then open the reader from your home screen. Full screen (in the reader’s bottom bar) also hides Android’s status bar.</p>
      <p class="hint">Uses foliate-js and PDF.js. DRM-protected books can’t be opened.</p>
      <input type="file" accept=".json,application/json" hidden data-rf>`,
  })
  $$('[data-b]', d).forEach(btn => btn.onclick = async () => {
    btn.disabled = true; const label = btn.innerHTML
    try {
      const blob = await db.backup({ includeFiles: btn.dataset.b === '1', onProgress: p => { btn.textContent = `Preparing… ${Math.round(p * 100)}%` } })
      download(blob, `reader-backup-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (e) { toast('Backup failed: ' + e.message) }
    btn.disabled = false; btn.innerHTML = label
  })
  const rf = d.querySelector('[data-rf]')
  d.querySelector('[data-r]').onclick = () => rf.click()
  rf.onchange = async () => {
    const f = rf.files[0]; if (!f) return
    try { const n = await db.restore(f); toast(`Restored ${n} book${n === 1 ? '' : 's'}`); close(d); refresh() }
    catch (e) { toast(e.message || 'Restore failed') }
  }
}
