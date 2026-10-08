// Format detection, DRM checks, and book objects for formats foliate-js does not read itself
// (plain text, HTML, and reflowed PDF). Every format ends up in the same foliate renderer,
// so all books look and behave the same.

export class ReaderError extends Error {
  constructor(kind, message) { super(message); this.kind = kind }
}

export const SUPPORTED = '.epub,.mobi,.azw3,.azw,.prc,.fb2,.fbz,.cbz,.pdf,.txt,.text,.md,.html,.htm,.xhtml'
const EXT_HINT = /\.(epub|mobi|azw3?|prc|fb2|fbz|fb2\.zip|cbz|pdf|txt|text|md|markdown|html?|xhtml|kfx|lcpl|lcpdf|acsm|djvu|docx?|rtf|cbr)$/i

const bytes = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer())
const ascii = arr => String.fromCharCode(...arr)

export async function detect(file) {
  const name = file.name.toLowerCase()
  const head = await bytes(file, 0, 68)
  const ext = name.match(EXT_HINT)?.[1]
  if (ext === 'acsm') throw new ReaderError('drm', 'This .acsm file is a download ticket for an Adobe-protected book, not the book itself. Protected books cannot be opened here.')
  if (ext === 'lcpl' || ext === 'lcpdf') throw new ReaderError('drm', 'This book is protected with Readium LCP (DRM) and cannot be opened here.')
  if (ext === 'kfx') throw new ReaderError('unsupported', 'KFX is Amazon’s locked Kindle format and cannot be opened here. AZW3 and MOBI files without DRM work.')
  if (ext === 'djvu' || ext === 'docx' || ext === 'doc' || ext === 'rtf' || ext === 'cbr')
    throw new ReaderError('unsupported', `.${ext.toUpperCase()} files are not supported yet. Supported: EPUB, MOBI, AZW3, FB2, CBZ, PDF, TXT, HTML.`)

  if (ascii(head.slice(0, 5)) === '%PDF-') return 'pdf'
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (name.endsWith('.cbz')) return 'cbz'
    if (name.endsWith('.fbz') || name.endsWith('.fb2.zip')) return 'fb2'
    return 'epub'
  }
  if (ascii(head.slice(60, 68)) === 'BOOKMOBI' || ascii(head.slice(60, 68)) === 'TEXtREAd') return name.endsWith('.azw3') ? 'azw3' : 'mobi'
  if (name.endsWith('.fb2')) return 'fb2'
  if (/\.(html?|xhtml)$/.test(name)) return 'html'
  if (/\.(txt|text|md|markdown)$/.test(name) || file.type.startsWith('text/')) return 'txt'
  // Unknown extension: sniff for text.
  const sample = await bytes(file, 0, 4096)
  if (sample.length && sample.every(b => b === 9 || b === 10 || b === 13 || b >= 32)) return 'txt'
  throw new ReaderError('unsupported', 'This file type isn’t supported. Supported: EPUB, MOBI, AZW3, FB2, CBZ, PDF, TXT, HTML.')
}

