// Highlights: selection toolbar, drawing, editing. Saved to IndexedDB the moment you tap a colour.

import { Overlayer } from '../vendor/foliate/overlayer.js'
import * as db from './db.js'
import * as prefs from './settings.js'
import { $, esc, icon, toast } from './ui.js'

export const COLORS = {
  yellow: { label: 'Yellow', hex: '#e9b730' },
  green: { label: 'Green', hex: '#6fae6a' },
  blue: { label: 'Blue', hex: '#5f9bd6' },
  pink: { label: 'Pink', hex: '#e07a9c' },
}
export const STYLES = {
  highlight: { label: 'Highlight' },
  underline: { label: 'Underline' },
  squiggly: { label: 'Squiggle' },
}

/**
 * @param {{ view: any, bookId: string, mode: string, version: number, locate: (index:number, range:Range) => {chapter:string, page:number|null}, onChange: () => void, onNote: (h:any) => void }} ctx
 */
export async function initHighlights(ctx) {
  const { view, bookId } = ctx
  let items = await db.byBook('highlights', bookId)
  const byCfi = () => new Map(items.map(h => [h.cfi, h]))

  // Only draw highlights made in this layout (PDF Reflow and Page mode number sections differently)
  // and, for reflowed PDFs, against the same reflow output. The rest stay listed in the notebook.
  const legacyMode = ctx.mode === 'page' ? 'reflow' : ctx.mode
  const drawable = h => (h.mode ?? legacyMode) === ctx.mode && (h.version ?? 0) === (ctx.version ?? 0)
  view.addEventListener('create-overlay', ({ detail: { index } }) => {
    for (const h of items) if (h.index === index && drawable(h))
      view.addAnnotation({ value: h.cfi }).catch(e => console.warn('Could not place highlight', h.id, e))
  })
  view.addEventListener('draw-annotation', ({ detail: { draw, annotation } }) => {
    const h = byCfi().get(annotation.value)
    if (!h) return
    const color = COLORS[h.color]?.hex ?? COLORS.yellow.hex
    if (h.style === 'underline') draw(Overlayer.underline, { color, width: 2.5 })
    else if (h.style === 'squiggly') draw(Overlayer.squiggly, { color, width: 2 })
    else draw(Overlayer.highlight, { color })
  })
  let lastStroke = 0
  view.addEventListener('show-annotation', ({ detail: { value } }) => {
    if (Date.now() - lastStroke < 600) return // the click that ends a pen stroke
    const h = byCfi().get(value)
    if (h) editSheet(h)
  })

  // ---------- selection toolbar ----------
  const bar = $('#selbar')
  let pending = null // { doc, index, range }
  const hideBar = () => { bar.hidden = true; pending = null }

  function renderBar() {
    const p = prefs.get()
    bar.innerHTML = `<div class="sel-in" role="toolbar" aria-label="Highlight selection">
      ${Object.entries(COLORS).map(([k, c]) => `<button type="button" class="dot ${p.hlColor === k ? 'on' : ''}" data-c="${k}" style="--c:${c.hex}" aria-label="Highlight ${c.label}"></button>`).join('')}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="ib sty" data-s aria-label="Style: ${STYLES[p.hlStyle].label}. Tap to change">${styleGlyph(p.hlStyle)}</button>
      <button type="button" class="ib" data-n aria-label="Highlight and add note">${icon('pen')}</button>
      <button type="button" class="ib" data-copy aria-label="Copy text">${icon('copy')}</button>
    </div>`
    bar.querySelectorAll('[data-c]').forEach(b => b.onclick = () => create(b.dataset.c))
    bar.querySelector('[data-s]').onclick = () => {
      const keys = Object.keys(STYLES); const next = keys[(keys.indexOf(prefs.get().hlStyle) + 1) % keys.length]
      prefs.set({ hlStyle: next }); renderBar(); bar.hidden = false
      toast(STYLES[next].label)
    }
    bar.querySelector('[data-n]').onclick = async () => { const h = await create(prefs.get().hlColor); if (h) ctx.onNote(h) }
    bar.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(pending?.range.toString() ?? ''); toast('Copied') } catch { toast('Copy is blocked by the browser') }
    }
  }

  async function create(color) {
    if (!pending) return
    const { doc, index, range } = pending
    const text = range.toString().replace(/\s+/g, ' ').trim()
    if (!text) return hideBar()
    const cfi = view.getCFI(index, range)
    const { chapter, page } = ctx.locate(index, range)
    const h = { id: db.uid(), bookId, cfi, index, text, color, style: prefs.get().hlStyle, note: '', chapter, page, mode: ctx.mode, version: ctx.version ?? 0, created: Date.now() }
    try { await db.put('highlights', h) } catch (e) { toast('Could not save: ' + e.message); return }
    prefs.set({ hlColor: color })
    items.push(h)
    await view.addAnnotation({ value: cfi })
    doc.getSelection().removeAllRanges()
    hideBar()
    ctx.onChange()
    toast('Highlighted', { action: 'Undo', onAction: () => remove(h.id) })
    return h
  }

  function watchDoc(doc, index) {
    let t
    doc.addEventListener('selectionchange', () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) { if (pending?.doc === doc) hideBar(); return }
        pending = { doc, index, range: sel.getRangeAt(0).cloneRange() }
        renderBar()
        bar.hidden = false
      }, 220)
    })
  }
  // sections can finish loading while we read the database, so take those as well
  const seen = new WeakSet()
  const attach = ({ doc, index }) => { if (!doc || seen.has(doc)) return; seen.add(doc); watchDoc(doc, index); penDoc(doc, index) }
  view.addEventListener('load', e => attach(e.detail))

  // ---------- pen mode ----------
  // With the pen on, a finger drag paints a highlight straight away. The browser's own text selection
  // is off, so Chrome's search panel and copy menu never cover the page.
  const pen = $('#pen')
  let penOn = false
  const docs = new Set()
  function penDoc(doc, index) {
    docs.add(doc)
    const st = doc.createElement('style')
    st.textContent = `html.pen, html.pen * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; touch-action: none !important; cursor: text; }
      ::highlight(pen) { background-color: var(--pen, #e9b73066); }`
    doc.head?.append(st)
    doc.documentElement.classList.toggle('pen', penOn)
    let start = null, range = null
    const paint = () => {
      const H = doc.defaultView.Highlight, reg = doc.defaultView.CSS?.highlights
      if (!H || !reg) return
      if (range) reg.set('pen', new H(range)); else reg.delete('pen')
    }
    doc.addEventListener('pointerdown', e => {
      if (!penOn || e.button > 0 || !e.isPrimary) return
      start = caretAt(doc, e.clientX, e.clientY); range = null
      doc.documentElement.style.setProperty('--pen', COLORS[prefs.get().hlColor].hex + '66')
    })
    doc.addEventListener('pointermove', e => {
      if (!penOn || !start) return
      const end = caretAt(doc, e.clientX, e.clientY)
      if (!end) return
      range = wordRange(doc, start, end); paint()
    })
    const finish = async e => {
      if (!start) return
      const r = range; start = range = null; paint()
      if (r) lastStroke = Date.now()
      if (e.type === 'pointercancel' || !r || !r.toString().trim()) return
      pending = { doc, index, range: r }
      await create(prefs.get().hlColor)
    }
    doc.addEventListener('pointerup', finish)
    doc.addEventListener('pointercancel', finish)
    // a tap with the pen on shouldn't open the controls or turn the page
    doc.addEventListener('click', e => { if (penOn && !e.target.closest?.('a[href]')) e.preventDefault() }, true)
  }

  function renderPen() {
    const p = prefs.get()
    pen.classList.toggle('on', penOn)
    pen.innerHTML = `${penOn ? `<div class="pen-opts" role="group" aria-label="Pen colour and style">
        ${Object.entries(COLORS).map(([k, c]) => `<button type="button" class="dot ${p.hlColor === k ? 'on' : ''}" data-c="${k}" style="--c:${c.hex}" aria-label="${c.label}" aria-pressed="${p.hlColor === k}"></button>`).join('')}
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="ib sty" data-s aria-label="Style: ${STYLES[p.hlStyle].label}. Tap to change">${styleGlyph(p.hlStyle)}</button>
      </div>` : ''}
      <button type="button" class="pen-btn" data-pen aria-pressed="${penOn}" aria-label="${penOn ? 'Pen on: drag over text to highlight. Tap to turn off' : 'Highlight pen'}" style="--c:${COLORS[p.hlColor].hex}">${icon('pen', 22)}</button>`
    pen.querySelector('[data-pen]').onclick = () => setPen(!penOn)
    pen.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { prefs.set({ hlColor: b.dataset.c }); renderPen() })
    pen.querySelector('[data-s]')?.addEventListener('click', () => {
      const keys = Object.keys(STYLES); prefs.set({ hlStyle: keys[(keys.indexOf(prefs.get().hlStyle) + 1) % keys.length] }); renderPen()
    })
  }
  function setPen(on) {
    penOn = on
    for (const d of docs) { if (!d.defaultView) { docs.delete(d); continue } d.documentElement.classList.toggle('pen', on); d.getSelection()?.removeAllRanges() }
    hideBar()
    document.body.classList.toggle('pen-on', on)
    ctx.onPen?.(on)
    renderPen()
    if (on) toast('Drag over text to highlight')
  }
  pen.hidden = false
  renderPen()
  for (const c of view.renderer.getContents?.() ?? []) attach(c)

  // ---------- edit sheet ----------
  function editSheet(h) {
    const d = $('#hl-edit')
    const draw = () => {
      d.querySelector('.hl-body').innerHTML = `
        <blockquote class="quote" style="--c:${COLORS[h.color].hex}">${esc(h.text)}</blockquote>
        <div class="hl-meta lbl">${esc([h.chapter, h.page ? 'p. ' + h.page : ''].filter(Boolean).join(' · '))}</div>
        <div class="row-opts" role="group" aria-label="Colour">
          ${Object.entries(COLORS).map(([k, c]) => `<button type="button" class="dot ${h.color === k ? 'on' : ''}" data-c="${k}" style="--c:${c.hex}" aria-label="${c.label}" aria-pressed="${h.color === k}"></button>`).join('')}
        </div>
        <div class="seg" role="group" aria-label="Style">
          ${Object.entries(STYLES).map(([k, s]) => `<button type="button" class="${h.style === k ? 'on' : ''}" data-s="${k}" aria-pressed="${h.style === k}">${styleGlyph(k)}<span>${s.label}</span></button>`).join('')}
        </div>
        <label class="fld-l"><span class="lbl">Your note</span>
          <textarea class="fld" rows="3" placeholder="Why does this matter?">${esc(h.note)}</textarea></label>
        <div class="acts">
          <button type="button" class="ghost danger" data-del>${icon('trash', 18)}Delete</button>
          <button type="button" class="ghost" data-copy>${icon('copy', 18)}Copy</button>
          <span class="grow"></span>
          <button type="button" class="solid" data-done>Done</button>
        </div>`
      d.querySelectorAll('[data-c]').forEach(b => b.onclick = () => save({ color: b.dataset.c }))
      d.querySelectorAll('[data-s]').forEach(b => b.onclick = () => save({ style: b.dataset.s }))
      const ta = d.querySelector('textarea')
      ta.onchange = () => save({ note: ta.value.trim() }, false)
      d.querySelector('[data-del]').onclick = async () => { d.close(); await remove(h.id, true) }
      d.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(h.text); toast('Copied') } catch {} }
      d.querySelector('[data-done]').onclick = () => { if (ta.value.trim() !== h.note) save({ note: ta.value.trim() }, false); d.close() }
    }
    const save = async (patch, redraw = true) => {
      Object.assign(h, patch)
      await db.put('highlights', h)
      if (patch.color || patch.style) { await view.deleteAnnotation({ value: h.cfi }); await view.addAnnotation({ value: h.cfi }) }
      ctx.onChange()
      if (redraw) draw()
    }
    draw()
    d.querySelector('.sheet-h .ib').onclick = () => d.close()
    d.onclick = e => { if (e.target === d) d.close() }
    if (!d.open) d.showModal()
    return d
  }

  async function remove(id, undoable = false) {
    const h = items.find(x => x.id === id)
    if (!h) return
    await db.del('highlights', id)
    items = items.filter(x => x.id !== id)
    await view.deleteAnnotation({ value: h.cfi })
    ctx.onChange()
    if (undoable) toast('Highlight deleted', { action: 'Undo', onAction: async () => { await db.put('highlights', h); items.push(h); await view.addAnnotation({ value: h.cfi }); ctx.onChange() } })
  }

  return {
    list: () => items,
    remove,
    edit: editSheet,
    hideBar,
    penOn: () => penOn,
    destroy() { penOn = false; document.body.classList.remove('pen-on'); pen.hidden = true; pen.innerHTML = '' },
    async reload() { items = await db.byBook('highlights', bookId) },
  }
}

