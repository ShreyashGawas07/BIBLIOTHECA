# Reader (part of Bibliotheca)

A quiet, phone-first reader for your own book files. It lives inside Bibliotheca at `/reader/`, works offline, and logs the pages you read to Bibliotheca's reading ledger.

Everything stays on the device. There is no server, no account and no analytics, and no network request carries your books, highlights or notes.

## Run locally

No build step and no dependencies. Any static server works:

```bash
python -m http.server 8765
```

Then open `http://localhost:8765/reader/`. Use a server, not `file://`: ES modules, the service worker and IndexedDB need an http origin.

## Deploy

The reader deploys with Bibliotheca. Commit and push to `main`, and GitHub Pages serves it at `https://shreyashgawas07.github.io/my-books/reader/`.

After changing any reader file, bump the cache name in `../sw.js` (`mybooks-vN`) so installed apps pick up the new version.

## On your Android phone

1. Open `…/my-books/` in Chrome, then open the menu and choose **Install app** (or **Add to Home screen**).
2. Launch from the home screen. The browser's address bar is gone.
3. In a book, tap the centre of the page, then tap the **full-screen** button in the bottom bar. This hides Android's status bar (time, battery) too. Portrait lock takes effect in full screen.

A web page can't hide the status bar on its own. Hiding it needs the installed app plus full screen, as described above.

## Supported formats

| Format | How it reads |
|---|---|
| EPUB 2/3 | Reflows to your screen (foliate-js) |
| MOBI, AZW3 (DRM-free) | Reflows |
| FB2, FBZ | Reflows |
| CBZ (comics) | One page at a time |
| PDF with text | **Reflow** mode: text only, re-laid out for the phone. One tap switches to **Page** mode (the original pages). |
| Scanned PDF | Detected automatically and shown in Page mode, with a message |
| TXT, Markdown | Reflows. Chapters are detected from headings such as "CHAPTER I". |
| HTML | Reflows. Scripts and forms are removed. |

These files get a clear message and are never crashed on:
- DRM (Adobe, Apple, LCP, Kindle)
- password-protected PDFs
- `.acsm` tickets
- KFX, DOCX, DJVU and CBR

## Using it

- **Controls:** tap the middle of the page to show or hide them. They fade after 3 s.
- **Pages layout:** tap the left or right edge to turn the page.
- **Auto-scroll:** tap the **Auto-scroll** button in the bottom bar. Pause and speed −/+ appear while it runs; speed (1–8) is also in Aa settings.
  - In Scroll layout the text moves smoothly. In Pages layout and PDF Page mode it turns a page on a timer, and says how often when it starts.
  - A finger on the screen holds it; lift and it resumes after a moment. Tapping the middle shows the controls without stopping it.
- **Moving between chapters (Scroll layout):** a short swipe or one scroll-wheel step past the end of a chapter continues into the next one.
- **Desktop:** move the mouse to show the controls. Use arrow keys, Space and Page Up/Down to read (Space still presses a focused button).
- **Zoom, then lock it:** pinch (or Ctrl + scroll wheel, or − / + in the bar on wider screens). In PDF Page mode and comics this zooms the page up to 400%, and you can pan in every direction. In other books it changes the text size. Tap the **lock** in the bottom bar to keep that zoom while you read and auto-scroll; tap it again to change it.
- **Highlight:** select text, then tap a colour (one tap). Use the style button to cycle between Highlight, Underline and Squiggle. The pen button highlights and opens a note.
- **Edit a highlight:** tap it to change colour or style, add a note, or delete it.
- **Notebook:** the page icon at the top.
  - Highlights are grouped by chapter, and tapping one jumps to it.
  - Notes are typed (Key idea, Learning, Question, To apply, Summary) and saved with the chapter and page you were on. Lines starting with `-` become a list.
  - **Export** writes Markdown.
