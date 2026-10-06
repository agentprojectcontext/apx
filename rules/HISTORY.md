# History

The long *why* behind rules the code enforces: quirks, fixes and workarounds that someone could undo by
"simplifying". Not a changelog. Each entry: **Rule**, **Why**, **Where**; code points here with
`See HISTORY.md#<anchor>`.

## Runtime

<a id="connection-attempt-timeout"></a>
### Give dual-stack connections enough time
**Rule:** the core entry point gives each address attempt at least two seconds, preserving longer configured values.
**Why:** a short default address-attempt window can exhaust reachable Telegram addresses before a connection
finishes on a slow network. Read-only attachment fetches also retry transient failures; outgoing sends retain
their uncertainty policy and are never retried blindly.
**Where:** `apps/core/src/main.ts`, `apps/core/src/channels/telegram.ts`.

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

<a id="acp-ask-mode"></a>
### An ACP agent must be started in "ask" mode, or it acts without our policy
OpenCode's default configuration lets it edit files without a permission request, so the first real test wrote a
file the owner never approved. Each known ACP agent now says what puts it in ask mode (`OPENCODE_PERMISSION`,
`qwen --approval-mode default`); its requests then go through the same `decide()` rule as APX's tools, commands
classified like the `shell` tool's. Where: `apps/core/src/harness/acp/agents.ts`, `engine/executor.ts`.

<a id="acp-garbage"></a>
### What an agent process prints must never reach the core's own exceptions
A `null` line on an ACP agent's stdout made the reader throw inside the stream listener, which ended the whole
core; a closed stdin did the same through EPIPE. The reader now drops anything that is not a message object, guards
notification handlers and stdin, and caps line length. Where: `apps/core/src/harness/acp/rpc.ts`.

<a id="code-thread-paths"></a>
### In a code thread, where a tool points matters as much as what it does
Reads were allowed anywhere (Claude's Read/Glob/Grep, ACP "read" kinds) and could be fetched out without asking;
"auto" edits compared path strings, so a symlink or an edit to `.git/config` (`core.fsmonitor` runs at the next
`git status`) or to the agent's own `.apc` file escaped the policy. Paths are now resolved through links, reading
outside the folder asks, fetching asks in code threads, auto never edits `.git/`, `.apc/` or `AGENTS.md`, and APX
runs git with fsmonitor, hooks and external diff off. Where: `apps/core/src/engine/paths.ts`, `executor.ts`,
`changes.ts`, `harness/claude.ts`.

<a id="context-merge"></a>
### Thread context is merged, never rewritten from a copy
A turn read the thread's bookkeeping at its start and wrote it back whole at the end; a summary or a title written
in between by the background upkeep would have been lost. Writers now change only their keys over what is stored
(`threads.mergeContext`), and compaction runs once per thread at a time (two requests at once had summarized twice).
Where: `apps/core/src/domain/threads.ts`, `engine/upkeep.ts`.

<a id="system-notices"></a>
### A system message with only a notice rendered as an empty line
The chat drew system messages from their text parts only, so notices APX posts on its own ("paused", "summarized")
never showed. System messages now render their notice parts. Where: `apps/web/src/chat/Transcript.tsx`.

<a id="tainted-notes"></a>
### A note saved from outside content stays outside content
With total autonomy, `remember` ran without asking while a web page was in the turn; the note then reached later
turns as plain text, so those turns counted as clean and high-impact tools stopped asking. Notes now carry `tainted`
(set from the turn's live state; the owner's edit clears it) and tainted notes are shown inside an untrusted
envelope wherever they appear (turn preamble, `recall`). Likewise a paused delegation's result is logged wrapped, so
a summary of it stays untrusted. Where: `apps/core/src/tools/memory.ts`, `rpc/memory.ts`, `engine/engine.ts`.

<a id="aux-model-scope"></a>
### An auxiliary call only goes where the thread's turns may already go
Titles and summaries took the first API model of the router for every thread, so a thread kept on a local model
could have its transcript sent to a cloud API. The auxiliary model is now `model_aux`, else the API models that
thread's agent may use (its own, then the router's), and threads run only by Claude Code or Codex are not
summarized (their engine keeps its own transcript). Where: `apps/core/src/engine/upkeep.ts`.

