---
category: Chat
---
# StickyScroll

A conversation's scroll area. It stays at the end while the reader is there (new messages, and images or widgets
that grow after they load), leaves them where they are once they scroll up, and floats a button back to the latest
message. The button's trip goes on to the end if the chat grows on the way, unless the reader scrolls up again. A new
`resetKey` (another chat) jumps to the end.

```tsx
<StickyScroll resetKey={thread.id} toBottomLabel="Back to the latest message" className="chat__scroll">
  {rows}
</StickyScroll>
```

The `ref` handle gives the content element (to find a row) and `release()`, which stops following until the reader
comes back to the end: call it before scrolling to an older message.