- **Reading settings (Aa):**
  - theme (Auto, Paper, Sepia, Dusk, Night), size, line spacing, font, margins, alignment, Scroll or Pages layout
  - lock to portrait, lock zoom, keep the screen on
  - Settings apply instantly and are remembered.
- **Back up:** use the ⋯ menu on the library screen to back up everything or notes only, and to restore.

## How Bibliotheca counting works

- **Linking:** on import, the reader links the book to a Bibliotheca entry with the same title, or creates one with status *Want*. You can change the link from the ⋯ menu on the book.
- **Counting:** reading forward adds pages to today's log in Bibliotheca. The rules are Bibliotheca's own:
  - the first progress sets the book to *Reading*
  - the last page sets it to *Finished*
- **Jumps don't count:** using the contents list, the slider, a link, or a highlight jump moves the bookmark without logging pages. Neither does anything faster than about one page per 4 seconds.
- **Page numbers:** PDFs use real page numbers. Other formats map your position onto the page total set in Bibliotheca. If that total is empty, the reader uses its own estimate of about 1,500 characters per page.
- **Bibliotheca's "Read in Reader" button** opens the linked book, or asks for the file if it isn't in the reader yet.

## Files

```
reader/
  index.html          shell + Content-Security-Policy (blocks scripts inside books)
  css/app.css         all styles; theme tokens at the top
  js/app.js           library, import, routing, storage & backup
  js/reader.js        reading screen, chrome, position, Bibliotheca sync
  js/pdf-reflow.js    PDF → phone text (running heads, folios, hyphens, paragraphs, two columns)
  js/formats.js       detection, DRM checks, TXT/HTML books, fingerprints
  js/highlights.js    selection toolbar, drawing, edit sheet
  js/notes.js         notebook + Markdown export
  js/autoscroll.js    auto-scroll + wake lock, orientation, zoom, full-screen helpers
  js/settings.js      reading prefs (localStorage) + CSS injected into books
  js/db.js            IndexedDB (books, files, reflow cache, highlights, notes) + backup
  js/bridge.js        the ONLY code that reads/writes Bibliotheca's mybooks.v1
  js/ui.js            icons, toast, sheets
  fonts/              Literata, Instrument Serif, IBM Plex Mono (OFL, self-hosted)
  vendor/foliate/     foliate-js + pdf.js (see VERSION.txt for commit and local patches)
```

Storage:
- **IndexedDB** (`bibliotheca-reader`) holds the books, highlights and notes.
- **localStorage** (`reader.prefs.v1`) holds only the reading settings.
- The reader's persistent-storage request goes in after your first import, so Chrome doesn't evict your data under storage pressure.

## Known limitations

- **Messy titles are tidied:** download-site tags such as "(z-library.sk, …)" are removed, and a trailing "(Author Name)" becomes the author.
- **PDF reflow quality varies.** Tables, footnotes, sidebars, maths and complex layouts can come out jumbled, and images are left out. Page mode is always one tap away. Image-only pages are listed in the text as skipped.
- Scanned PDFs can't be reflowed. There's no OCR.
- Page numbers for EPUB, MOBI, FB2 and TXT are estimates unless Bibliotheca has the real page count.
- Highlights in PDF **Page mode** use the PDF's own text layer and may sit slightly off. Highlights made in Reflow mode don't appear in Page mode, and vice versa.
- **Requires a current browser:** Chrome or Edge 140 or newer, Android Chrome, or Safari 18.2 or newer. PDF.js 5 relies on newer JavaScript features.
- Portrait lock works only in full screen or the installed app (an Android Chrome rule). iPhone doesn't support it at all.
- Data lives in this browser on this device. Clearing site data deletes it, so keep a backup. There's no sync between devices.
- **Auto-created entries:** importing a book that isn't in Bibliotheca creates an entry there. Remove it in Bibliotheca if you don't want it; the reader keeps working, and you can unlink the book from its ⋯ menu.

## Credits

[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT) and [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0). Fonts are under the SIL Open Font License.
