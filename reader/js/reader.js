// The reading screen: one foliate renderer for every format, quiet chrome, auto-scroll,
// highlights, position restore, and progress sync to Bibliotheca.

import { makeBook } from '../vendor/foliate/view.js'
import * as db from './db.js'
import * as prefs from './settings.js'
import * as bridge from './bridge.js'
import { ReaderError, makeTextBook, makeHTMLFileBook, LABEL } from './formats.js'
import { AutoScroll, SEC_PER_PAGE, keepAwake, lockOrientation, lockZoom, fullscreen } from './autoscroll.js'
import { initHighlights } from './highlights.js'
import { openNotebook } from './notes.js'
import { $, esc, icon, toast, sheet, close } from './ui.js'

const HIDE_AFTER = 3000
let S = null // current session

export const isOpen = () => !!S

export async function openReader(bookId, { onExit }) {
  await closeReader()
  const rec = await db.get('books', bookId)
  const file = await db.get('files', bookId)
  if (!rec || !file) throw new ReaderError('missing', 'This book’s file is missing. Add it again from your device.')

  const root = $('#reader')
  root.hidden = false
  document.body.classList.add('reading')
  setLoading(`Opening ${rec.title}…`)

  S = { rec, file, onExit, controls: false, hideTimer: 0, skipLog: true, sessionPages: 0, lastSync: Date.now() }
  try {
    await buildView()
  } catch (e) {
    await closeReader(true)
    throw e
  }
  setupChrome()
  applyLocks(true)
  setLoading(null)
  await db.update('books', bookId, { lastOpened: Date.now() })
}

export async function closeReader(silent) {
  if (!S) return
  const s = S
  clearTimeout(relocateTimer); relocateTimer = 0
  savePosition()
  syncProgress(true)
  s.auto?.pause()
  s.view?.close?.()
  s.view?.remove()
  s.book?.destroy?.()
  s.pdf?.destroy?.()
  for (const off of s.cleanup ?? []) off()
  S = null
  applyLocks(false)
  $('#reader').hidden = true
  $('#stage').replaceChildren()
  $('#selbar').hidden = true
  document.body.classList.remove('reading', 'chrome-on')
  if (!silent && s.sessionPages > 0) toast(`${s.sessionPages} page${s.sessionPages === 1 ? '' : 's'} logged to Bibliotheca`)
}

function setLoading(text, p) {
  const l = $('#loading')
  if (text == null) { l.hidden = true; return }
  l.hidden = false
  $('#ld-t').textContent = text
  l.classList.toggle('indet', p == null)
  $('#ld-p').style.width = p == null ? '' : Math.round(p * 100) + '%'
}

// ---------- building the book ----------
async function buildView() {
  const { rec, file } = S
  const f = new File([file.blob], file.name || rec.title, { type: file.blob.type })
  S.mode = rec.format === 'pdf' ? (rec.pdfMode || 'reflow') : 'main'

  let book
  if (rec.format === 'pdf') book = await buildPDF(f)
  else if (rec.format === 'txt') book = await makeTextBook(f, rec.title)
  else if (rec.format === 'html') book = await makeHTMLFileBook(f, rec.title)
  else {
    try { book = await makeBook(f) }
    catch (e) { throw new ReaderError('broken', `This ${LABEL[rec.format] ?? ''} file could not be opened. It may be damaged or use a feature that isn’t supported.`) }
  }
  const view = document.createElement('foliate-view')
  view.setAttribute('aria-label', `Text of ${rec.title}`)
  $('#stage').replaceChildren(view)
  S.view = view
  await view.open(book)
  S.book = book
  styleRenderer()

  view.addEventListener('relocate', onRelocate)
  view.addEventListener('load', onLoad)
  view.addEventListener('external-link', e => { e.preventDefault(); if (confirm(`Open this link in your browser?\n${e.detail.href_}`)) window.open(e.detail.href_, '_blank', 'noopener') })

  S.highlights = await initHighlights({
    view, bookId: rec.id,
    // reflowed PDF, original PDF pages and other books each have their own positions
    mode: S.mode, version: S.reflow?.version ?? 0,
    locate: (index, range) => ({ chapter: chapterOf(index, range), page: pageOf(index, range) }),
    onChange: () => {},
    onNote: h => { S.highlights.edit(h); setTimeout(() => $('#hl-edit textarea')?.focus(), 250) },
  })
  view.addEventListener('show-annotation', () => { S.annotationTap = Date.now() })

  S.auto = new AutoScroll({
    view,
    speed: () => prefs.get().speed,
    fontSize: () => prefs.get().size,
    onChange: playing => {
      renderAutoBtn(); keepAwake(playing || prefs.get().keepAwake)
      if (playing) hideChrome()
    },
    onEnd: () => toast('You’ve reached the end'),
  })

  // restore position
  const pos = rec.pos?.[S.mode]
  const bib = rec.bibId ? bridge.find(rec.bibId) : null
  const restored = pos && await view.init({ lastLocation: pos }).then(() => true, e => {
    console.warn('Saved position no longer matches the book; falling back to the page number', e)
    return false
  })
  if (!restored) {
    await view.init({ showTextStart: true }).catch(() => view.init({}))
    const page = rec.pos?.[S.mode + 'Page']
    if (page > 1) await goToPage(page)
    else if (bib?.cur > 0 && bib.total) {
      await goToPage(bib.cur)
      toast(`Opened at p. ${bib.cur}, where Bibliotheca has you`)
    }
  }

  if (rec.format === 'pdf' && !rec.bannerSeen?.[S.mode]) {
    pdfBanner()
    rec.bannerSeen = { ...rec.bannerSeen, [S.mode]: true }
    db.update('books', rec.id, { bannerSeen: rec.bannerSeen }).catch(() => {})
  }
}