<a id="stable-selectors"></a>
### A store selector must not build a new array
`useChannels((s) => s.persons.filter(…))` returned a new array on every read, which the store took as a change:
React re-rendered until it gave up (error #185) and the panel went black. Select the stored value and derive in the
component. Where: `apps/web/src/config/TelegramSection.tsx`.

<a id="pairing-owner-by-code"></a>
### Linking the owner's own address takes the code their phone received
"It's me" was a button on every pending request, which showed only the name the sender chose: a stranger who copied
the owner's name could be approved as the owner by mistake and then approve confirmations. The owner now types the
code the bot sent to their own Telegram; requests show the @username. Where: `apps/web/src/config/TelegramSection.tsx`.

<a id="channel-send-certainty"></a>
### Only a send that surely did not leave is retried
"fetch failed" also covers a connection reset after the request went out, so retrying it duplicated messages. Only
refused or unresolved connections are retried; everything else is "uncertain". A long reply rate-limited halfway
continues from the part that failed (`Presentation.skip`) instead of being dropped. Where:
`apps/core/src/channels/telegram.ts`, `delivery.ts`.

<a id="shell-symlink-cwd"></a>
### The shell's folder check resolves links
`shell` compared its working folder with the project's as written, so `cwd: "escape"` where `escape` is a symlink to
another folder passed the check and ran the command outside the project. Folder checks now go through one module:
`isInside` for paths already resolved, `insideReal` (links resolved) wherever a path comes from an agent. Where:
`apps/core/src/paths.ts`, `tools/shell.ts`.

<a id="cron-clock-change"></a>
### The next cron time is found on real time, never by setting local fields
Setting hours and minutes on a time inside the hour repeated when clocks go back picks the earlier instant, so the
"next" run came out before the current one and a routine ran back to back for an hour. `nextCron` now steps forward on
epoch minutes and only reads local fields; `nextTime` refuses anything not after `from`. Where:
`apps/core/src/domain/schedule.ts`, `engine/routines.ts`.

<a id="task-notice-transition"></a>
### A task notice is raised when the task starts waiting, not on every update
Every comment and turn re-sent `task.updated`; once the owner had read the notice, the next one created a fresh unread
notice and the Dock badge came back. The notice is now added only on the false → true change of `awaits_owner`
(`rpc/tasks.ts`); the bus listener only clears it. Where: `apps/core/src/engine/attention.ts`, `rpc/tasks.ts`.

<a id="date-field-commit"></a>
### Date fields commit on blur
A `date` input fires on each typed digit of the year (`0002-…`, `0202-…`); saving each one moved the task to 1902
and could send a real "Due" reminder. The field keeps a draft and commits on blur or Enter; the core also refuses
years before 2000 and anything but `YYYY-MM-DD` or an ISO date-time. Where: `apps/web/src/tasks/Commitments.tsx`,
`apps/core/src/rpc/tasks.ts`.

<a id="apx-cli-from-shell"></a>
### An agent's shell command that runs APX's CLI is always asked
Owner-only methods trust the client's `x-apx-actor`; `apx2 …` from the shell tool reaches the API without naming the
port, so the port check missed it. Running the CLI is now always the owner's call. Where:
`apps/core/src/tools/shell.ts`.

<a id="plugin-sandbox-escapes"></a>
### Plugins get an allow-list of modules and a fetch that checks the connected address
The first runner denied a list of network modules, but Node exposes others (`_http_client`, `_http_agent`,
`_tls_wrap`) and the global `fetch` could be fooled (a URL object that changes on its second read, a `Request`
subclass, `::ffff:7f00:1`), so a plugin without network reached APX's loopback API as the owner. The runner now allows
a short list of built-ins and replaces `fetch` with one built on `http.request` whose lookup checks the address it
actually connects to. Where: `apps/core/src/extensions/plugin-runner.mjs`.

<a id="plugin-host-limits"></a>
### A plugin cannot stall turns, crash APX or outlive its approval
A non-text context answer threw before the turn's `try` and left runs `working`; a flood without newlines grew a
buffer until APX crashed; a crash-looping context plugin let a second one be enabled and APX then failed to boot; a
reinstall while on kept the old process and its restart ran the new, unapproved files. Turn setup now fails the run,
lines are capped (the plugin is stopped), plugin start never throws, the one-context rule is checked against every
enabled extension, and every restart re-checks approval and fingerprint. Where: `apps/core/src/extensions/plugins.ts`,
`extensions.ts`, `engine/turn.ts`.

<a id="idempotency-per-caller"></a>
### A replayed key belongs to its caller, and shown-once results are never cached
The idempotency cache stored `clients.create`'s token in plain text and replayed a key to any caller. Keys are now
scoped to the caller (client, run or actor) and methods marked `replay: false` are not cached. Where:
`apps/core/src/rpc/router.ts`, `packages/protocol/src/methods.ts`.

<a id="optional-tools-and-channel-continuations"></a>
### Optional tool arguments and channel destinations remain explicit
Responses may normalize an omitted `strict` into a schema with all properties required. An optional worker then
became a mandatory placeholder alongside the named agent. The transport now sends `strict: false`; the executor
still validates arguments and rejects conflicting delegation targets before showing a successful action.
See [OpenAI's function calling guide](https://developers.openai.com/api/docs/guides/function-calling).

Total autonomy now applies to `ask` tools even when outside data is in context, matching the owner's explicit
selection; `always` still requires approval. Each run stores its reply destination, including room message references,
so queued inputs cannot redirect an earlier answer. Resumed approvals and asynchronous results inherit that destination.

Telegram connection timeouts, including aggregate IPv4/IPv6 connect failures, are retried because nothing was sent.
Timeouts after connecting remain uncertain and are never resent blindly. Where: `apps/core/src/providers/chatgpt-responses.ts`,
`tools/agents.ts`, `tools/policy.ts`, `engine/engine.ts`, `channels/manager.ts`, `channels/net.ts`.
