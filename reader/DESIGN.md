# Reader: design notes

## Decisions

- **One renderer for every format.** We don't convert everything to PDF, because PDF pages are fixed and paper-sized, which is the problem we're solving. EPUB, MOBI, AZW3, FB2, TXT, HTML and reflowed PDF all become HTML sections inside the same foliate-js renderer. Every book gets the same fonts, themes, auto-scroll and highlighting.
- **Inside Bibliotheca (option B).** One installed app on Android, served from the same origin, so the reader can update Bibliotheca's `mybooks.v1` directly. No database or server is needed.
- **No build step.** Plain ES modules with JSDoc, in the same spirit as Bibliotheca's single HTML file. The vendored libraries are pinned (see `vendor/foliate/VERSION.txt`).
- **Look:** Bibliotheca's paper and ink, Instrument Serif for titles, IBM Plex Mono for labels, and Literata for reading. The one accent colour is Bibliotheca's green rather than the teal in the original brief, so the two apps feel like one.

## Structure

```
Bibliotheca (index.html)  ──"Read in Reader"──▶  reader/#/open?bib=<id>
        ▲                                               │
        │ mybooks.v1 (localStorage)                     ▼
        └──────────── bridge.js ◀── reader.js ── foliate-view (iframe per section)
                                        │
                                        ├─ highlights.js ─┐
                                        ├─ notes.js ──────┼─▶ db.js (IndexedDB)
                                        └─ pdf-reflow.js ─┘    books · files · reflow · highlights · notes
```

`bridge.js` is the only code that touches Bibliotheca's data. Before every write it re-reads the latest data. Bibliotheca reloads its data when you return to it (`visibilitychange`, `storage`, `pageshow`), so neither app overwrites the other.

## Reading screen

- **Default view:** text only. The page background runs edge to edge, and the content sits clear of the camera notch.
- **Tap the centre** to show the controls:
  - **Top pill:** back · title and chapter · contents · notebook · Aa (settings)
  - **Bottom bar:** progress slider with % and page number · auto-scroll (− ▶ +, speed 1–8) · full screen
  - Controls fade after 3 s. A sheet that's open, or the slider being dragged, keeps them up.
- **Pages layout:** tapping the left or right quarter of the screen turns the page.
- **Scroll layout:**
  - Swiping past the end of a chapter continues into the next one; swiping past the top goes back.
  - Auto-scroll moves the text smoothly. A finger on the screen holds it, and it resumes 1.4 s after you lift.
- **Selecting text** brings up a bar at the bottom, above the thumb and away from Chrome's own menu: four colours · style · note · copy. Tapping a colour saves the highlight.
- **Panels:** sheets open from the bottom on a phone and as side drawers on wide screens. They're built on `<dialog>`, so focus trapping and Esc come for free.

## PDF reflow pipeline

1. PDF.js extracts text items per page; parsing happens in PDF.js's own Web Worker.
2. Items are grouped into lines by baseline. A page counts as two-column when almost no text crosses the middle and both halves hold text; left-column lines are then read before right-column lines.
3. **Furniture removal:** small lines repeated at the top or bottom edge are running heads, and edge lines that look like page numbers (`12`, `xii`, `Page 3 of 90`) are folios. Both are removed. Large repeated lines are kept, because they're chapter titles.
4. **Paragraphs:** a new paragraph starts on a larger vertical gap or a first-line indent. When the PDF doesn't use indents, a short line ending a sentence also starts one. Words hyphenated across lines are rejoined. Paragraphs carry on across page breaks.
5. Lines in a noticeably larger font become headings.
6. **Sections and contents:** sections follow the PDF outline (or chunks of about 12 pages), and the contents list comes from the outline. Invisible page markers (`#pgN`) keep real page numbers available for highlights, Bibliotheca, and switching to Page mode.
7. The result is cached in IndexedDB, so the work happens only on the first open.

## Assumptions

1. You read on Android in current Chrome.
2. Books are DRM-free files you own.
3. Importing a book with no matching title in Bibliotheca creates a *Want* entry there, so its pages can be counted.
4. "Pages read" for formats without fixed pages is your position mapped onto the page total set in Bibliotheca.
5. Notes are plain text with optional `-` lists. No rich text editor.
6. Default reading settings: Literata 19 px, line spacing 1.65, left-aligned, Scroll layout, theme follows the system.

## Open questions for you

1. Should importing a book auto-create a Bibliotheca entry (current behaviour), or should that only happen when you tap "Read in Reader" from Bibliotheca?
2. Should jumping straight to the last page (for example to check the ending) be allowed to mark a book *Finished*? It currently isn't.
3. Is the default reading font and size right for you, or would you prefer bigger text or a sans font?

## Suggested next steps (not built)

- Search inside a book (foliate-js already supports it).
- Exporting highlights and notes for all books at once.
- Reading time per session shown in Bibliotheca's ledger.
- Optional Supabase sync between devices. This is the only feature that would need a database.
