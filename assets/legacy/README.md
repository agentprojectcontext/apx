# Legacy assets

Superseded files kept for reference. Nothing here is built, served or published.

| File | What it was | Superseded by |
|---|---|---|
| `landing-v1.html` | An earlier standalone landing page, at the repo root as `index.html`. Nothing referenced it — `.github/workflows/pages.yml` publishes `landing.html` as the site index. For months that workflow's own comment described this file as "the web-admin SPA, which Vite needs there"; both halves were false, and the real SPA entry is `src/interfaces/web/index.html`. | [`../../landing.html`](../../landing.html) |

Moved rather than deleted: it is a complete design worth reading before the next
landing rewrite. If it goes stale enough to mislead, delete it — a wrong
reference is worse than no reference.
