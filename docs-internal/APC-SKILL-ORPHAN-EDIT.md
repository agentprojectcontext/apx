# An orphaned edit to a file APX does not own

Found while cleaning up branches (`feat/routine-id-c1`, now deleted).

That branch carried `skills/apc-context/SKILL.md` with FIVE lines that exist
nowhere else — not in `main`, not on disk, and not in the canonical source.

## Why it cannot simply be added here

`src/core/apc/skill-sync.js` opens with: *"Sync apc-context skill from canonical
APC sources (never owned by APX repo)."* Both copies in this repo —
`skills/apc-context/SKILL.md` and `src/core/runtime-skills/apc-context/SKILL.md`
— are refreshed on `prepack` from, in order: this repo's own copy if it still
looks like the skill, the sibling `../apc/` checkout, then GitHub raw.

The canonical file at `../apc/skills/apc-context/SKILL.md` is 159 lines and does
NOT contain this paragraph. So adding it to APX would be overwritten by the next
sync, and pretending otherwise is how the paragraph got orphaned in the first
place.

**Where it belongs:** the APC repo. Then it flows back here on the next sync.

## The text, verbatim

```markdown
**MCP in an `.apc/` project:** if APX is installed, prefer `apx mcp` over your own built-in MCP
client — APX owns the project's MCP scopes, secrets, and merge order. Run `apx mcp list` to see the
registered servers and `apx mcp run <name> <tool> '{…}'` to call one. Without `.apc/` (or when APX
is not installed), keep using your internal MCP.

Never use APX to write secrets or raw sessions into `.apc/`.
```

Recovered from `feat/routine-id-c1:skills/apc-context/SKILL.md` (branch deleted
after this note was written — the content is here, not lost).
