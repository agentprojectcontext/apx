---
category: Navigation
---
# NavItem

Sidebar row: `icon`, `label`, optional `count` (`attention` turns it into a red counter), `active`, `depth={1}` for a project's sub-sections.

- The v2 sidebar: Home, Inbox, In progress, then projects (avatar `shape="square"` as icon) and loose chats.
- `trailing` adds a right-aligned slot after the count (lock icon, a running dot).
- `collapsed` is the icon-only rail (60px sidebar): label, count and trailing hide, the label becomes the tooltip and a small dot marks a count.

```tsx
<NavItem icon={<Icons.Inbox />} label="Inbox" count={3} attention />
<NavItem icon={<Icons.Inbox />} label="Inbox" count={3} collapsed />
```