export const LABEL = { epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', fb2: 'FB2', cbz: 'CBZ', pdf: 'PDF', txt: 'TXT', html: 'HTML' }

// ---------- DRM ----------
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

export async function checkDRM(file, format) {
  const drm = msg => { throw new ReaderError('drm', msg ?? 'This book is protected by DRM, so it can’t be opened here. Open it in the app you bought it from.') }
  if (format === 'epub') {
    const { configure, ZipReader, BlobReader, TextWriter } = await import('../vendor/foliate/vendor/zip.js')
    configure({ useWebWorkers: false })
    let entries
    try { entries = await new ZipReader(new BlobReader(file)).getEntries() }
    catch { throw new ReaderError('broken', 'This EPUB looks damaged (the archive can’t be read).') }
    const byName = new Map(entries.map(e => [e.filename, e]))
    if (byName.has('META-INF/rights.xml') || byName.has('META-INF/sinf.xml') || byName.has('META-INF/license.lcpl')) drm()
    const enc = byName.get('META-INF/encryption.xml')
    if (enc) {
      const xml = await enc.getData(new TextWriter())
      const algos = [...xml.matchAll(/Algorithm\s*=\s*"([^"]+)"/g)].map(m => m[1])
      if (algos.some(a => !FONT_OBFUSCATION.includes(a))) drm()
    }
    if (!byName.has('META-INF/container.xml')) throw new ReaderError('broken', 'This file is a ZIP archive but not a valid EPUB.')
  }
  if (format === 'mobi' || format === 'azw3') {
    const h = await bytes(file, 0, 82)
    const rec0 = new DataView(h.buffer).getUint32(78)
    const r = await bytes(file, rec0, rec0 + 16)
    const encryption = new DataView(r.buffer).getUint16(12)
    if (encryption !== 0) drm('This Kindle book is DRM-protected, so it can’t be opened here. Only DRM-free MOBI/AZW3 files work.')
  }
  if (format === 'pdf') {
    const size = file.size
    const text = new TextDecoder('latin1').decode(await bytes(file, 0, Math.min(size, 65536)))
      + new TextDecoder('latin1').decode(await bytes(file, Math.max(0, size - 65536), size))
    if (/EBX_HANDLER|\/ADEPT|Adobe\.APS|FOPN_/.test(text)) drm('This PDF is protected by Adobe DRM, so it can’t be opened here.')
  }
}

// ---------- identity ----------
export async function fingerprint(file) {
  const MB = 1 << 20
  const parts = [new TextEncoder().encode(String(file.size)), await bytes(file, 0, MB)]
  if (file.size > MB) parts.push(await bytes(file, file.size - MB, file.size))
  const buf = await new Blob(parts).arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function thumbnail(blob, width = 360) {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, width / bmp.width)
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    return await c.convertToBlob({ type: 'image/jpeg', quality: .82 })
  } catch { return null }
}

// ---------- shared HTML book ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
export { esc as escapeHTML }

const page = (body, lang, title) => `<!DOCTYPE html><html lang="${esc(lang || 'en')}"><head><meta charset="utf-8"><title>${esc(title || '')}</title></head><body>${body}</body></html>`

/**
 * Build a foliate "book" from already-rendered HTML sections.
 * @param {{title:string, author?:string, language?:string, sections:{label?:string, html:string}[], toc?:{label:string, href:string, subitems?:any[]}[]}} input
 * hrefs look like "s3" or "s3#pg12".
 */
export function makeHTMLBook({ title, author, language, sections, toc }) {
  const urls = new Map()
  const parser = new DOMParser()
  const split = href => {
    const [sid, frag] = String(href).split('#')
    return [sid, frag ?? null]
  }
  const indexOf = sid => Number(String(sid).slice(1))
  const book = {
    metadata: { title, author, language },
    dir: 'ltr',
    toc: toc?.length ? toc : sections.map((s, i) => ({ label: s.label || `Part ${i + 1}`, href: `s${i}` })),
    sections: sections.map((s, i) => ({
      id: `s${i}`,
      linear: 'yes',
      size: s.html.length,
      load: () => {
        if (!urls.has(i)) urls.set(i, URL.createObjectURL(new Blob([page(s.html, language, s.label)], { type: 'text/html' })))
        return urls.get(i)
      },
      unload: () => { const u = urls.get(i); if (u) { URL.revokeObjectURL(u); urls.delete(i) } },
      createDocument: () => parser.parseFromString(page(s.html, language, s.label), 'text/html'),
    })),
    resolveHref: href => {
      const [sid, frag] = split(href)
      return { index: indexOf(sid), anchor: doc => (frag && doc.getElementById(frag)) || 0 }
    },
    splitTOCHref: href => split(href),
    getTOCFragment: (doc, frag) => (frag && doc.getElementById(frag)) || doc.body,
    isExternal: href => /^\w+:/i.test(href),
    destroy: () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() },
  }
  return book
}

// ---------- plain text ----------
async function decodeText(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  catch { return new TextDecoder('windows-1252').decode(buf) }
}

const HEADING = /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|contents)\b[\s\S]{0,70}$|^[IVXLC]{1,7}\.?$|^\d{1,3}\.?$/i