async function buildPDF(f) {
  const { openPDF, reflow, reflowBook, REFLOW_VERSION } = await import('./pdf-reflow.js')
  const { rec } = S
  if (S.mode === 'page') return pageModeBook(f)
  let data = await db.get('reflow', rec.id)
  if (data?.version !== REFLOW_VERSION) {
    const pdf = await openPDF(f)
    try {
      if (rec.pos?.reflow) rec.pos = { ...rec.pos, reflow: null } // layout changed: keep only the page number
      data = { id: rec.id, ...(await reflow(pdf, { title: rec.title, onProgress: p => setLoading(`Preparing for your screen… ${Math.round(p * 100)}%`, p) })) }
      await db.put('reflow', data)
    } catch (e) {
      if (e.kind === 'scanned') {
        await db.update('books', rec.id, { pdfMode: 'page', scanned: true })
        rec.pdfMode = 'page'; rec.scanned = true; S.mode = 'page'
        return pageModeBook(f)
      }
      throw e
    } finally { pdf.destroy() }
  }
  S.reflow = data
  return reflowBook(data, rec)
}

async function pageModeBook(f) {
  const { makePDF } = await import('../vendor/foliate/pdf.js')
  let book
  try { book = await makePDF(f) }
  catch (e) {
    if (e?.name === 'PasswordException') throw new ReaderError('drm', 'This PDF is password-protected, so it can’t be opened here.')
    throw new ReaderError('broken', 'This PDF could not be read. It may be damaged.')
  }
  book.rendition.spread = 'none'
  return book
}

function styleRenderer() {
  const r = S.view.renderer
  const p = prefs.get()
  const t = prefs.theme(p)
  if (S.view.isFixedLayout) {
    r.setAttribute('zoom', `fit-width:${S.rec.pageZoom || 1}`)
  } else {
    r.setAttribute('flow', p.flow)
    r.setAttribute('gap', prefs.MARGINS[p.margin]?.gap ?? '7%')
    r.setAttribute('max-inline-size', '680px')
    r.setAttribute('margin', p.flow === 'paginated' ? '44px' : '0px')
    r.setStyles?.(prefs.bookCSS(p) + (p.flow === 'scrolled' ? 'body{padding:72px 0 35vh !important}' : ''))
  }
  document.documentElement.dataset.theme = prefs.themeName(p)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg)
  S.view.style.setProperty('--overlayer-highlight-opacity', prefs.isDark(p) ? '.38' : '.42')
  S.view.style.setProperty('--overlayer-highlight-blend-mode', prefs.isDark(p) ? 'screen' : 'multiply')
}

