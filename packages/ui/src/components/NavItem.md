---
category: Navigation
---
# NavItem

Sidebar row: `icon`, `label`, optional `count` (`attention` turns it into a red counter), `active`, `depth={1}` for a project's sub-sections.

- The v2 sidebar: Home, Inbox, In progress, then projects (avatar `shape="square"` as icon) and loose chats.

```tsx
<NavItem icon={<Icons.Inbox />} label="Inbox" count={3} attention />
```