// caret position under a point, skipping our own UI
function caretAt(doc, x, y) {
  const r = doc.caretRangeFromPoint?.(x, y)
  if (r) return { node: r.startContainer, offset: r.startOffset }
  const p = doc.caretPositionFromPoint?.(x, y)
  return p ? { node: p.offsetNode, offset: p.offset } : null
}
// range between two carets, in document order, widened to whole words
function wordRange(doc, a, b) {
  const r = doc.createRange()
  r.setStart(a.node, a.offset); r.setEnd(a.node, a.offset)
  if (r.comparePoint(b.node, b.offset) < 0) r.setStart(b.node, b.offset); else r.setEnd(b.node, b.offset)
  const isW = c => /[\p{L}\p{N}'’-]/u.test(c)
  const sc = r.startContainer, ec = r.endContainer
  if (sc.nodeType === 3) { let o = r.startOffset; while (o > 0 && isW(sc.data[o - 1])) o--; r.setStart(sc, o) }
  if (ec.nodeType === 3) { let o = r.endOffset; while (o < ec.data.length && isW(ec.data[o])) o++; r.setEnd(ec, o) }
  return r
}

export function styleGlyph(style) {
  const base = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
  if (style === 'underline') return base + '<text x="10" y="13" text-anchor="middle" font-size="12" font-family="Literata,serif" fill="currentColor">a</text><path d="M4 16.5h12" stroke="currentColor" stroke-width="1.8"/></svg>'
  if (style === 'squiggly') return base + '<text x="10" y="12" text-anchor="middle" font-size="12" font-family="Literata,serif" fill="currentColor">a</text><path d="M3.5 16.5l2-1.6 2 1.6 2-1.6 2 1.6 2-1.6 2 1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  return base + '<rect x="3" y="4" width="14" height="12" rx="2" fill="currentColor" opacity=".22"/><text x="10" y="14" text-anchor="middle" font-size="12" font-family="Literata,serif" fill="currentColor">a</text></svg>'
}