// ---------- events ----------
function onLoad({ detail: { doc, index } }) {
  // tap zones, overscroll-to-next-chapter, auto-scroll hold, keyboard
  doc.addEventListener('click', e => onTap(e, doc))
  doc.addEventListener('pointerdown', () => S?.auto.hold(), { passive: true })
  doc.addEventListener('pointerup', () => S?.auto.release(), { passive: true })
  doc.addEventListener('pointercancel', () => S?.auto.release(), { passive: true })
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('pointermove', onMouseMove, { passive: true })
  let y0 = null
  doc.addEventListener('touchstart', e => { y0 = e.touches.length === 1 ? e.touches[0].clientY : null }, { passive: true })
  doc.addEventListener('touchend', e => {
    if (y0 === null || !S || S.view.isFixedLayout || prefs.get().flow !== 'scrolled') return
    const dy = e.changedTouches[0].clientY - y0
    const el = S.view.renderer.scrollContainer
    if (!el) return
    if (dy < -36 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) S.view.next()
    else if (dy > 36 && el.scrollTop <= 0) S.view.prev()
  }, { passive: true })
  doc.addEventListener('wheel', e => {
    if (!S || e.ctrlKey || prefs.get().flow !== 'scrolled' || S.view.isFixedLayout) return
    const el = S.view.renderer.scrollContainer
    if (e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) S.view.next()
    else if (e.deltaY < 0 && el.scrollTop <= 0) S.view.prev()
  }, { passive: true })
  // pinch and Ctrl+wheel zoom are handled here (the browser's own zoom is off while reading)
  doc.documentElement.style.touchAction = 'pan-x pan-y'
  let pinch = null
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  doc.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d0: dist(e.touches), d: dist(e.touches) } }, { passive: true })
  doc.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); pinch.d = dist(e.touches) } }, { passive: false })
  doc.addEventListener('touchend', e => {
    if (!pinch || e.touches.length) return
    const ratio = pinch.d / pinch.d0
    pinch = null
    if (Math.abs(ratio - 1) > .08) zoomBy(ratio)
  })
  doc.addEventListener('wheel', e => {
    if (!e.ctrlKey) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }, { passive: false })
}

// Zoom = page scale for original PDF/comic pages, text size for everything else.
const MAX_PAGE_ZOOM = 4
const zoomValue = () => S.view.isFixedLayout ? (S.rec.pageZoom || 1) : prefs.get().size
function zoomBy(ratio) {
  if (!S) return
  if (prefs.get().zoomLock) { toast('Zoom is locked. Tap the lock to change it.'); return }
  if (S.view.isFixedLayout) setPageZoom((S.rec.pageZoom || 1) * ratio)
  else prefs.set({ size: Math.round(Math.min(32, Math.max(13, prefs.get().size * ratio))) })
  renderZoom()
}
function setPageZoom(z) {
  z = Math.round(Math.min(MAX_PAGE_ZOOM, Math.max(1, z)) * 100) / 100
  S.rec.pageZoom = z
  S.view.renderer.setAttribute('zoom', `fit-width:${z}`)
  db.update('books', S.rec.id, { pageZoom: z }).catch(() => {})
}
function stepZoom(dir) {
  if (S.view.isFixedLayout) zoomBy(dir > 0 ? 1.25 : 1 / 1.25)
  else zoomBy((prefs.get().size + dir) / prefs.get().size)
}
function renderZoom() {
  const box = $('#r-zoom')
  if (!box || !S) return
  const locked = prefs.get().zoomLock
  const fixed = S.view.isFixedLayout
  const v = zoomValue()
  const label = fixed ? `${Math.round(v * 100)}%` : `${v}px`
  box.innerHTML = `
    <button type="button" class="ib sm zstep" data-a="zout" aria-label="${fixed ? 'Zoom out' : 'Smaller text'}" ${locked || (fixed ? v <= 1 : v <= 13) ? 'disabled' : ''}>${icon('minus', 18)}</button>
    <span class="zval lbl" aria-live="polite" title="${fixed ? 'Page zoom' : 'Text size'}">${label}</span>
    <button type="button" class="ib sm zstep" data-a="zin" aria-label="${fixed ? 'Zoom in' : 'Larger text'}" ${locked || (fixed ? v >= MAX_PAGE_ZOOM : v >= 32) ? 'disabled' : ''}>${icon('plus', 18)}</button>
    <button type="button" class="ib sm ${locked ? 'on' : ''}" data-a="zlock" aria-pressed="${locked}" aria-label="${locked ? 'Zoom locked. Tap to unlock' : 'Lock zoom at this size'}">${icon(locked ? 'lock' : 'unlock', 18)}</button>`
}

