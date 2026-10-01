---
category: Identity
---
# ProjectTile

A letter, icon or logo on a soft tone. Projects in the sidebar (20) and the project header (36), channels and apps (icon tile), external runtimes (`tone="ink"`, `shape="circle"`).

- `tone`: `brand | violet | info | warning | danger` (soft pair), `ink` (accent pair) or `neutral`.
- Radius follows the size (20 → 6px, 36 → 10px). Icons scale with the tile; pass them at ~60% of the size.
- Agents are never tiles: use AgentAvatar.

```tsx
<ProjectTile tone="violet" initial="A" />
<ProjectTile tone="info" icon={<Icons.Send size={12} />} />
<ProjectTile tone="ink" shape="circle" icon={<Icons.Code size={12} />} />
```
