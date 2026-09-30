---
category: Chat
---
# Message

One chat message. `from="agent"` (left, soft bubble) or `from="user"` (right, ink bubble in minimal / green bubble in classic).

- Put paragraphs as `<p>` children. Rich bodies (StepList, VoiceNote) go inside the bubble; things with their own surface (EntityCard, images) use `variant="bare"`.
- `meta` renders under the bubble (MessageMeta); `reactions` pins an emoji to the corner; `grouped` tightens consecutive messages; `avatar` optional (classic shows it).
- Tool calls between messages go in an ActionGroup, events in a SystemNote.

```tsx
<Message from="user" reactions="👍">The top 10 look good. Send it.</Message>
```
