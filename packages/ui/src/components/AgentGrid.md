---
category: Forms
---
# AgentGrid

Choose one agent from cards in two columns: avatar, name and role, the chosen one outlined. With more agents than
`limit` (6), the rest wait behind a "show all" button; the chosen one always stays in sight. Arrow keys move the
choice, as in a radio group. Use it where the person picks who does a piece of work (a Flow's AI step); a long list
in a dense form takes a `Select` instead.

```tsx
<AgentGrid
  label="Agent of the crew"
  value="max"
  onValueChange={setAgent}
  agents={[
    { id: "roby", name: "Roby", role: "Super-agent", blob: "noche" },
    { id: "max", name: "Max", role: "Marketing & growth", blob: "amatista" },
  ]}
  moreLabel={(n) => `Show all ${n}`}
/>
```
