# 005 — Web panel UI: no Radix-based libraries

**Date**: 2026-05-27
**Status**: accepted

## Context

The web admin panel under `src/interfaces/web/` needs a component library. The de-facto choice these days is `shadcn/ui`, which is built on top of Radix primitives. The user wants to avoid Radix.

Reasons to consider avoiding Radix:
- Heavy DOM footprint for dialogs/menus.
- Refactor friction when Radix releases breaking changes.
- The APX panel doesn't need complex accessibility primitives that justify Radix — it's a local admin tool, not a public app.

## Decision

The web panel uses a non-Radix component stack:

- **React + Vite + TypeScript** (no Next.js — local-first admin doesn't need SSR).
- **Tailwind CSS** for styling.
- **Components**: hand-rolled primitives + minimal vendored components. Where a primitive is non-trivial (combobox, dropdown, dialog focus trap), use one of:
  - **HeroUI** (formerly NextUI, built on React Aria) — quality high, footprint moderate.
  - **Park UI** (Ark UI primitives, no Radix) — closer to shadcn aesthetic without Radix.
  - **Mantine** (no Radix, batteries-included) — overkill but possible.

Final pick will be made when the migration starts and we know what components we actually need. Recorded here so we don't reflexively reach for `npx shadcn add` and pull Radix in.

## Out of scope

- A full UI design system. The panel is a settings + status console, not a product surface.
- Theme switching, animations, exotic layouts. Default Tailwind dark theme is enough.

## Consequences

- One extra decision moment when starting the panel (pick HeroUI vs Park UI vs hand-rolled).
- Components are not portable from shadcn's catalog without rewriting.
- If we ever publish the panel publicly and need stronger accessibility audits, revisit.

## Supersedes / superseded by

None.
