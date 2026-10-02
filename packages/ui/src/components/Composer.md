---
category: Chat
---
# Composer

The chat input. Enter sends, Shift+Enter adds a line, Ctrl/⌘+Enter sends with `{ queue: true }`, auto-grows.
`sendHint` is the send button's tooltip (explain the shortcuts there).

- **Pill** (no `toolbar`): `+` · text · mic, mic becomes send when there is text — the minimal/mobile input.
- **Box** (`toolbar` given): text on top, controls row below (`+`, model/mode Buttons as `variant="ghost" size="sm"`, mic/send at the end); `header` adds a strip above (context usage, attachments) — the classic desktop input.
- `busy` swaps send for stop while the agent answers.
- Without `onVoice` the send button stays (disabled while empty): put your own mic in the toolbar. `ready` lets send
  work with an empty field (attachments waiting).
- `labels` overrides the icon buttons' accessible names (`attach`, `stop`, `send`, `voice`; English by default).

```tsx
<Composer placeholder="Message Roby" onAttach={() => {}} />
```
