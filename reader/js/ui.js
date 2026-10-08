// Small UI helpers: icons, toast, sheets (native <dialog> for focus handling), formatting.

export const $ = (s, root = document) => root.querySelector(s)
export const $$ = (s, root = document) => [...root.querySelectorAll(s)]
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';')

const P = {
  back: '<path d="M12.5 4 6.5 10l6 6"/>',
  toc: '<path d="M4 5h12M4 10h12M4 15h8"/>',
  notes: '<path d="M5 3h8l3 3v11H5z"/><path d="M8 9h5M8 12h5"/>',
  type: '<path d="M3 16 7.5 4h1L13 16M4.6 12h6.8"/><path d="M14 16v-5.5a2 2 0 0 1 4 0V16M14 13h4"/>',
  play: '<path d="M7 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5v11M13.5 4.5v11" stroke-width="2.2"/>',
  minus: '<path d="M5 10h10"/>',
  plus: '<path d="M10 5v10M5 10h10"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  add: '<path d="M10 4v12M4 10h12"/>',
  more: '<circle cx="5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/>',
  expand: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
  shrink: '<path d="M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4"/>',
  rotate: '<rect x="6" y="3" width="8" height="14" rx="1.5"/><path d="M9 14.5h2"/>',
  zoom: '<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4M7 9h4"/>',
  sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  copy: '<rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H12"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.8 10.5h6.4L14 6"/>',
  pen: '<path d="M4 16l1-4 8.5-8.5 3 3L8 15z"/>',
  library: '<rect x="3" y="3" width="4" height="14"/><rect x="8" y="3" width="4" height="14"/><path d="m13 4 4 1-3 12-4-1"/>',
  download: '<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>',
  upload: '<path d="M10 14V4M6 8l4-4 4 4M4 16h12"/>',
  page: '<rect x="5" y="3" width="10" height="14" rx="1"/>',
  flow: '<path d="M5 4h10M5 8h10M5 12h10M5 16h6"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1"/>',
  lock: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  unlock: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
}
export const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] ?? ''}</svg>`

let toastTimer
export function toast(msg, { action, onAction, ms = 2600 } = {}) {
  const el = $('#toast')
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('on'); onAction?.() }
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('on'), action ? ms + 2400 : ms)
}

// Bottom sheet on phone, side drawer on wide screens. Built on <dialog> for focus trapping and Esc.
export function sheet({ id, title, body, side = 'right', onClose, wide = false }) {
  let d = document.getElementById(id)
  if (!d) {
    d = document.createElement('dialog')
    d.id = id
    d.className = `sheet ${side}${wide ? ' wide' : ''}`
    d.setAttribute('aria-labelledby', id + '-t')
    document.body.append(d)
    d.addEventListener('click', e => { if (e.target === d) close(d) })
    d.addEventListener('close', () => d._onClose?.())
    d.addEventListener('cancel', e => { e.preventDefault(); close(d) })
  }
  d._onClose = onClose
  d.innerHTML = `<div class="sheet-in"><div class="grab" aria-hidden="true"></div>
    <header class="sheet-h"><h2 id="${id}-t" class="serif">${esc(title)}</h2><button type="button" class="ib" data-close aria-label="Close">${icon('close')}</button></header>
    <div class="sheet-b"></div></div>`
  const b = d.querySelector('.sheet-b')
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body)
  d.querySelector('[data-close]').onclick = () => close(d)
  swipeToClose(d)
  if (!d.open) d.showModal()
  return d
}
export function close(d) {
  if (!d?.open) return
  d.classList.add('closing')
  setTimeout(() => { d.classList.remove('closing'); d.close() }, 180)
}

function swipeToClose(d) {
  const grab = d.querySelector('.grab'); const head = d.querySelector('.sheet-h')
  let y0 = null
  for (const el of [grab, head]) {
    el.addEventListener('touchstart', e => { y0 = e.touches[0].clientY }, { passive: true })
    el.addEventListener('touchmove', e => {
      if (y0 === null) return
      const dy = Math.max(0, e.touches[0].clientY - y0)
      d.querySelector('.sheet-in').style.transform = `translateY(${dy}px)`
    }, { passive: true })
    el.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - (y0 ?? 0)
      d.querySelector('.sheet-in').style.transform = ''
      y0 = null
      if (dy > 90) close(d)
    })
  }
}

export const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtBytes = n => n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`

export function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'book'
