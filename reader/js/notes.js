// Notebook: per-book highlights and notes, grouped by chapter, with Markdown export.

import * as db from './db.js'
import { COLORS, STYLES } from './highlights.js'
import { $, esc, icon, toast, sheet, close, fmtDate, download, slug } from './ui.js'

export const KINDS = {
  idea: { label: 'Key idea' },
  learn: { label: 'Learning' },
  question: { label: 'Question' },
  action: { label: 'To apply' },
  summary: { label: 'Summary' },
}

let tab = 'highlights'
let filter = ''

/**
 * @param {{ book: any, view: any, jump: (target:string) => Promise<any>, highlights: any, here: () => {chapter:string, cfi:string, page:number|null} }} ctx
 */
export function openNotebook(ctx, startTab) {
  if (startTab) tab = startTab
  const d = sheet({ id: 'notebook', title: 'Notebook', body: '<div class="nb"></div>', wide: true })
  render(ctx, d.querySelector('.nb'))
  return d
}

async function render(ctx, root) {
  const hl = sortByPos(ctx.highlights.list())
  const notes = (await db.byBook('notes', ctx.book.id)).sort((a, b) => b.created - a.created)
  root.innerHTML = `
    <div class="nb-top">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${tab === 'highlights'}" data-tab="highlights">Highlights <em>${hl.length}</em></button>
        <button type="button" role="tab" aria-selected="${tab === 'notes'}" data-tab="notes">Notes <em>${notes.length}</em></button>
      </div>
      <button type="button" class="ghost sm" data-export ${hl.length + notes.length ? '' : 'disabled'}>${icon('download', 16)}Export</button>
    </div>
    <div class="nb-list" role="tabpanel"></div>`
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(ctx, root) })
  root.querySelector('[data-export]').onclick = () => exportMarkdown(ctx.book, hl, notes)
  const list = root.querySelector('.nb-list')
  if (tab === 'highlights') renderHighlights(ctx, list, hl, root)
  else renderNotes(ctx, list, notes, root)
}

function sortByPos(items) {
  return [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || (a.page ?? 0) - (b.page ?? 0) || a.cfi.localeCompare(b.cfi, undefined, { numeric: true }))
}

const groupBy = (arr, key) => arr.reduce((m, x) => { const k = key(x) || 'Untitled section'; (m.get(k) ?? m.set(k, []).get(k)).push(x); return m }, new Map())

function renderHighlights(ctx, list, hl, root) {
  if (!hl.length) {
    list.innerHTML = `<div class="nb-empty"><p class="serif">No highlights yet</p><p>Select text while reading, then tap a colour.</p></div>`
    return
  }
  list.innerHTML = [...groupBy(hl, h => h.chapter)].map(([ch, items]) => `
    <section class="nb-group"><h3 class="lbl">${esc(ch)}</h3>
    ${items.map(h => `<article class="hl-card" style="--c:${COLORS[h.color]?.hex}">
      <button type="button" class="hl-jump" data-go="${esc(h.id)}" aria-label="Go to highlight on ${h.page ? 'page ' + h.page : 'its page'}">
        <span class="quote ${h.style}">${esc(h.text)}</span>
        ${h.note ? `<span class="hl-note">${esc(h.note)}</span>` : ''}
        <span class="lbl">${h.page ? 'p. ' + h.page + ' · ' : ''}${fmtDate(h.created)}</span>
      </button>
      <button type="button" class="ib" data-edit="${esc(h.id)}" aria-label="Edit highlight">${icon('pen', 18)}</button>
    </article>`).join('')}</section>`).join('')
  list.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => {
    const h = hl.find(x => x.id === b.dataset.go)
    close($('#notebook'))
    await ctx.jump(h.cfi)
  })
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const h = hl.find(x => x.id === b.dataset.edit)
    const d = ctx.highlights.edit(h)
    d.addEventListener('close', () => render(ctx, root), { once: true })
  })
}