export async function makeTextBook(file, title) {
  const text = (await decodeText(file)).replace(/\r\n?/g, '\n').replace(/­/g, '')
  const blankSplit = (text.match(/\n[ \t]*\n/g) || []).length > text.split('\n').length / 25
  const paras = (blankSplit ? text.split(/\n[ \t]*\n+/).map(p => p.replace(/\s*\n\s*/g, ' ')) : text.split('\n'))
    .map(p => p.trim()).filter(Boolean)

  const sections = []; const toc = []
  let cur = { label: '', parts: [], len: 0 }
  const flush = () => { if (cur.parts.length) sections.push({ label: cur.label, html: cur.parts.join('\n') }) }
  for (const p of paras) {
    const isHeading = p.length < 80 && HEADING.test(p)
    if (isHeading || cur.len > 40000) {
      flush()
      cur = { label: isHeading ? p : `${title} (cont.)`, parts: [], len: 0 }
      if (isHeading) toc.push({ label: p, href: `s${sections.length}` })
    }
    cur.parts.push(isHeading ? `<h2 class="rf-h">${esc(p)}</h2>` : `<p>${esc(p)}</p>`)
    cur.len += p.length
  }
  flush()
  if (!sections.length) throw new ReaderError('empty', 'This text file is empty.')
  sections[0].label ||= title
  return makeHTMLBook({ title, sections, toc: toc.length > 1 ? toc : null })
}

// ---------- standalone HTML ----------
export async function makeHTMLFileBook(file, title) {
  const doc = new DOMParser().parseFromString(await decodeText(file), 'text/html')
  doc.querySelectorAll('script, iframe, object, embed, form, link, meta, base').forEach(e => e.remove())
  doc.querySelectorAll('*').forEach(el => { for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name) })
  const t = doc.title || title
  const heads = [...doc.body.querySelectorAll('h1, h2')]
  heads.forEach((h, i) => { h.id ||= `h${i}` })
  const toc = heads.map(h => ({ label: h.textContent.trim().slice(0, 80), href: `s0#${h.id}` })).filter(x => x.label)
  return makeHTMLBook({ title: t, sections: [{ label: t, html: doc.body.innerHTML }], toc: toc.length > 1 ? toc : null })
}

// ---------- metadata helpers ----------
const lang = x => !x ? '' : typeof x === 'string' ? x : Object.values(x)[0] ?? ''
export const formatTitle = x => lang(x)
export function formatAuthor(a) {
  if (!a) return ''
  const one = c => typeof c === 'string' ? c : lang(c?.name)
  return Array.isArray(a) ? a.map(one).filter(Boolean).join(', ') : one(a)
}
// Download sites stamp names like "Title (Author) (z-library.sk, 1lib.sk).pdf". Keep the title, pull out the author.
const SITE_TAG = /\s*[([](?=[^)\]]*(?:z-?lib|1lib|libgen|annas?-archive|pdfdrive|ebook3000|[\w-]+\.(?:sk|com|org|net|io|lol|li|rs|gs|ru|se|to)\b))[^)\]]*[)\]]/gi
// "Rob Fitzpatrick", "J. R. R. Tolkien", "Kahneman, Daniel" — capitalised words only, so subtitles stay
const NAME = /^\p{Lu}[\p{L}.'’-]*(?:,?\s+\p{Lu}[\p{L}.'’-]*){1,4}$/u
export function cleanTitle(title, author = '') {
  let t = String(title || '').replace(SITE_TAG, '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.*\S)\s*\(([^()]{3,60})\)$/)
  const inner = m?.[2].trim()
  if (m && NAME.test(inner) && !/\b(edition|volume|vol|book|part|series|revised|updated|abridged|unabridged|anniversary|annotated|illustrated|collection|complete|classics?)\b/i.test(inner) && (!author || author === inner)) {
    t = m[1].trim()
    if (!author) author = m[2].trim()
  }
  return { title: t || String(title || '').trim(), author }
}

export const titleFromFilename = name => {
  const t = name.replace(/\.[^.]+$/, '').replace(/[_]+|(?<=\w)-(?=\w)/g, ' ').replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
