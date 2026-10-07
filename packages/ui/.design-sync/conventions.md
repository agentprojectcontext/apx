# APX design system (@apx/ui) — how to build with it

## 1. Always wrap in `ApxProvider`
Every component reads `--apx-*` CSS variables that only exist under a provider. Without it, colors, radii and fonts fall back to browser defaults.

```tsx
const { ApxProvider, Composer } = window.ApxUI;
<ApxProvider look="minimal" mode="light" fill>{/* screen */}</ApxProvider>
```

- `look="minimal"` (default, APX v2): warm greys, **ink** primary (near-black), pill controls, borderless bubbles.
- `look="classic"` (APX v1): **APX green** primary/selection, bordered groups, mono metadata, UPPERCASE role tags, 8–12px radii. Classic is normally used with `mode="dark"`.
- `mode="light" | "dark"` for either look. `fill` paints `--apx-bg` and fills the parent height (use it on the root).
- Nest a second `ApxProvider` to render a region in another look/mode. Menus, tooltips and dialogs portal into the nearest provider, so they keep its look.
- The look is a token swap, never different markup. Don't restyle components per look by hand.

## 2. Styling idiom: tokens, not classes
Components are styled; you only write layout glue (flex/grid, gaps, widths) with inline styles or your own CSS, using tokens:
- Surfaces: `--apx-bg` (page), `--apx-sidebar`, `--apx-surface` (panels), `--apx-surface-raised`, `--apx-fill` / `--apx-fill-hover` / `--apx-fill-strong` (soft fills), `--apx-popup-hover` (a hovered row in a menu or popup; set only in dark, falls back to `--apx-fill`), `--apx-border`, `--apx-border-strong`.
- Text: `--apx-fg`, `--apx-fg-muted`, `--apx-fg-subtle`.
- Accent: `--apx-accent` / `--apx-accent-fg` (primary action), `--apx-brand` (APX green, both looks), `--apx-selection`.
- Tones: `--apx-{brand|violet|info|warning|danger}` plus `-soft` and `-soft-fg` variants.
- Shape and type: `--apx-radius-{sm|md|lg|xl|pill}`, `--apx-space-{1..8}` (4px steps), `--apx-text-{2xs|xs|sm|md|lg|xl|2xl}`, `--apx-font-sans`, `--apx-font-mono`, `--apx-shadow-{sm|md}`.

Never hard-code hex colors. Never use `apx-*` class names from the stylesheet directly; use the components.

## 3. Where the truth lives
- `styles.css`, which imports the component stylesheet (tokens for all 4 look×mode combos are at its top).
- Each component's `.prompt.md` (purpose, when to use it and when not, look differences, example) and `.d.ts` (props).

## 4. Composition rules (APX product language)
- Agents are always shown with `AgentAvatar` (APX blobs, `blob="noche" | "menta" | "amatista" | …`, see `BLOB_NAMES`). People and projects use `Avatar`.
- Chat thread: `Message` (agent left, user right) · tool calls folded in `ActionGroup` · events in `SystemNote` with `AgentChip` · run reports as `StepList` inside a Message · drafts/tasks/routines as `EntityCard` inside `<Message variant="bare">` · live agent-to-agent work as `ActivityPill` · `Composer` at the bottom (pill on mobile/minimal, `toolbar` box on desktop/classic).
- Sidebar: `SearchField` → `NavItem`s (Home, Inbox, In progress) → `SectionLabel` + project `NavItem`s → `ConversationRow`s.
- One `Button variant="primary"` per view/card; secondary next to it. Icon-only actions use `IconButton` with a `label`.
- Icons: `Icons.<Name>` (curated lucide set), 14–18px.
- Calm by default: few borders, generous spacing, no decorative animation (blobs are the exception).

## 5. Example
```tsx
const { ApxProvider, Message, StepList, ActionGroup, SystemNote, AgentChip, Composer, Icons } = window.ApxUI;
<ApxProvider look="minimal" mode="light" fill>
  <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, margin: "0 auto", padding: "var(--apx-space-4)" }}>
    <div style={{ flex: 1, overflow: "auto" }}>
      <Message><StepList steps={[{ label: "CRM", detail: "list pulled · 52 accounts" }, { label: "Sequencer", detail: "36 drafts queued", status: "running" }]} /></Message>
      <ActionGroup title="Actions 1–10 of 16" failed={2} items={[{ name: "crm.query", detail: "accounts where tier = A", aside: "0.8s" }]} />
      <SystemNote icon={<Icons.Clock size={14} />}>Updated memory for <AgentChip name="Ledger" blob="amatista" /></SystemNote>
      <Message from="user">The top 10 look good. Send it.</Message>
    </div>
    <Composer placeholder="Message Outbound" onAttach={() => {}} />
  </div>
</ApxProvider>
```