function renderNotes(ctx, list, notes, root) {
  const here = ctx.here()
  const shown = filter ? notes.filter(n => n.kind === filter) : notes
  list.innerHTML = `
    <form class="composer" autocomplete="off">
      <div class="chips" role="radiogroup" aria-label="Note type">
        ${Object.entries(KINDS).map(([k, v], i) => `<label class="chip"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}><span>${v.label}</span></label>`).join('')}
      </div>
      <label class="sr" for="note-body">Note</label>
      <textarea id="note-body" class="fld" rows="3" placeholder="What did you learn or understand here?" required></textarea>
      <div class="acts"><span class="lbl here">${esc(here.chapter || '')}${here.page ? ' · p. ' + here.page : ''}</span><span class="grow"></span><button class="solid" type="submit">Save note</button></div>
    </form>
    ${notes.length ? `<div class="chips filter" role="group" aria-label="Filter notes">
      <button type="button" class="chip-b ${!filter ? 'on' : ''}" data-f="" aria-pressed="${!filter}">All</button>
      ${Object.entries(KINDS).filter(([k]) => notes.some(n => n.kind === k)).map(([k, v]) => `<button type="button" class="chip-b ${filter === k ? 'on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${v.label}</button>`).join('')}
    </div>` : ''}
    ${shown.length ? [...groupBy(shown, n => n.chapter)].map(([ch, items]) => `<section class="nb-group"><h3 class="lbl">${esc(ch)}</h3>
      ${items.map(n => `<article class="note-card" data-id="${esc(n.id)}">
        <div class="note-h"><span class="kind k-${n.kind}">${KINDS[n.kind]?.label ?? 'Note'}</span><span class="lbl">${n.page ? 'p. ' + n.page + ' · ' : ''}${fmtDate(n.created)}</span></div>
        <div class="note-b">${fmtNote(n.body)}</div>
        <div class="acts">
          ${n.cfi ? `<button type="button" class="ghost sm" data-go="${esc(n.id)}">${icon('back', 16)}Go to place</button>` : ''}
          <span class="grow"></span>
          <button type="button" class="ib" data-edit="${esc(n.id)}" aria-label="Edit note">${icon('pen', 18)}</button>
          <button type="button" class="ib" data-del="${esc(n.id)}" aria-label="Delete note">${icon('trash', 18)}</button>
        </div></article>`).join('')}</section>`).join('')
      : notes.length ? '' : `<div class="nb-empty"><p>Notes are saved with the chapter you’re reading, so you can find them later.</p></div>`}`

  const form = list.querySelector('form')
  form.onsubmit = async e => {
    e.preventDefault()
    const body = form.querySelector('textarea').value.trim()
    if (!body) return
    const kind = form.querySelector('input[name=kind]:checked').value
    await db.put('notes', { id: db.uid(), bookId: ctx.book.id, kind, body, chapter: here.chapter, page: here.page, cfi: here.cfi, created: Date.now(), updated: Date.now() })
    toast('Note saved')
    render(ctx, root)
  }
  list.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(ctx, root) })
  list.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => {
    const n = notes.find(x => x.id === b.dataset.go); close($('#notebook')); await ctx.jump(n.cfi)
  })
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const n = notes.find(x => x.id === b.dataset.del)
    await db.del('notes', n.id); render(ctx, root)
    toast('Note deleted', { action: 'Undo', onAction: async () => { await db.put('notes', n); render(ctx, root) } })
  })
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const n = notes.find(x => x.id === b.dataset.edit)
    const card = b.closest('.note-card')
    card.querySelector('.note-b').innerHTML = `<label class="sr" for="e-${esc(n.id)}">Edit note</label><textarea id="e-${esc(n.id)}" class="fld" rows="4">${esc(n.body)}</textarea>
      <div class="acts"><span class="grow"></span><button type="button" class="ghost sm" data-cancel>Cancel</button><button type="button" class="solid sm" data-save>Save</button></div>`
    const ta = card.querySelector('textarea'); ta.focus()
    card.querySelector('[data-cancel]').onclick = () => render(ctx, root)
    card.querySelector('[data-save]').onclick = async () => { n.body = ta.value.trim() || n.body; n.updated = Date.now(); await db.put('notes', n); render(ctx, root) }
  })
}

// Light structure inside a note: "- item" lines become a list, blank lines separate paragraphs.
const BULLET = /^\s*[-*•]\s+/
function fmtNote(body) {
  const out = []
  let list = null, para = null
  const flush = () => {
    if (list) out.push(`<ul>${list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`)
    if (para) out.push(`<p>${para.map(esc).join('<br>')}</p>`)
    list = para = null
  }
  for (const line of body.split('\n')) {
    if (!line.trim()) { flush(); continue }
    if (BULLET.test(line)) { if (para) flush(); (list ??= []).push(line.replace(BULLET, '')) }
    else { if (list) flush(); (para ??= []).push(line) }
  }
  flush()
  return out.join('')
}

// ---------- Markdown ----------
export function toMarkdown(book, hl, notes) {
  const out = [`# ${book.title}`]
  if (book.author) out.push(`*${book.author}*`)
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`
  out.push('', `Exported ${new Date().toISOString().slice(0, 10)} · ${n(hl.length, 'highlight')} · ${n(notes.length, 'note')}`, '')
  if (hl.length) {
    out.push('## Highlights', '')
    for (const [ch, items] of groupBy(sortByPos(hl), h => h.chapter)) {
      out.push(`### ${ch}`, '')
      for (const h of items) {
        out.push(...h.text.split('\n').map(l => `> ${l}`))
        const meta = [COLORS[h.color]?.label, h.style !== 'highlight' ? STYLES[h.style]?.label : '', h.page ? `p. ${h.page}` : ''].filter(Boolean).join(' · ')
        out.push('>', `> — ${meta}`, '')
        if (h.note) out.push(`**Note:** ${h.note}`, '')
      }
    }
  }
  if (notes.length) {
    out.push('## Notes', '')
    for (const [kind, v] of Object.entries(KINDS)) {
      const items = notes.filter(n => n.kind === kind)
      if (!items.length) continue
      out.push(`### ${v.label}`, '')
      for (const n of items.sort((a, b) => a.created - b.created)) {
        const where = [n.chapter, n.page ? `p. ${n.page}` : ''].filter(Boolean).join(', ')
        const lines = n.body.split('\n')
        out.push(`- ${lines[0]}${where ? ` *(${where})*` : ''}`, ...lines.slice(1).map(l => `  ${l}`))
      }
      out.push('')
    }
  }
  return out.join('\n')
}

export async function exportMarkdown(book, hl, notes) {
  hl ??= await db.byBook('highlights', book.id)
  notes ??= await db.byBook('notes', book.id)
  const md = toMarkdown(book, hl, notes)
  const file = new File([md], `${slug(book.title)}-notes.md`, { type: 'text/markdown' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: book.title }); return } catch (e) { if (e.name === 'AbortError') return }
  }
  download(file, file.name)
}
