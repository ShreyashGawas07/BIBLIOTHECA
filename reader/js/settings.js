// Reading preferences. Small, so they live in localStorage (books and highlights do not).

const KEY = 'reader.prefs.v1'

export const THEMES = {
  paper: { label: 'Paper', bg: '#f4efe6', fg: '#24221e', mut: '#66615a', link: '#3f6f41' },
  sepia: { label: 'Sepia', bg: '#efe1c6', fg: '#43351f', mut: '#6e5c44', link: '#7a4b1c' },
  dark:  { label: 'Dusk',  bg: '#1b1a18', fg: '#ddd6c8', mut: '#a39d90', link: '#9fcf98' },
  black: { label: 'Night', bg: '#000000', fg: '#bdb7aa', mut: '#9a948a', link: '#8fc98a' },
}

export const FONTS = {
  serif: { label: 'Serif', css: '"Literata", Georgia, "Noto Serif", serif' },
  sans: { label: 'Sans', css: 'system-ui, Roboto, "Segoe UI", sans-serif' },
  book: { label: 'Book’s own', css: null },
}

export const MARGINS = { s: { label: 'Narrow', gap: '4%' }, m: { label: 'Medium', gap: '7%' }, l: { label: 'Wide', gap: '12%' } }

export const SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

const DEFAULTS = {
  theme: 'system',     // system | paper | sepia | dark | black
  font: 'serif',
  size: 19,            // px
  leading: 1.65,
  margin: 'm',
  align: 'start',      // start | justify (left reads better on narrow screens)
  flow: 'scrolled',    // scrolled | paginated
  speed: 3,            // 1..8
  zoomLock: false,      // pinch to zoom, then lock it in place
  orientationLock: true,
  keepAwake: true,
  hlColor: 'yellow',
  hlStyle: 'highlight',
}

let prefs = load()
const listeners = new Set()

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

export const get = () => prefs
export function set(patch) {
  prefs = { ...prefs, ...patch }
  // store only what differs from the defaults, so improved defaults still reach existing users
  const changed = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => DEFAULTS[k] !== v))
  try { localStorage.setItem(KEY, JSON.stringify(changed)) } catch {}
  for (const fn of listeners) fn(prefs, patch)
}
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn))

export function themeName(p = prefs) {
  if (p.theme !== 'system') return p.theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'paper'
}
export const theme = (p = prefs) => THEMES[themeName(p)]
export const isDark = (p = prefs) => ['dark', 'black'].includes(themeName(p))

const fontURL = f => new URL(`../fonts/${f}`, import.meta.url).href

// CSS injected into every book section (inside the reader iframe).
export function bookCSS(p = prefs) {
  const t = theme(p)
  const font = FONTS[p.font]?.css
  const justify = p.align === 'justify'
  return `@namespace epub "http://www.idpf.org/2007/ops";
@font-face { font-family: "Literata"; font-style: normal; font-weight: 200 900; font-display: swap; src: url("${fontURL('literata.woff2')}") format("woff2"); }
@font-face { font-family: "Literata"; font-style: italic; font-weight: 200 900; font-display: swap; src: url("${fontURL('literata-italic.woff2')}") format("woff2"); }
html {
  color-scheme: ${isDark(p) ? 'dark' : 'light'};
  background: ${t.bg} !important;
  color: ${t.fg} !important;
  font-size: ${p.size}px !important;
  -webkit-text-size-adjust: none; text-size-adjust: none;
}
body { background: transparent !important; color: inherit !important; ${font ? `font-family: ${font} !important;` : ''} }
${font ? `body *:not(code):not(pre):not(kbd):not(samp) { font-family: inherit !important; }` : ''}
p, li, blockquote, dd, div {
  line-height: ${p.leading} !important;
  text-align: ${justify ? 'justify' : 'start'};
  hyphens: ${justify ? 'auto' : 'manual'}; -webkit-hyphens: ${justify ? 'auto' : 'manual'};
  hanging-punctuation: allow-end last; widows: 2; orphans: 2;
}
p, li, dd, blockquote, span, div, td { color: inherit !important; }
[align="center"], .center, center { text-align: center; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25 !important; color: inherit !important; text-align: start; hyphens: manual; }
a:any-link { color: ${t.link} !important; text-decoration-thickness: 1px; text-underline-offset: 2px; }
img, svg, video { max-width: 100% !important; height: auto; }
pre { white-space: pre-wrap !important; }
::selection { background: ${isDark(p) ? '#8fc98a55' : '#3f6f4133'}; }
aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
/* reflowed PDF / text sections */
.rf-page { font-size: 0; }
.rf-h { font-weight: 600; margin: 1.6em 0 .7em; }
.rf-note { color: ${t.mut} !important; font-size: .8em; text-align: center !important; margin: 2em 0; }
`
}
