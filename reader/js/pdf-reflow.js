// PDF -> phone-friendly text. PDF.js parses in its own Web Worker; this file only
// assembles the extracted text: drops running headers/footers and page numbers,
// rejoins hyphenated words, merges lines into paragraphs, and handles two columns.

import '../vendor/foliate/vendor/pdfjs/pdf.mjs'
import { ReaderError, makeHTMLBook, escapeHTML as esc } from './formats.js'

const pdfjsLib = globalThis.pdfjsLib
const asset = p => new URL(`../vendor/foliate/vendor/pdfjs/${p}`, import.meta.url).href
pdfjsLib.GlobalWorkerOptions.workerSrc = asset('pdf.worker.mjs')

export const REFLOW_VERSION = 4

export async function openPDF(blob) {
  try {
    return await pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      cMapUrl: asset('cmaps/'), cMapPacked: true,
      standardFontDataUrl: asset('standard_fonts/'),
      isEvalSupported: false,
    }).promise
  } catch (e) {
    if (e?.name === 'PasswordException') throw new ReaderError('drm', 'This PDF is password-protected, so it can’t be opened here.')
    console.error(e)
    throw new ReaderError('broken', 'This PDF could not be read. It may be damaged.')
  }
}

export async function pdfInfo(pdf) {
  const { info, metadata } = await pdf.getMetadata().catch(() => ({}))
  return {
    title: metadata?.get?.('dc:title') || info?.Title || '',
    author: metadata?.get?.('dc:creator')?.toString?.() || info?.Author || '',
    pages: pdf.numPages,
  }
}

export async function pdfCover(pdf, width = 360) {
  try {
    const page = await pdf.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / vp1.width })
    const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: .82 })
  } catch { return null }
}

const median = arr => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// ---------- step 1: lines per page ----------
function linesOf(items, pageW) {
  const words = items
    .filter(it => it.str && it.str.trim())
    .map(it => {
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size }
    })
  if (!words.length) return []

  // Two-column detection: almost nothing crosses the vertical middle, and both halves hold text.
  const mid = pageW / 2
  const crossing = words.filter(w => w.x < mid - 4 && w.x + w.w > mid + 4).length
  const left = words.filter(w => w.x + w.w / 2 < mid)
  const right = words.filter(w => w.x + w.w / 2 >= mid)
  const twoCol = words.length > 40 && crossing / words.length < .04 && left.length > words.length * .25 && right.length > words.length * .25
  const columns = twoCol ? [left, right] : [words]

  const out = []
  columns.forEach((col, ci) => {
    const tol = median(col.map(w => w.size)) * .45
    const sorted = [...col].sort((a, b) => b.y - a.y || a.x - b.x)
    const groups = []
    for (const w of sorted) {
      const g = groups[groups.length - 1]
      if (g && Math.abs(g.y - w.y) <= tol) g.words.push(w)
      else groups.push({ y: w.y, words: [w] })
    }
    for (const g of groups) {
      g.words.sort((a, b) => a.x - b.x)
      let text = ''; let prevEnd = null
      for (const w of g.words) {
        if (prevEnd !== null && w.x - prevEnd > w.size * .18 && !/\s$/.test(text) && !/^\s/.test(w.str)) text += ' '
        text += w.str
        prevEnd = w.x + w.w
      }
      text = text.replace(/\s+/g, ' ').trim()
      if (!text) continue
      out.push({
        text, col: ci, y: g.y,
        x0: g.words[0].x, x1: prevEnd,
        size: median(g.words.map(w => w.size)),
      })
    }
  })
  return out
}

// ---------- step 2: running heads, folios ----------
const FOLIO = /^(page\s*)?[\divxlc]{1,6}(\s*(of|\/)\s*\d+)?$/i
const shape = t => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

