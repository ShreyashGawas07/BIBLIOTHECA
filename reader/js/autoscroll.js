// Auto-scroll. In scroll mode it moves the text smoothly; in page mode (and PDF Page mode)
// it turns pages on a timer. A finger on the screen holds it; lifting resumes after a beat.

const PX_PER_SEC = [10, 15, 21, 28, 37, 48, 62, 80]     // at 19px text
export const SEC_PER_PAGE = [48, 38, 30, 24, 19, 15, 12, 9]
const RESUME_AFTER = 1400

export class AutoScroll {
  playing = false
  #held = false
  #raf = 0
  #timer = 0
  #resume = 0
  #carry = 0
  #last = 0
  #turning = false
  #lastPageTurn = 0

  /** @param {{ view: any, speed: () => number, fontSize: () => number, onChange: (playing:boolean)=>void, onEnd: ()=>void }} o */
  constructor(o) { this.o = o }

  get #renderer() { return this.o.view.renderer }
  get #smooth() { return this.#renderer?.getAttribute?.('flow') === 'scrolled' && !!this.#renderer.scrollContainer }

  play() {
    if (this.playing) return
    this.playing = true
    this.#held = false
    this.#start()
    this.o.onChange(true)
  }
  pause() {
    if (!this.playing) return
    this.playing = false
    this.#stop()
    clearTimeout(this.#resume)
    this.o.onChange(false)
  }
  toggle() { this.playing ? this.pause() : this.play() }

  // finger down: hold without leaving "playing" state
  hold() {
    if (!this.playing) return
    this.#held = true
    clearTimeout(this.#resume)
    this.#stop()
  }
  release() {
    if (!this.playing || !this.#held) return
    clearTimeout(this.#resume)
    this.#resume = setTimeout(() => { this.#held = false; if (this.playing) this.#start() }, RESUME_AFTER)
  }
  // speed or mode changed while playing
  refresh() { if (this.playing && !this.#held) { this.#stop(); this.#start() } }

  #start() {
    this.#stop()
    if (this.#smooth) {
      this.#last = performance.now(); this.#carry = 0
      this.#raf = requestAnimationFrame(this.#tick)
    } else {
      const secs = SEC_PER_PAGE[this.o.speed() - 1] ?? 24
      this.#lastPageTurn = performance.now()
      this.#timer = setInterval(() => this.#turnPage(), secs * 1000)
    }
  }
  #stop() {
    cancelAnimationFrame(this.#raf); this.#raf = 0
    clearInterval(this.#timer); this.#timer = 0
  }

  #tick = now => {
    if (!this.playing || this.#held) return
    const dt = Math.min(64, now - this.#last)
    this.#last = now
    const el = this.#renderer?.scrollContainer
    if (el && !this.#turning) {
      const pxs = (PX_PER_SEC[this.o.speed() - 1] ?? 28) * (this.o.fontSize() / 19)
      this.#carry += pxs * dt / 1000
      const step = Math.floor(this.#carry)
      if (step >= 1) {
        this.#carry -= step
        const before = el.scrollTop
        el.scrollTop = before + step
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) this.#nextSection()
      }
    }
    this.#raf = requestAnimationFrame(this.#tick)
  }

  async #nextSection() {
    if (this.#turning) return
    this.#turning = true
    const before = this.o.view.lastLocation?.cfi
    await this.o.view.next()
    await new Promise(r => setTimeout(r, 400))
    this.#turning = false
    if (this.o.view.lastLocation?.cfi === before) { this.pause(); this.o.onEnd() }
  }

  async #turnPage() {
    if (this.#held) return
    const before = this.o.view.lastLocation?.cfi
    await this.o.view.next()
    setTimeout(() => {
      if (this.playing && this.o.view.lastLocation?.cfi === before) { this.pause(); this.o.onEnd() }
    }, 600)
  }
}

// ---------- device locks ----------
let wakeLock = null
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null }
  } catch { wakeLock = null }
}

// Android Chrome only allows orientation lock in fullscreen or an installed app.
export async function lockOrientation(on) {
  try {
    if (on) { await screen.orientation.lock('portrait'); return true }
    screen.orientation.unlock()
    return true
  } catch { return false }
}

const viewport = () => document.querySelector('meta[name=viewport]')
export function lockZoom(on) {
  viewport().setAttribute('content', on
    ? 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover'
    : 'width=device-width,initial-scale=1,viewport-fit=cover')
  document.documentElement.classList.toggle('zoom-lock', on)
}

export async function fullscreen(on) {
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    else if (!on && document.fullscreenElement) await document.exitFullscreen()
    return true
  } catch { return false }
}