function onTap(e, doc) {
  if (!S) return
  if (e.defaultPrevented || e.target.closest?.('a[href]')) return
  const sel = doc.getSelection()
  if (sel && !sel.isCollapsed) return
  setTimeout(() => {
    if (!S || Date.now() - (S.annotationTap || 0) < 400) return
    const frame = doc.defaultView.frameElement?.getBoundingClientRect() ?? { left: 0 }
    const x = frame.left + e.clientX
    const w = innerWidth
    const paged = turnsPages()
    if (paged && x < w * .26) { S.view.goLeft(); hideChrome() }
    else if (paged && x > w * .74) { S.view.goRight(); hideChrome() }
    else toggleChrome()
  }, 10)
}

// true where taps on the edges turn pages (Pages layout, comics); scrolling views never do
const turnsPages = () => S.view.isFixedLayout || prefs.get().flow === 'paginated'

function onKey(e) {
  if (!S || e.target.closest?.('input, textarea, select, button, a, dialog, [contenteditable]')) return
  const k = e.key
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); S.view.next() }
  else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); S.view.prev() }
  else if ((k === 'ArrowDown' || k === 'ArrowUp') && S.view.renderer?.scrollContainer && !turnsPages()) {
    e.preventDefault(); S.view.renderer.scrollContainer.scrollBy({ top: k === 'ArrowDown' ? 60 : -60 })
  }

  else if (k === 'Escape' && document.body.classList.contains('chrome-on')) hideChrome()
}

