---
category: Display
---
# MarkdownView

Renders the Markdown agents write: paragraphs and line breaks, `#` headings, `-`/`1.` lists, `>` quotes, fenced code blocks, inline `code`, **bold**, *italic*, `[links](https://…)`, bare URLs and pipe tables with alignment and escaped pipes.

- Safe by construction: builds React elements (no raw HTML); links only for `http(s):`/`mailto:` and open in a new tab with `noopener`.
- Tables allow up to 64 columns and 10,000 rendered cells across one document; additional content remains visible as text.
- `renderLink(href, link, key)`: wraps each ready `<a>` (a right-click menu with where to open it, for instance).
- `renderCode(code, lang, pre, key)`: wraps each fenced block; `lang` is the fence's word (```` ```bash ```` → `bash`), so an app can add a run button to shell blocks.
- `renderCodeSpan(text, code, key)`: replaces an inline `code` span, so an app can show an id it knows (a task) as a link to it.
- `renderQuote(quote, key)`: wraps each quote, so an app can add a copy button to a draft the agent wrote (the rendered quote's `innerText` is its words without the marks).
- Put it inside a `Message` bubble for agent text, or alone for files and memory. `size="sm"` for compact panels.

```tsx
<Message from="agent"><MarkdownView source={"Done. I reviewed **3 PRs**:\n- `acme/app#52`\n- `acme/app#53`"} /></Message>
```
