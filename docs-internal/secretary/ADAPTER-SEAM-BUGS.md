# The adapter seam: nine bugs, one cause

Nine bugs surfaced during this work. **Every one was found by hand against a live daemon.
Not one was caught by the test suite**, which was green throughout.

That is not luck, and it is not a gap in diligence. It is structural.

## The cause

AGENTS.md rule 8 puts domain logic in `core/` and makes the API and CLI thin adapters. The
tests follow that rule faithfully — they call `core/` directly, which is fast, hermetic and
correct. Playwright covers the web surface.

    surface (CLI / web)  →  adapter (api/*.js)  →  core (stores, agent, …)
                          ▲
                          └── covered by nothing

So the two layers are each well tested, and the **wire between them** is not. Six of the
nine bugs live exactly there. The two worst are pure seam bugs:

- the CLI treating a `{meta,data}` envelope as an array — core was right, the route was
  right, the two disagreed about shape;
- `/inbox` colliding with `isApiPath` — the route worked, the screen worked, and the
  routing table put one in front of the other.

A test that calls `listTasks()` cannot see either. Both are invisible until something
speaks HTTP.

## The nine

| # | Bug | Layer | Impact | What would have caught it |
|---|---|---|---|---|
| 1 | `upsertRoutine()` never wrote an `id`, so every routine shared `routines/_unknown/memory.md` | core | Each routine read the others' notes as its own | A core test — this one was findable, and is now covered |
| 2 | `apx task list` printed "(no tasks)" always: the endpoint answers `{meta,data}`, the CLI read an array | **seam** | The command was entirely broken | Smoke: envelope shape |
| 3 | `parseConversation` truncated every multi-line turn to its first line (`$` under `/m`) | core | Panel thread view and previews both cut | A core test with multi-line input |
| 4 | Pages deploy failed on every docs change — `pnpm install` in `docs/` installed the root project | CI | Docs site never republished | CI running on a PR, or a smoke build |
| 5 | Profile config mirror went stale on `off`/`uninstall` | core | `config.json` read as though something were active | A core round-trip test |
| 6 | Prompt budget only ever checked English | core | A translation could ship over budget for exactly its readers | A core test per language |
| 7 | Neutral fallback was English-only and followed the *requested* language, not the resolved file | core | "You are le responsable's chief of staff" | A core test per language |
| 8 | `apx panel share` bound only the LAN address, dropping loopback | **seam** | CLI, desktop and `/admin/web-token` all died; `apx restart` could not recover | Smoke: loopback reachable after a config change |
| 9 | `apx routine memory` broken — `GET /projects` never sent `apx_id` / `storage_path` | **seam** | The command failed before doing anything; C1's own acceptance criterion was untestable | Smoke: required fields present |

Bug 9 is the sharpest illustration. C1 was *specifically* the work that made per-routine
memory possible, its acceptance criterion was "`apx routine memory show <name>` returns the
right memory", and the command could not run at all — because a different layer omitted two
fields. The core test passed. The feature did not exist.

## The response

`tests/smoke/seam.smoke.js` — a thin layer that boots a real daemon on a temp `HOME` and a
spare port, and asserts **contracts, not behaviour**:

- every API route refuses an unauthenticated request;
- list endpoints answer the envelope callers unwrap;
- the fields each surface reads are still sent;
- API paths and SPA routes do not overlap in either direction;
- filters the surfaces send are honoured, not silently dropped;
- **every top-level route prefix is declared in `API_PREFIXES`** — derived from the route
  registrations rather than trusting the list, because that list drifts by omission.

The last one paid for itself immediately: it found five undeclared prefixes (`/tasks`,
`/agents`, `/plugins`, `/previews`, `/embeddings`), all pre-existing. An unknown path under
any of them answered with SPA HTML instead of JSON.

### Cost

**0.65 seconds**, daemon boot included. The budget was a minute. A suite nobody runs
protects nothing, so this has to stay closer to a second than to a minute — if it ever
creeps past ~10s, cut tests rather than accept it.

### Where it runs

**Not in `preflight`.** Preflight must work offline with no daemon, and these need a live
process; coupling them would make the common path slower and more fragile for a category of
bug that lands rarely. It belongs:

- as its own CI job, in parallel with preflight;
- run locally before merging anything that touches an `api/*.js` route or a CLI reader.

Run with:

```bash
npm run smoke:seam
```

## The rule worth keeping

> If a surface reads a field, something must assert the adapter still sends it.

Everything above is a variation on that one sentence.

## What this does not solve

Smoke tests confirm the contract holds; they cannot tell you the contract is *right*. Bugs
3, 6 and 7 were core bugs that better core tests would have caught — the answer there is
simply to test the awkward input (multi-line, non-English, unset), not to add layers.

And the deeper habit is the one that actually found all nine: **run the thing against a
live daemon before calling it done.** The smoke layer makes a slice of that automatic. It
does not replace it.