let lastMove = 0
function onMouseMove(e) {
  if (!S || e.pointerType !== 'mouse' || S.auto?.playing) return
  const now = Date.now()
  if (now - lastMove < 250) return
  if (Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return
  lastMove = now
  if (!S.controls) showChrome(); else pokeChrome()
}

let relocateTimer = 0
function onRelocate({ detail }) {
  if (!S) return
  S.loc = detail
  renderProgress()
  // throttle (not debounce) so continuous auto-scroll still saves and syncs regularly
  relocateTimer ||= setTimeout(() => { relocateTimer = 0; savePosition(); syncProgress() }, 1500)
}

function savePosition() {
  if (!S?.loc?.cfi) return
  // the page number is a fallback in case the exact position can't be resolved later
  const pos = { ...(S.rec.pos ?? {}), [S.mode]: S.loc.cfi, [S.mode + 'Page']: currentPage() }
  S.rec.pos = pos
  db.update('books', S.rec.id, { pos, fraction: S.loc.fraction ?? 0, lastOpened: Date.now() }).catch(() => {})
}

// ---------- pages ----------
function totalPages() {
  if (S.reflow) return S.reflow.pageCount
  if (S.view.isFixedLayout) return S.book.sections.length
  const bib = S.rec.bibId ? bridge.find(S.rec.bibId) : null
  return bib?.total || S.loc?.location?.total || 0
}

function markerPage(doc, range) {
  const marks = doc.querySelectorAll('.rf-page, .rf-note')
  let page = null
  for (const m of marks) {
    const r = doc.createRange(); r.selectNode(m)
    if (r.compareBoundaryPoints(Range.START_TO_START, range) <= 0) page = Number(m.id.slice(2))
    else break
  }
  return page
}

function pageOf(index, range) {
  if (S.view.isFixedLayout) return index + 1
  if (S.reflow) {
    const doc = S.view.renderer.getContents().find(c => c.index === index)?.doc
    return (doc && range && markerPage(doc, range)) || S.reflow.sections[index]?.firstPage || null
  }
  return currentPage()
}

function currentPage() {
  if (!S?.loc) return null
  if (S.view.isFixedLayout) return (S.loc.section?.current ?? S.view.renderer.getContents()[0]?.index ?? 0) + 1
  if (S.reflow) {
    const c = S.view.renderer.getContents()[0]
    return (c && S.loc.range && markerPage(c.doc, S.loc.range)) || S.reflow.sections[c?.index]?.firstPage || 1
  }
  const total = totalPages()
  return total ? Math.max(1, Math.round((S.loc.fraction ?? 0) * total)) : null
}

function chapterOf(index, range) {
  const item = S.view.getProgressOf(index, range)?.tocItem
  return item?.label?.trim() || S.loc?.tocItem?.label?.trim() || ''
}

async function goToPage(n) {
  S.skipLog = true
  if (S.view.isFixedLayout) return S.view.goTo(Math.max(0, n - 1))
  if (S.reflow) {
    let i = 0
    S.reflow.sections.forEach((s, k) => { if (s.firstPage <= n) i = k })
    return S.view.goTo(`s${i}#pg${n}`)
  }
  const total = totalPages()
  if (total) return S.view.goToFraction(Math.min(1, n / total))
}

// ---------- Bibliotheca sync ----------
function syncProgress(final) {
  if (!S?.rec.bibId || !S.loc) return
  const page = currentPage()
  if (!page) return
  const bib = bridge.find(S.rec.bibId)
  if (!bib) return
  const total = totalPages()
  if (total && !bib.total) bridge.setTotal(S.rec.bibId, total)
  // Only count pages you could plausibly have read since the last sync (max ~1 page / 4 s);
  // anything faster is a jump (link, search, slider) and moves the bookmark without logging.
  const now = Date.now()
  const before = bib.cur ?? 0
  const plausible = page - before <= (now - S.lastSync) / 4000 + 3
  const added = bridge.progress(S.rec.bibId, page, { log: !S.skipLog && plausible })
  S.skipLog = false
  S.lastSync = now
  S.sessionPages += added
  if (!final) renderProgress()
}

// ---------- chrome ----------
function setupChrome() {
  const { rec } = S
  $('#chrome-top').innerHTML = `
    <button type="button" class="ib" data-a="back" aria-label="Back to library">${icon('back')}</button>
    <div class="ttl"><span class="t serif">${esc(rec.title)}</span><span class="ch lbl" id="r-ch"></span></div>
    <button type="button" class="ib" data-a="toc" aria-label="Contents">${icon('toc')}</button>
    <button type="button" class="ib" data-a="notes" aria-label="Highlights and notes">${icon('notes')}</button>
    <button type="button" class="ib" data-a="type" aria-label="Reading settings">${icon('type')}</button>`
  $('#chrome-bot').innerHTML = `
    <div class="prog"><input type="range" id="r-slider" min="0" max="1000" value="0" aria-label="Position in book"><div class="prog-t lbl"><span id="r-pct"></span><span id="r-page"></span></div></div>
    <div class="bar-row">
      <div class="auto" id="r-auto" role="group" aria-label="Auto-scroll"></div>
      <span class="grow"></span>
      <div class="zoom" id="r-zoom" role="group" aria-label="Zoom"></div>
      <button type="button" class="ib ${document.fullscreenElement ? 'on' : ''}" data-a="fs" aria-label="Full screen" aria-pressed="${!!document.fullscreenElement}">${icon(document.fullscreenElement ? 'shrink' : 'expand')}</button>
    </div>`
  const act = {
    back: () => S.onExit(),
    toc: openTOC,
    notes: () => openNotebook(ctxForNotes()),
    type: openSettings,
    play: () => S.auto.toggle(),
    slower: () => setSpeed(-1),
    faster: () => setSpeed(1),
    fs: toggleFullscreen,
    zin: () => stepZoom(1),
    zout: () => stepZoom(-1),
    zlock: () => {
      prefs.set({ zoomLock: !prefs.get().zoomLock })
      toast(prefs.get().zoomLock ? `Zoom locked at ${$('#r-zoom .zval')?.textContent}` : 'Zoom unlocked: pinch or use − +')
    },
  }
  // one delegated listener per bar, so re-rendered buttons keep working
  for (const bar of [$('#chrome-top'), $('#chrome-bot')]) bar.onclick = e => {
    const b = e.target.closest('[data-a]')
    if (!b) return
    e.stopPropagation(); act[b.dataset.a]?.(); pokeChrome()
  }
  const slider = $('#r-slider')
  slider.oninput = () => { $('#r-pct').textContent = Math.round(slider.value / 10) + '%'; pokeChrome() }
  slider.onchange = () => { S.skipLog = true; S.view.goToFraction(slider.value / 1000) }
  for (const el of [$('#chrome-top'), $('#chrome-bot')]) {
    el.addEventListener('pointerdown', pokeChrome)
    el.addEventListener('focusin', pokeChrome)
  }
  renderAutoBtn()
  renderZoom()
  renderProgress()
  const offKey = (h => (addEventListener('keydown', h), () => removeEventListener('keydown', h)))(onKey)
  const offPrefs = prefs.onChange((p, patch) => {
    if (!S) return
    if ('speed' in patch) { renderAutoBtn(); S.auto.refresh() }
    if (['theme', 'font', 'size', 'leading', 'margin', 'align', 'flow'].some(k => k in patch)) { styleRenderer(); if ('flow' in patch) S.auto.refresh() }
    if ('zoomLock' in patch || 'size' in patch) renderZoom()
    if ('orientationLock' in patch || 'keepAwake' in patch) applyLocks(true)
  })
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onScheme = () => prefs.get().theme === 'system' && styleRenderer()
  mq.addEventListener('change', onScheme)
  const onVis = () => {
    if (!S) return
    if (document.visibilityState === 'hidden') { savePosition(); syncProgress(); S.auto.pause() }
    else applyLocks(true)
  }
  document.addEventListener('visibilitychange', onVis)
  const onFs = () => { if (S) { setupChromeFs(); if (prefs.get().orientationLock) lockOrientation(true) } }
  document.addEventListener('fullscreenchange', onFs)
  S.cleanup = [offKey, offPrefs, () => mq.removeEventListener('change', onScheme), () => document.removeEventListener('visibilitychange', onVis), () => document.removeEventListener('fullscreenchange', onFs)]
  showChrome()
}

function setupChromeFs() {
  const b = document.querySelector('#reader [data-a="fs"]')
  if (!b) return
  const on = !!document.fullscreenElement
  b.innerHTML = icon(on ? 'shrink' : 'expand'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on)
}

async function toggleFullscreen() {
  const ok = await fullscreen(!document.fullscreenElement)
  if (!ok) toast('Full screen isn’t available here. Install the app to read without browser bars.')
}

// Auto-scroll stays out of the way: one small pill until you start it, speed controls only while it runs.
function renderAutoBtn() {
  const box = $('#r-auto')
  if (!box) return
  const p = prefs.get()
  const on = !!S?.auto?.playing
  const turns = S?.view && turnsPages()
  box.innerHTML = on
    ? `<button type="button" class="pill on" data-a="play" aria-label="Pause auto-scroll">${icon('pause', 18)}<span>Pause</span></button>
       <button type="button" class="ib sm" data-a="slower" aria-label="Slower" ${p.speed <= 1 ? 'disabled' : ''}>${icon('minus', 18)}</button>
       <span class="spd lbl" aria-live="polite">${turns ? `Page / ${SEC_PER_PAGE[p.speed - 1]}s` : `Speed ${p.speed}`}</span>
       <button type="button" class="ib sm" data-a="faster" aria-label="Faster" ${p.speed >= 8 ? 'disabled' : ''}>${icon('plus', 18)}</button>`
    : `<button type="button" class="pill" data-a="play" aria-label="Start auto-scroll, speed ${p.speed}">${icon('play', 18)}<span>Auto-scroll</span></button>`
}

function setSpeed(d) {
  const speed = Math.min(8, Math.max(1, prefs.get().speed + d))
  prefs.set({ speed })
}

function renderProgress() {
  if (!S?.loc) return
  const f = S.loc.fraction ?? 0
  const slider = $('#r-slider')
  if (slider && document.activeElement !== slider) slider.value = Math.round(f * 1000)
  $('#r-pct') && ($('#r-pct').textContent = Math.round(f * 100) + '%')
  const page = currentPage(); const total = totalPages()
  $('#r-page') && ($('#r-page').textContent = page ? `p. ${page}${total ? ' of ' + total : ''}` : '')
  $('#r-ch') && ($('#r-ch').textContent = S.loc.tocItem?.label?.trim() ?? '')
}

function showChrome() {
  document.body.classList.add('chrome-on')
  S.controls = true
  pokeChrome()
}
function hideChrome() {
  document.body.classList.remove('chrome-on')
  if (S) S.controls = false
  clearTimeout(S?.hideTimer)
}
function toggleChrome() {
  if (S.controls) hideChrome()
  else showChrome() // auto-scroll keeps running so you can change its speed; Pause is right there
}
function pokeChrome() {
  if (!S) return
  clearTimeout(S.hideTimer)
  S.hideTimer = setTimeout(() => {
    if (document.querySelector('dialog[open]') || document.activeElement?.id === 'r-slider') return pokeChrome()
    hideChrome()
  }, HIDE_AFTER)
}

async function applyLocks(on) {
  const p = prefs.get()
  lockZoom(on) // browser zoom off while reading; the reader's own zoom + lock take over
  keepAwake(on && (p.keepAwake || S?.auto?.playing))
  if (on && p.orientationLock) await lockOrientation(true)
  else lockOrientation(false)
}

// ---------- PDF ----------
function pdfBanner() {
  const b = $('#banner')
  const page = S.mode === 'page'
  const msg = S.rec.scanned
    ? 'Scanned PDF: shown as pages. Text can’t be reflowed.'
    : page ? 'Page mode: the original layout.' : `Reflow mode: text only, sized for your phone. Quality depends on the PDF${S.reflow?.emptyPages ? `; ${S.reflow.emptyPages} image-only page${S.reflow.emptyPages === 1 ? '' : 's'} skipped` : ''}.`
  b.innerHTML = `<span>${esc(msg)}</span>${S.rec.scanned ? '' : `<button type="button" class="ghost sm">${page ? 'Reflow' : 'Page mode'}</button>`}<button type="button" class="ib" aria-label="Dismiss">${icon('close', 16)}</button>`
  b.hidden = false
  b.querySelector('.ghost')?.addEventListener('click', () => switchPdfMode())
  b.querySelector('.ib').onclick = () => { b.hidden = true }
  clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true }, 7000)
}

