---
category: Chat
---
# ActionGroup

Folds an agent's tool calls into one line that expands: "16 steps · 2 min 10 s · 2 failed", "Working · step 3 ▸". Keeps the thread calm — never list raw tool calls in bubbles.

- `items`: `{ name, icon, detail, status, aside }` → what it did in words ("Opened acme.com", never a tool id), the icon
  of its kind of action, a one-line detail, a duration. The steps hang from the header's chevron as a tree
  (`apx-tree`). Only a failed step is marked (icon and words in red); a running one spins; without an icon a
  status glyph shows.
- `icon`: the header's leading icon (a wrench by default); `null` leaves the chevron alone.
- `failed` + `failedLabel` shows the failure count in red; `children` replaces the list (reasoning text, a diff).
- Inline on the page in both looks: no fill, no box; the header is plain muted text that lights up on hover.

```tsx
<ActionGroup title="4 steps · 12 s" icon={null} failed={1} items={[
  { name: "Searched the web for “prices 2026”", icon: <Icons.Globe /> },
  { name: "Read pricing.md", icon: <Icons.FileText /> },
  { name: "Opened linkedin.com", icon: <Icons.Globe />, status: "failed" },
  { name: "Memory saved", icon: <Icons.Brain /> },
]} />
```

## Tree

`apx-tree` on a list (or on the block a line unfolds into) hangs each of its children from one line under the
chevron, each joined by an elbow curving into its middle: a turn's steps, a note's words, the parts of a session or a
routine's run. `--apx-tree-mid` (13px, half a 26px row) is where a child's elbow lands.

## Branches

`apx-branches` on a list hangs its rows from one vertical line whose end curves into the last row's middle (an agent's
chats in the inbox, a turn's steps). The list leaves `--apx-branch-gap` (11px) of room on its left;
`--apx-branch-mid` (15px) is the last row's middle.