function stripFurniture(pages) {
  const counts = new Map()
  const edge = p => {
    const sorted = [...p.lines].sort((a, b) => b.y - a.y)
    return [...sorted.slice(0, 2), ...sorted.slice(-2)]
  }
  for (const p of pages) for (const l of new Set(edge(p))) {
    const k = shape(l.text)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const threshold = Math.max(2, pages.length * .25)
  const body = median(pages.flatMap(p => p.lines.map(l => l.size))) || 10
  let removed = 0
  for (const p of pages) {
    const edges = new Set(edge(p))
    const inBand = l => l.y > p.h * .9 || l.y < p.h * .1
    p.lines = p.lines.filter(l => {
      if (!edges.has(l)) return true
      // running heads are small and sit at the very edge; big repeated lines are chapter titles
      const repeated = counts.get(shape(l.text)) >= threshold && pages.length >= 2 && l.size <= body * 1.15 && inBand(l)
      const drop = repeated || (inBand(l) && FOLIO.test(l.text))
      if (drop) removed++
      return !drop
    })
  }
  return removed
}

// ---------- step 3: paragraphs ----------
const ENDS_SENTENCE = /[.!?:;"”’)\]…]$/
function joinText(a, b) {
  const bare = b.replace(/^\u0000\d+\u0000/, '') // ignore a page marker at the join
  if (/[A-Za-zÀ-ɏ]-$/.test(a) && /^[a-zß-ɏ]/.test(bare)) return a.slice(0, -1) + b
  if (/­$/.test(a)) return a.slice(0, -1) + b
  return a + ' ' + b
}

function buildHTML(pages) {
  const all = pages.flatMap(p => p.lines)
  const body = median(all.map(l => l.size)) || 10
  const gaps = []
  for (const p of pages) for (let i = 1; i < p.lines.length; i++) {
    const a = p.lines[i - 1], b = p.lines[i]
    if (a.col === b.col && a.y > b.y) gaps.push(a.y - b.y)
  }
  const lineGap = median(gaps) || body * 1.3

  // Does this document mark paragraphs with a first-line indent? Then trust indents over line length.
  let indented = 0, total = 0
  for (const p of pages) {
    const left = [0, 1].map(c => median(p.lines.filter(l => l.col === c).map(l => l.x0)))
    for (const l of p.lines) { total++; const d = l.x0 - left[l.col]; if (d > body * .9 && d < body * 6) indented++ }
  }
  const usesIndent = total > 0 && indented / total > .02

  const blocks = [] // { type: 'p'|'h'|'note', text, page }
  let para = null
  let prev = null
  const close = () => { if (para) blocks.push(para); para = null }

  for (const p of pages) {
    const colLeft = [0, 1].map(c => median(p.lines.filter(l => l.col === c).map(l => l.x0)))
    const colRight = [0, 1].map(c => Math.max(0, ...p.lines.filter(l => l.col === c).map(l => l.x1)))
    let marked = false
    const mark = () => { if (!marked) { marked = true; return `\u0000${p.n}\u0000` } return '' }
    if (!p.lines.length) {
      close()
      blocks.push({ type: 'note', text: `Page ${p.n} has no selectable text (it may be an image). Switch to Page mode to see it.`, page: p.n })
      prev = null
      continue
    }
    for (const l of p.lines) {
      const isHeading = l.size > body * 1.22 && l.text.length < 140
      if (isHeading) {
        if (para?.type === 'h' && prev && prev.size === l.size && prev.page === p.n) { para.text += ' ' + l.text }
        else { close(); para = { type: 'h', text: mark() + l.text, page: p.n } }
        prev = { ...l, page: p.n }
        continue
      }
      let fresh = !para || para.type !== 'p'
      if (!fresh && prev) {
        const samePageCol = prev.page === p.n && prev.col === l.col
        // a first-line indent, not a block indent (indented quotes keep the same x on every line)
        const indent = l.x0 - colLeft[l.col] > body * .9 && l.x0 - colLeft[l.col] < body * 6
          && !(prev.page === p.n && prev.col === l.col && Math.abs(prev.x0 - l.x0) < body * .5)
        const right = prev.page === p.n ? colRight[prev.col] : prev.right
        const left = prev.page === p.n ? colLeft[prev.col] : prev.left
        const prevShort = prev.x1 < left + (right - left) * (usesIndent ? .7 : .85)
        if (samePageCol) {
          const gap = prev.y - l.y
          if (gap > lineGap * 1.55 || gap < 0) fresh = true
          else if (indent && ENDS_SENTENCE.test(prev.text)) fresh = true
          else if (prevShort && ENDS_SENTENCE.test(prev.text)) fresh = true
          // a line that stops well short of the margin ends a paragraph or a list/contents entry
          else if (prev.x1 < left + (right - left) * .6) fresh = true
        } else {
          // new page or column: keep going unless the previous line clearly ended a paragraph
          if (ENDS_SENTENCE.test(prev.text) && (prevShort || indent)) fresh = true
        }
      }
      if (fresh) { close(); para = { type: 'p', text: mark() + l.text, page: p.n } }
      else para.text = joinText(para.text, mark() + l.text)
      prev = { ...l, page: p.n, right: colRight[l.col], left: colLeft[l.col] }
    }
  }
  close()

  const renderText = t => esc(t).replace(/\u0000(\d+)\u0000/g, '<span class="rf-page" id="pg$1"></span>')
  return blocks.map(b => ({
    page: b.page,
    html: b.type === 'h' ? `<h3 class="rf-h">${renderText(b.text)}</h3>`
      : b.type === 'note' ? `<p class="rf-note" id="pg${b.page}">${esc(b.text)}</p>`
      : `<p>${renderText(b.text)}</p>`,
  }))
}

// ---------- outline ----------
async function outlinePages(pdf) {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline) return []
  const out = []
  const walk = async (items, depth) => {
    for (const it of items) {
      let page = null
      try {
        const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest
        if (dest?.[0]) page = (await pdf.getPageIndex(dest[0])) + 1
      } catch {}
      out.push({ node: { label: it.title, page }, depth })
      if (it.items?.length && depth < 1) await walk(it.items, depth + 1)
    }
  }
  await walk(outline, 0)
  return out
}

/**
 * Extract and reflow a whole PDF.
 * @returns {Promise<{version:number, pageCount:number, sections:{label:string, html:string, firstPage:number}[], toc:any[], removed:number, emptyPages:number}>}
 */
export async function reflow(pdf, { onProgress, title } = {}) {
  const pages = []
  let chars = 0
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const lines = linesOf(tc.items, vp.width)
    chars += lines.reduce((a, l) => a + l.text.length, 0)
    pages.push({ n, h: vp.height, lines })
    page.cleanup()
    onProgress?.(n / pdf.numPages)
    // early scanned-PDF exit: first 8 pages have almost no text
    if (n === Math.min(8, pdf.numPages) && chars / n < 25 && pdf.numPages > 2) {
      const rest = await Promise.all([Math.floor(pdf.numPages / 2), pdf.numPages].map(async k => (await (await pdf.getPage(k)).getTextContent()).items.length))
      if (rest.every(x => x < 5)) throw new ReaderError('scanned', 'This PDF is scanned images with no text, so it can’t be reflowed. It’s shown in Page mode instead.')
    }
  }
  if (chars / pdf.numPages < 25) throw new ReaderError('scanned', 'This PDF is scanned images with no text, so it can’t be reflowed. It’s shown in Page mode instead.')

  const removed = stripFurniture(pages)
  const emptyPages = pages.filter(p => !p.lines.length).length
  const blocks = buildHTML(pages)

  // Section boundaries: top-level outline entries when available, otherwise every ~12 pages.
  const outline = await outlinePages(pdf)
  let starts = [...new Set(outline.filter(o => o.depth === 0 && o.node.page).map(o => o.node.page))].sort((a, b) => a - b)
  if (starts.length < 2) starts = Array.from({ length: Math.ceil(pdf.numPages / 12) }, (_, i) => i * 12 + 1)
  if (starts[0] !== 1) starts.unshift(1)

  const sections = starts.map(s => ({ firstPage: s, label: '', parts: [] }))
  for (const b of blocks) {
    let i = sections.length - 1
    while (i > 0 && sections[i].firstPage > b.page) i--
    sections[i].parts.push(b.html)
  }
  // Fold tiny sections (a cover, a title page, a one-line part opener) into the next one,
  // so a book never opens on an almost empty screen and chapter hand-offs stay rare.
  const filled = sections.filter(s => s.parts.length)
  const nonEmpty = []
  let carry = null
  for (const s of filled) {
    if (carry) { s.parts.unshift(...carry.parts); s.firstPage = carry.firstPage; carry = null }
    const textLen = s.parts.join('').replace(/<[^>]+>/g, '').length
    if (textLen < 600 && s !== filled[filled.length - 1]) carry = s
    else nonEmpty.push(s)
  }
  const secOfPage = page => {
    let idx = 0
    nonEmpty.forEach((s, i) => { if (s.firstPage <= page) idx = i })
    return idx
  }
  // Table of contents from the PDF outline, one nesting level deep.
  const top = outline.filter(o => o.depth === 0)
  const href = page => page ? `s${secOfPage(page)}#pg${page}` : 's0'
  const toc = []
  let parent = null
  for (const o of outline) {
    const item = { label: o.node.label, href: href(o.node.page) }
    if (o.depth === 0) { parent = { ...item, subitems: [] }; toc.push(parent) }
    else if (o.depth === 1 && parent) parent.subitems.push(item)
  }
  toc.forEach(x => { if (!x.subitems.length) delete x.subitems })
  return {
    version: REFLOW_VERSION,
    pageCount: pdf.numPages,
    removed, emptyPages,
    sections: nonEmpty.map((s, i) => ({ label: top.find(o => o.node.page === s.firstPage)?.node.label || `Pages ${s.firstPage}–`, html: s.parts.join('\n'), firstPage: s.firstPage })),
    toc,
    title,
  }
}

export function reflowBook(data, meta) {
  return makeHTMLBook({ title: meta.title, author: meta.author, sections: data.sections, toc: data.toc.length ? data.toc : null })
}
