# History

The long *why* behind rules the code enforces: quirks, fixes and workarounds that someone could undo by
"simplifying". Not a changelog. Each entry: **Rule**, **Why**, **Where**; code points here with
`See HISTORY.md#<anchor>`.

## Runtime

<a id="workspace-ts-stripping"></a>
### Workspace packages ship `.ts` and resolve through symlinks
**Rule:** internal packages export `./src/*.ts` directly; keep them as pnpm workspace links.
**Why:** Node refuses to strip types for files under `node_modules`. pnpm links resolve to the real path under
`packages/`, so stripping works. Publishing or copying a package into `node_modules` would break it — add a build
first.
**Where:** `packages/protocol/package.json` (`exports`), `apps/*/package.json` (`workspace:*`).

## Repo hygiene

<a id="private-terms"></a>
### `check:private` scans untracked files too
**Rule:** the gate scans tracked **and** untracked-not-ignored files.
**Why:** leaks must be caught before the first `git add`; in v1 real names reached the public history through
fixtures and previews. On its first run in v2 it caught a real name in a design-system preview.
**Where:** `scripts/check-private-terms.ts`.
