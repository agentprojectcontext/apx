# design-sync notes — @apx/ui

- Claude Design project: "APX UI" (`adfa91bc-fe19-4d97-a98e-d968b4457ebe`), first synced 2026-09-30 with 38 components, all authored and graded good. Re-syncs take the atomic path: fetch `_ds_sync.json` into `.design-sync/.cache/remote-sync.json`, then run `resync.mjs --remote …`.

- Config home is `apx-v2/packages/ui` (the DS package itself). Run everything from there.
- Build: `node scripts/build.mjs` (esbuild ESM + `tsc --emitDeclarationOnly` + concat CSS → `dist/styles.css`). `pnpm --filter @apx/ui build` from `apx-v2/` does the same.
- Converter: `--node-modules ./node_modules --entry ./dist/index.js`. Playwright is pinned to 1.60.0 in `.ds-sync/` because the cached chromium is build 1223.
- `node_modules/.bin/esbuild` shim is broken under pnpm 11 (native binary run through node); use the JS API (`scripts/build.mjs`, `playground/build.mjs`).
- Blob catalog (`src/blobs/catalog.ts`) is generated from APX v1 by `node scripts/export-blobs.mjs` (needs `cwebp`). 35 blobs, 128px webp data-URIs, ~143 KB.
- Looks: every preview has a `ClassicLook` cell wrapped in a nested `<ApxProvider look="classic" mode="dark" fill>`. The nested provider needs `fill` or the dark tokens land on a white background.
- Dialog preview: the dialog is `position: fixed`, so the preview wraps it in a provider with `transform: translateZ(0)` (a containing block) and uses `cardMode: single` (the grid-overflow check can't see the containment).
- `.d.ts` extraction drops inherited DOM props; Button/IconButton/Input/Textarea redeclare `onClick`/`disabled`/`value`/… explicitly so they survive.
- `Icons` is exported as an object of lucide components; the converter treats it as a compound namespace (`Icons.Search`). That's expected.
- Preview content uses generic names only (Acme, Northwind, Globex, Roby, Ledger, Scout…). Never real client/project names.

## Pending re-sync
- AgentAvatar's eye canvas now keeps its full size inside icon buttons; re-sync the shared CSS bundle.
- Meter is new (single or stacked bar with a legend) and the icon set gained Gauge, Cpu, HardDrive and MemoryStick:
  neither is in the Claude Design project yet.
- MarkdownView now renders safe pipe tables; its remote preview and bundle need a re-sync.
- Lint fixes (DECISIONS.md#d-005) changed markup in Avatar, AgentAvatar, Checkbox, Switch, SegmentedControl (now a
  Base UI RadioGroup), DayDivider, VoiceNote and the list keys of ActionGroup/StepList/EntityCard/Menu/Kbd/
  AvatarStack/MessageMeta. Pixel-identical in all four looks, same public API; the remote bundle is just stale.
- The EntityCard preview's sample name was replaced with "Northwind"; the Claude Design copy keeps the old text until
  re-synced. Delete this section after the next re-sync.

## Known render warns
- none outstanding (Dialog handled by `cardMode: single`).

## Re-sync risks
- Blob images are baked from APX v1's `public/modules/blobs`; if v1 adds or changes blobs, re-run `scripts/export-blobs.mjs`.
- Playwright pin (1.60.0 ↔ chromium-1223) depends on this machine's cache.
- Fonts are system stacks (no webfont shipped). If a brand font is adopted, wire it via `extraFonts`.
