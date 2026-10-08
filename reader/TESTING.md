# Test checklist

Tested on 2026-10-08 in desktop Chromium at phone size (375×812) through a local server, plus a Node script for the PDF reflow engine.

**Not tested yet on a real Android phone.** Feel, touch handling, auto-scroll smoothness, install and full-screen behaviour need checking on the device (see the bottom section).

Test files were generated locally:
- a 6-chapter EPUB with a cover and an embedded `<script>`
- a 25-page text PDF with running heads, page numbers, hyphenated line breaks and an outline
- a 3-page two-column PDF
- a 4-page image-only (scanned) PDF
- an AES-256 password PDF
- an EPUB with Adobe `rights.xml` and AES `encryption.xml`
- a TXT file with "CHAPTER I" headings

| # | Acceptance criterion | Result | Notes |
|---|---|---|---|
| 1 | EPUB opens fast and is readable in portrait without zoom | **Pass** (small file) | Test EPUB opened in about 1 s. Not timed with a 20 MB EPUB. |
| 2 | Text PDF opens in Reflow with headers, footers and page numbers removed | **Pass** | 25 pages: 50 header/footer lines removed, 250/250 paragraphs and 25/25 chapter headings correct, 0 hyphen breaks left. Two-column PDF: columns in the right order, 40/40 paragraphs. |
| 3 | Scanned PDF falls back to Page mode with a clear message | **Pass** | Banner: "Scanned PDF: shown as pages. Text can't be reflowed." |
| 4 | DRM file shows a clear message and doesn't crash | **Pass** | DRM EPUB and password PDF both gave friendly messages and other imports carried on. A DRM-protected MOBI wasn't tested (no sample); the check reads the MOBI header's encryption field. |
| 5 | Text settings and theme apply instantly and persist | **Pass** | Layout switched Scroll→Pages live. Prefs are stored in localStorage and survive reload. |
| 6 | Auto-scroll is smooth and pauses on touch | **Partly tested** | Scrolling and play/pause work. Smoothness on a mid-range phone and touch-hold weren't tested on a device. |
| 7 | Highlight in ≤ 2 taps, survives reload, jumps back | **Pass** | One tap on a colour saves it to IndexedDB (text, colour, chapter, page, CFI). Redrawn after reload. Tapping it in the notebook jumped to the exact passage. |
| 8 | Reopening a book returns to the same position | **Pass** | Survived a full page reload. |
| 9 | Works offline after first load and installs | **Offline: Pass. Install: not tested** | Server stopped: library, EPUB and PDF all opened from the service worker cache. Manifest is Bibliotheca's; install needs checking on the phone. |
| 10 | Highlights export to valid Markdown | **Pass** | Headings per chapter, `>` quotes with colour and page, notes grouped by type. |

**Real book:** your 126-page *The Mom Test* PDF reflowed in under 1 s. The output came to 873 paragraphs and 98 headings, with chapter and section titles found and dialogue with indented commentary joined correctly. This book has no running heads, so there was nothing to strip. The cover page is image-only, so it's listed in the text as skipped.

## Other checks

| Check | Result |
|---|---|
| Scripts inside books are blocked | Pass (CSP blocked the test EPUB's script) |
| Duplicate import detected | Pass (same EPUB dropped twice: second one skipped) |
| Bibliotheca: reading forward logs pages and sets status to Reading | Pass (log and `cur` updated; Bibliotheca showed "Page 10 of 16 · Reading") |
| Bibliotheca: jumps don't log pages | Logic in place (contents, slider, notebook and links are flagged, plus a speed check). Verified in code, not by a dedicated click test. |
| Bibliotheca "Read in Reader" opens the linked book | Pass |
| Unlinked Bibliotheca book asks for its file | Pass |
| PDF Reflow ↔ Page switch keeps the page | Pass (p. 10 → p. 10) |
| TXT chapters detected | Pass (CHAPTER I–IV in contents) |
| Pages-layout edge tap turns the page | Pass |
| Text contrast ≥ 4.5:1 in all themes | Pass (lowest is 4.9:1, the paper accent) |
| Icon-only buttons have labels | Pass (every `.ib` has `aria-label`) |

## To check on your phone

1. Install to the home screen, open a book, and tap full screen. Is the status bar hidden, and does portrait lock hold?
2. Auto-scroll at speeds 1, 4 and 8. Is it smooth? Does putting a finger down hold it and lifting resume it?
3. Select text with your thumb. Does the colour bar sit clear of Chrome's own Copy/Share menu?
4. Read 20 or more pages, go back to Bibliotheca, and check that today's pages went up.
5. Import a large real PDF (100+ pages) and judge the reflow quality. If it's poor, switch to Page mode and tell me which book it was.

## Round 3 (after your feedback)

| Check | Result |
|---|---|
| Messages disappear completely after a few seconds while reading | Pass (opacity 0 / hidden after timeout) |
| No hint or auto-scroll message covering the bar | Pass (both removed; page-turn timing is shown in the bar) |
| PDF Page mode: zoom in, pan left/right/up/down | Pass (zoomed landscape page: 0–210 px sideways scroll, left edge reachable) |
| Pinch zoom in Page mode | Pass (two-finger gesture → 400%) |
| Pinch in a normal book changes text size | Pass (19 → 32 px) |
| Zoom lock keeps the zoom; pinch and −/+ do nothing while locked | Pass |
| Auto-scroll runs with zoom locked | Pass (336 px in 2.5 s at speed 8) |
| Bottom bar fits a 375–393 px phone on one line | Pass |
| Desktop: mouse movement shows controls | Pass |
| Highlights from Reflow don't appear on wrong pages in Page mode | Fixed in code (highlights now remember their layout); not click-tested |
