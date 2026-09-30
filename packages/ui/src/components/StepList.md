---
category: Chat
---
# StepList

Compact run report inside a message: one line per integration/step — **label** → detail — with a status glyph.

```tsx
<Message><StepList steps={[{ label: "CRM", detail: "list pulled · 52 accounts" }, { label: "Sequencer", detail: "36 drafts queued", status: "running" }]} /></Message>
```