export async function switchPdfMode() {
  if (!S || S.rec.format !== 'pdf' || S.rec.scanned) return
  const page = currentPage()
  const next = S.mode === 'page' ? 'reflow' : 'page'
  const id = S.rec.id; const onExit = S.onExit
  savePosition()
  // the other layout's exact position is meaningless after a switch; closeReader saves S.rec.pos again
  S.rec.pos = { ...(S.rec.pos ?? {}), [next]: null }
  await db.update('books', id, { pdfMode: next, pos: S.rec.pos })
  await closeReader(true)
  try {
    await openReader(id, { onExit })
  } catch (e) {
    await db.update('books', id, { pdfMode: next === 'page' ? 'reflow' : 'page' })
    toast(`Couldn’t switch: ${e.message}`)
    await openReader(id, { onExit }).catch(() => onExit())
    return
  }
  if (page) await goToPage(page)
  $('#banner').hidden = true
  toast(next === 'page' ? 'Page mode' : 'Reflow mode')
}

// ---------- sheets ----------
function openTOC() {
  const toc = S.book.toc ?? []
  const cur = S.loc?.tocItem?.href
  const item = (t, depth = 0) => `<li><button type="button" class="toc-i ${t.href === cur ? 'on' : ''}" style="--d:${depth}" data-href="${esc(t.href)}" ${t.href === cur ? 'aria-current="true"' : ''}>${esc(t.label?.trim() || 'Untitled')}</button>${t.subitems?.length ? `<ul>${t.subitems.map(s => item(s, depth + 1)).join('')}</ul>` : ''}</li>`
  const d = sheet({
    id: 'toc', title: 'Contents', side: 'left',
    body: toc.length ? `<ul class="toc">${toc.map(t => item(t)).join('')}</ul>` : `<div class="nb-empty"><p>This book has no table of contents.</p></div>`,
  })
  d.querySelectorAll('[data-href]').forEach(b => b.onclick = async () => {
    close(d); S.skipLog = true; await S.view.goTo(b.dataset.href)
  })
  d.querySelector('.toc-i.on')?.scrollIntoView({ block: 'center' })
}

