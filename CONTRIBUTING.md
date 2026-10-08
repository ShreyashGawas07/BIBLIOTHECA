# Contributing to Bibliotheca

Thank you for wanting to make reading better. Every contribution counts, from a typo fix to a whole new feature.

## Run it in one minute

You need Python 3 (or any static file server) and a modern browser. There's no build step and no `npm install`.

```bash
git clone https://github.com/<you>/BIBLIOTHECA.git
cd BIBLIOTHECA
python -m http.server 8765
```

- Bibliotheca: http://localhost:8765
- Reader: http://localhost:8765/reader/

Use `localhost`, not `file://`: the service worker, ES modules and IndexedDB need a real origin. In Chrome DevTools, turn on **Application → Service workers → Update on reload** while developing, so you always get fresh files.

To test on your phone, open the same address over your Wi-Fi network (`python -m http.server 8765 --bind 0.0.0.0`, then visit `http://<your-pc-ip>:8765`). Install-to-home-screen and the service worker need HTTPS on anything other than localhost, so a free static host or a tunnel works best for install testing.

## Where things live

| You want to… | Look in |
|---|---|
| Change the library, import, backup | `reader/js/app.js` |
| Change the reading screen, controls, zoom, progress sync | `reader/js/reader.js` |
| Improve PDF reflow (headers, paragraphs, columns) | `reader/js/pdf-reflow.js` |
| Add or change file formats, DRM detection | `reader/js/formats.js` |
| Highlights, notebook, Markdown export | `reader/js/highlights.js`, `reader/js/notes.js` |
| Auto-scroll and device locks | `reader/js/autoscroll.js` |
| Themes, fonts, reading defaults | `reader/js/settings.js`, `reader/css/app.css` |
| How the reader talks to Bibliotheca | `reader/js/bridge.js` (the only file that touches `mybooks.v1`) |
| Bibliotheca itself (tracker, ledger) | `index.html` |
| Offline caching | `sw.js` |

[reader/DESIGN.md](reader/DESIGN.md) explains the architecture and the PDF pipeline.

## House rules for code

- **Keep it build-free.** Plain ES modules, no framework, no bundler. If a dependency is truly needed, vendor a pinned copy under `reader/vendor/` and add it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Match the surrounding style.** Two-space indent, no semicolons in the reader, small focused functions, comments that explain *why*.
- **Everything stays on the device.** No analytics, trackers, accounts, or network calls that send books, highlights or notes anywhere.
- **Phone first, desktop too.** Check 375 px wide and a desktop window. Touch targets are at least 44 px. Text contrast is at least 4.5:1 in every theme.
- **Accessible by default.** Real `<button>`s, `aria-label` on icon-only controls, and keyboard support.
- **Never commit book files.** `.gitignore` blocks PDFs and EPUBs. Make test books with original or public-domain text.
- **Vendored code.** If you patch something in `reader/vendor/foliate/`, mark it with a `// local patch (book reader):` comment and note it in `VERSION.txt`.
- **Bump the cache.** When you change files the app ships, bump `C='mybooks-vN'` in `sw.js` so installed apps update.

## Testing your change

There's no automated test suite yet, and adding one would be a great contribution. Until then, before opening a pull request:

1. Walk through [reader/TESTING.md](reader/TESTING.md) for the areas you touched.
2. Try at least one EPUB, one text PDF and one TXT file.
3. Check the browser console for errors. (A Content-Security-Policy error about a book's own `<script>` is expected: that's the reader blocking it.)
4. Check phone width, desktop width, and the Dusk/Night themes.

## Pull requests

1. Fork, then create a branch: `git checkout -b fix/pdf-footnotes`.
2. Keep each PR focused on one change. Small PRs get reviewed fast.
3. Describe what changed and how you tested it. For anything visual, add before/after screenshots.
4. Be patient and kind. This is maintained in spare time.

## Ideas to pick up

- Search inside a book (foliate-js already has a search module)
- Automated tests for `pdf-reflow.js` using small generated PDFs
- Better footnote and table handling in PDF reflow
- Text-to-speech
- Optional sync between devices (it must stay opt-in and private)
- Translations of the interface
- A smoother comic (CBZ) reading mode

Open an issue first for big features, so we can agree on the approach before you invest the time.

## Reporting bugs

Use the **Bug report** template. Include your device, browser and the file type. **Please don't attach copyrighted books**: describe the file, or share a small sample you made yourself.
