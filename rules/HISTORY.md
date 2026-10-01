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

## Embedded browser

<a id="cdp-attach-after-load"></a>
### CDP attaches after the first load, and every capture is bounded
**Rule:** `cdp.attach()` runs after the tab's first `loadURL`; screenshots time out and fall back to `capturePage`;
navigation resolves at `dom-ready`.
**Why:** enabling CDP domains on a tab without a renderer never answers; `Page.captureScreenshot` never answers
while the window is not painting; waiting for full `load` timed out on ad-heavy sites. Each hung a tool call.
**Where:** `apps/desktop/src/main/browser/host.ts` (`open`, `#load`), `apps/desktop/src/main/browser/cdp.ts` (`screenshot`).

## Agent engine

<a id="system-notes-as-user"></a>
### Mid-turn notes go to the model as tagged user items
Notes from APX to the model during a turn (answer cut off, stuck, out of steps, interrupted) are sent as
`<system_note>` user items, after all the results of a tool step. Some providers fold every `system` item into the
system prompt, which reorders the conversation and breaks the cached prefix; and a note between a tool call and
its results breaks the pairing every provider requires. Where: `apps/core/src/harness/native.ts`.

<a id="live-display"></a>
### Updates to an answer still being written go through its display
A delegation's card lives in the caller's answer while the caller's turn may still be writing that message. Writing
the card straight to the store was overwritten by the next display update (the card stayed "working"). The engine
keeps the live `Display` of a run that delegated and updates the card through it. Where: `engine/engine.ts`.

<a id="isolated-world-result"></a>
### `executeJavaScriptInIsolatedWorld` resolves to the value, not to an array
`browser.text` destructured the result as `[full]`, so it returned the first character of the page ("T"). Electron
resolves to the script's value. Where: `apps/desktop/src/main/browser/host.ts`.

<a id="gemini-quota-per-model"></a>
### Gemini's 429 "quota" is per model
Google answers 429 "You exceeded your current quota" when one model's limit is hit; the next model of the same
key still works. The gateway skips only that model on `quota` (auth and bad requests skip the provider).
Where: `apps/core/src/providers/llm.ts`.

<a id="claude-tool-schema"></a>
### Claude Code gets the tools' real schema, not a hand-made copy
The Claude harness rebuilt each tool's zod shape from JSON Schema by hand and turned every array into a string. The
Agent SDK then made Claude send `options: "red, blue"`, our own check refused it twice, and the agent gave up on the
option buttons. The shape now comes from `z.fromJSONSchema` of the same schema the tool defines.
Where: `apps/core/src/harness/claude.ts`.

<a id="shell-classifier"></a>
### A "reading" shell command is judged only when it is a simple one
The first classifier split commands on `&& || ; |` and trusted a list of programs: a newline, a single `&`,
`find -execdir`, `sort -o`, `git branch -D` or a path like `~/.ssh` slipped through as read-only. Now only simple
commands of reading programs with plain, project-local arguments run without asking; any other shell syntax,
quoting, variable assignment or outside path asks; destructive checks also run on a quote- and escape-free copy.
Commands get an environment without credential-looking variables, cannot name APX's home, and any command that
reaches APX's own API always asks. Where: `apps/core/src/tools/shell.ts`, `harness/env.ts`.

<a id="policy-follows-thread"></a>
### Inherited permissions follow the thread, not the run
Permissions inherited by a delegated agent were read from the run's `parent_run_id`. Turns that start later in the
same sub-thread (a finished background job, an answer after a restart, a delegation result) have no parent run, so
they ran with the agent's own, looser policy and a reset depth. Callers and depth now come from the thread's
ancestors. Where: `apps/core/src/engine/ancestry.ts`.
