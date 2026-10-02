---
category: Identity
---
# AgentNode

An agent as a card on the Team canvas (232 × 184): avatar, name and slug, role (or the crowned lead badge), two lines
of description, counters (chats, open tasks, routines), and a footer with "View", "Chat" and the engine chip.

- `status`: `running` pulses a ring around the avatar; `waiting` adds an amber dot (it waits for the owner).
- `selected` rings the card in brand; `dimmed` fades it while another branch is highlighted.
- The whole card opens the agent (`onOpen`); "Chat" calls `onChat`. `onHover` lets the canvas light the branch.

```tsx
<AgentNode
  name="Scout"
  slug="scout"
  role="Research"
  description="Finds sources and writes a short brief."
  engine="claude"
  engineLabel="claude"
  stats={[{ icon: <Icons.MessageSquare />, value: 4, label: "Chats" }]}
  viewLabel="View"
  chatLabel="Chat"
/>
```