function ctxForNotes() {
  return {
    book: S.rec, view: S.view, highlights: S.highlights,
    jump: (target, page, mode) => {
      S.skipLog = true
      // items saved before layouts were tracked belong to Reflow (PDF) or the book itself
      const sameLayout = (mode ?? (S.mode === 'page' ? 'reflow' : S.mode)) === S.mode
      if (!sameLayout || !String(target).startsWith('epubcfi(')) return page ? goToPage(page) : null
      return S.view.goTo(target)
    },
    here: () => ({ chapter: S.loc?.tocItem?.label?.trim() || '', cfi: S.loc?.cfi, page: currentPage(), mode: S.mode }),
  }
}

function openSettings() {
  const render = () => {
    const p = prefs.get()
    const fixed = S.view.isFixedLayout
    const seg = (key, opts) => `<div class="seg" role="radiogroup">${Object.entries(opts).map(([k, v]) => `<button type="button" role="radio" aria-checked="${p[key] === k}" class="${p[key] === k ? 'on' : ''}" data-k="${key}" data-v="${k}">${v}</button>`).join('')}</div>`
    const toggle = (key, label, hint) => `<label class="tg"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" role="switch" data-t="${key}" ${p[key] ? 'checked' : ''}></label>`
    return `
      <div class="themes" role="radiogroup" aria-label="Theme">
        ${[['system', 'Auto', prefs.isDark({ theme: 'system' }) ? prefs.THEMES.dark : prefs.THEMES.paper], ...Object.entries(prefs.THEMES).map(([k, t]) => [k, t.label, t])].map(([k, l, t]) =>
          `<button type="button" role="radio" aria-checked="${p.theme === k}" class="sw ${p.theme === k ? 'on' : ''}" data-k="theme" data-v="${k}" style="--bg:${t.bg};--fg:${t.fg}"><span aria-hidden="true">Aa</span>${l}</button>`).join('')}
      </div>
      ${fixed ? `<p class="hint">Text settings don’t apply in Page mode.</p>` : `
      <div class="set-row"><span class="lbl">Size</span>
        <div class="stepper"><button type="button" class="ib" data-step="size:-1" aria-label="Smaller text">${icon('minus')}</button><output aria-live="polite">${p.size}</output><button type="button" class="ib" data-step="size:1" aria-label="Larger text">${icon('plus')}</button></div></div>
      <div class="set-row"><span class="lbl">Spacing</span>
        <div class="stepper"><button type="button" class="ib" data-step="leading:-0.1" aria-label="Tighter lines">${icon('minus')}</button><output>${p.leading.toFixed(1)}</output><button type="button" class="ib" data-step="leading:0.1" aria-label="Looser lines">${icon('plus')}</button></div></div>
      <div class="set-row"><span class="lbl">Font</span>${seg('font', Object.fromEntries(Object.entries(prefs.FONTS).map(([k, v]) => [k, v.label])))}</div>
      <div class="set-row"><span class="lbl">Margins</span>${seg('margin', Object.fromEntries(Object.entries(prefs.MARGINS).map(([k, v]) => [k, v.label])))}</div>
      <div class="set-row"><span class="lbl">Align</span>${seg('align', { start: 'Left', justify: 'Justified' })}</div>
      <div class="set-row"><span class="lbl">Layout</span>${seg('flow', { scrolled: 'Scroll', paginated: 'Pages' })}</div>`}
      ${S.rec.format === 'pdf' && !S.rec.scanned ? `<div class="set-row"><span class="lbl">PDF</span><div class="seg"><button type="button" class="${S.mode === 'reflow' ? 'on' : ''}" data-pdf="reflow">Reflow</button><button type="button" class="${S.mode === 'page' ? 'on' : ''}" data-pdf="page">Original pages</button></div></div>` : ''}
      <div class="set-row"><span class="lbl">Auto-scroll</span>
        <div class="stepper"><button type="button" class="ib" data-step="speed:-1" aria-label="Slower auto-scroll">${icon('minus')}</button><output>Speed ${p.speed}</output><button type="button" class="ib" data-step="speed:1" aria-label="Faster auto-scroll">${icon('plus')}</button></div></div>
      <h3 class="lbl set-h">While reading</h3>
      ${toggle('orientationLock', 'Lock to portrait', 'Works in full screen or the installed app')}
      ${toggle('zoomLock', 'Lock zoom', 'Keeps the current zoom while you read and auto-scroll')}
      ${toggle('keepAwake', 'Keep screen on')}`
  }
  const d = sheet({ id: 'settings', title: 'Reading', body: render() })
  const wire = () => {
    d.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { prefs.set({ [b.dataset.k]: b.dataset.v }); refresh() })
    d.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      const [k, dv] = b.dataset.step.split(':'); const p = prefs.get()
      const v = k === 'size' ? Math.min(32, Math.max(13, p.size + Number(dv)))
        : k === 'speed' ? Math.min(8, Math.max(1, p.speed + Number(dv)))
        : Math.round(Math.min(2.2, Math.max(1.2, p.leading + Number(dv))) * 10) / 10
      prefs.set({ [k]: v }); refresh()
    })
    d.querySelectorAll('[data-t]').forEach(c => c.onchange = async () => {
      prefs.set({ [c.dataset.t]: c.checked })
      if (c.dataset.t === 'orientationLock' && c.checked && !(await lockOrientation(true))) toast('Portrait lock works in full screen or when installed. Tap the full-screen button.')
    })
    d.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => { if (b.dataset.pdf !== S.mode) { close(d); switchPdfMode() } })
  }
  const refresh = () => {
    const focusKey = document.activeElement?.dataset?.step ?? document.activeElement?.dataset?.v
    d.querySelector('.sheet-b').innerHTML = render(); wire()
    if (focusKey) d.querySelector(`[data-step="${focusKey}"], [data-v="${focusKey}"]`)?.focus()
  }
  wire()
}
