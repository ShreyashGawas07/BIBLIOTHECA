# Third-party notices

Bibliotheca's own code is MIT-licensed (see [LICENSE](LICENSE)). It ships these third-party works, each under its own license. Their license files are kept next to the code.

| Component | Where | License | License file |
|---|---|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js) (commit `78914ae`), with small local patches marked `local patch` | `reader/vendor/foliate/` | MIT | [`reader/vendor/foliate/LICENSE`](reader/vendor/foliate/LICENSE) |
| [zip.js](https://github.com/gildas-lormeau/zip.js) and [fflate](https://github.com/101arrowz/fflate), bundled by foliate-js | `reader/vendor/foliate/vendor/` | BSD-3-Clause / MIT | [`LICENSE-zip.js.txt`](reader/vendor/foliate/vendor/LICENSE-zip.js.txt), [`LICENSE-fflate.txt`](reader/vendor/foliate/vendor/LICENSE-fflate.txt) |
| [PDF.js](https://github.com/mozilla/pdf.js) v5.5.207, with cMaps and standard fonts | `reader/vendor/foliate/vendor/pdfjs/` | Apache-2.0 | [`reader/vendor/foliate/vendor/pdfjs/LICENSE`](reader/vendor/foliate/vendor/pdfjs/LICENSE) |
| [Literata](https://github.com/googlefonts/literata) | `reader/fonts/literata*.woff2` | SIL OFL 1.1 | [`reader/fonts/OFL-literata.txt`](reader/fonts/OFL-literata.txt) |
| [Instrument Serif](https://github.com/Instrument/instrument-serif) | `reader/fonts/instrument-serif*.woff2` | SIL OFL 1.1 | [`reader/fonts/OFL-instrumentserif.txt`](reader/fonts/OFL-instrumentserif.txt) |
| [IBM Plex Mono](https://github.com/IBM/plex) | `reader/fonts/plex-mono-*.woff2` | SIL OFL 1.1 | [`reader/fonts/OFL-ibmplexmono.txt`](reader/fonts/OFL-ibmplexmono.txt) |

The fonts are the unmodified Latin subsets served by Google Fonts, self-hosted so the app works offline.
