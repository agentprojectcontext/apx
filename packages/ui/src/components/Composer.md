---
category: Chat
---
# Composer

The chat input. Enter sends, Shift+Enter adds a line, auto-grows.

- **Pill** (no `toolbar`): `+` · text · mic, mic becomes send when there is text — the minimal/mobile input.
- **Box** (`toolbar` given): text on top, controls row below (`+`, model/mode Buttons as `variant="ghost" size="sm"`, mic/send at the end); `header` adds a strip above (context usage, attachments) — the classic desktop input.
- `busy` swaps send for stop while the agent answers.

```tsx
<Composer placeholder="Message Roby" onAttach={() => {}} />
```
