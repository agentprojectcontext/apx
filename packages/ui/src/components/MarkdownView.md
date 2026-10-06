---
category: Display
---
# MarkdownView

Renders the Markdown agents write: paragraphs and line breaks, `#` headings, `-`/`1.` lists, fenced code blocks, inline `code`, **bold**, *italic*, `[links](https://…)` and bare URLs.

- Safe by construction: builds React elements (no raw HTML); links only for `http(s):`/`mailto:` and open in a new tab with `noopener`.
- `renderLink(href, link, key)`: wraps each ready `<a>` (a right-click menu with where to open it, for instance).
- Put it inside a `Message` bubble for agent text, or alone for files and memory. `size="sm"` for compact panels.

```tsx
<Message from="agent"><MarkdownView source={"Done. I reviewed **3 PRs**:\n- `acme/app#52`\n- `acme/app#53`"} /></Message>
```
