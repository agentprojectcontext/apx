---
category: Display
---
# CodeFrame

A fenced code block an agent wrote, in a frame: the language in the header, **Copy** and **Expand** as icon buttons named by their tooltips (Expand shows the same view, larger, in a dialog; Esc closes). Code that draws something (an HTML page, a Mermaid diagram) gets a **Preview / Code** switch that starts on the preview.

- `language`: what the header shows ("HTML", "Mermaid", "TypeScript").
- `code`: the text Copy puts on the clipboard.
- `children`: the code as shown (the app passes it highlighted, with line numbers; a plain `<pre>` works too).
- `preview`: what the code draws. The app is responsible for drawing untrusted code safely (a sandboxed frame for HTML).
- `status`: a word beside the language while the block is not finished (the app shows "Writing…" while an agent writes it).
- `title`: what the block is, beside the language (a page's title); it takes the room the bar has left.
- `actions`: more controls after Expand, icon buttons like them (Edit, a ⋯ menu).
- `onExpand`: Expand opens this instead of the dialog (a screen of its own for a page).
- `labels`: `preview`, `source`, `showAs` (the switch's name), `copy`, `copied`, `expand`, `close`; English by default.
- The body scrolls past 420px; the expanded view takes the window's height.

```tsx
<CodeFrame language="HTML" code={html} preview={<iframe sandbox="" srcDoc={html} title="Preview" />}>
  <pre><code>{html}</code></pre>
</CodeFrame>
```
