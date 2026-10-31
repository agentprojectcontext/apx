---
category: Chat
---
# ActionGroup

Folds an agent's tool calls into one line that expands: "16 steps · 2 min 10 s · 2 failed", "Working · step 3 ▸". Keeps the thread calm — never list raw tool calls in bubbles.

- `items`: `{ name, detail, status, aside }` → mono tool name, one-line detail, status glyph, duration.
- `failed` + `failedLabel` shows the failure count in red; `children` replaces the list (reasoning text, a diff).
- Borderless fill in minimal, bordered box in classic.

```tsx
<ActionGroup title="16 steps · 2 min 10 s" failed={2} items={[
  { name: "crm.query", detail: "accounts where tier = A", aside: "0.8s" },
  { name: "browser.open", detail: "linkedin.com/in/…", status: "failed", aside: "timeout" },
]} />
```
