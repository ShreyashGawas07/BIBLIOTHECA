# Security

Bibliotheca opens files from anywhere, so security matters even though there's no server.

## What it protects against

- **Scripts inside books.** EPUBs can contain JavaScript. The reader's Content-Security-Policy (`reader/index.html`) blocks every script that isn't the app's own, including inside book pages.
- **Data leaving the device.** Books, highlights and notes are stored in IndexedDB and never sent anywhere.
- **DRM.** The reader detects protected books and refuses to open them. It does not, and will not, remove DRM.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead, use GitHub's [private vulnerability reporting](https://github.com/ShreyashGawas07/BIBLIOTHECA/security/advisories/new) for this repository, or contact the maintainer through their GitHub profile.

Include:
- what you found and its impact
- steps to reproduce (a small crafted file is perfect)
- the browser and device

You'll get a reply as soon as possible. Once there's a fix, you'll be credited in the release notes unless you'd rather not be.
