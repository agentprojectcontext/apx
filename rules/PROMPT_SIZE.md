# Prompt size

What every model call carries before the conversation: the system prompt and the tool definitions. It is paid on
every step of every turn, so it is a budget, not a detail. APX v2 is the smallest of the agent apps we measured; keep
it that way.

## The budget

Measured on a fresh install: the secretary, a new chat, default settings, no skills or MCP servers added.

| Part | Budget | Now (2026-10-25) |
|---|---|---|
| System prompt | 10,000 chars (about 2,300 tokens) | 5,425 chars (the permission mode's text said here once instead of in every turn; the delegate and web rules short, their details in their tools) |
| Tool definitions (39, without the browser) | 30,000 chars (about 7,100 tokens) | 22,349 chars, about 5,300 tokens (the channel and contact tools and make_image only once a channel or an image service is on; repeats of system rules out of descriptions) |
| A turn's input before the message | — | 264 chars: one `[context]` line (time, channel, mode) and the roster when it changed |
| Browser tools (8, lent by the desktop app) | — | 811 tokens |

Together the two stay at about 6,400 tokens, half of Hermes and OpenClaw (about 13,000): the room above today's size
is for what a new owner needs to find their way, not for padding. A channel turned on adds its seven tools (about
3,900 chars) and the rule for them; an image service adds make_image (about 600).

A realistic owner has its own budget in the same test: a WhatsApp channel with stickers, the computer allowed,
instructions of their own, an "about" and a project with a 20,000-character AGENTS.md. Its project chat sends 7,010
chars of system prompt besides that AGENTS.md, which goes whole (budget 7,500), and 26,620 of tools (29,000); its
WhatsApp turn's input is 265 chars before the message (600). Before the fixed instructions left the turn they were about
27,000 and 2,250.

`apps/core/src/engine/prompt-budget.test.ts` fails past the budget; it fixes the temp folder and the build it names,
so every machine measures the same. Raising it is allowed with a reason in the commit and the numbers here updated;
trimming something else first is better.

A project's own files are not part of this budget. Its AGENTS.md and `.apc/memory.md` reach its agents whole
([D-158](DECISIONS.md#d-158)); they sit in the cached prefix, so a long one costs little after the first call.
Past a safety limit of 200,000 characters both are cut, with a marker the agent and the owner see
([D-110](DECISIONS.md#d-110)).

How to stay within it:

- A new tool earns its place (AGENTS.md rule 15). Its description says what it does and when, once; the rule that
  applies to every turn lives in the system prompt, not repeated in a tool.
- Argument descriptions do not list an enum's values: the schema already does.
- Tools that come and go (MCP servers', extensions') are reached through `mcp_search` and `mcp_call`, never added one
  schema each ([D-053](DECISIONS.md#d-053)).
- APX's own skills (`apps/core/src/skills/apx/`, how to change APX itself) are always there, so the catalog names
  them in one sentence (about 50 tokens) instead of a line each; their bodies load only with `load_skill`.
- A turn's input carries data; a fixed instruction its chat calls for (the mode, how to write on a phone chat, voice
  notes, stickers, the computer, a folder's write policy) is a closing section of the system prompt, told once
  ([D-156](DECISIONS.md#d-156)). The owner sees what a call carried with "See what it received" on an answer.
- What changes per turn (time, roster, memory, matched skills) goes in the turn's input, never in the system prompt:
  the system prompt stays byte-stable so the provider's prompt cache keeps it. What differs per chat or per release (the
  chat's temp folder, the APX version) closes the prompt, so every chat shares the cached prefix before it.
- A tool that needs something set up (a channel, an image service) is offered once it is (`when` on the tool).
- `pnpm tools:review` checks that a model still picks the right tool after a description changes, and prints the
  largest tools.

## Per-turn memory

Notes travel in the turn's input, never the system prompt, so they do not count against the budget above; they have
caps of their own instead, so a big notebook cannot grow every call:

| Part of the `[memory]` block | Cap |
|---|---|
| Notes matching the message | 1,800 chars |
| Standing notes (first turn in a thread) | 600 chars beside matches, else 2,400 |
| Index of the agent's own notes (owner turns) | 2,000 chars, untrusted envelope included (`INDEX_CHARS` in `engine/recall.ts`) |

The index is listed once per thread and then only for notes saved since, so a later turn usually adds nothing.
`engine/memory-notes.test.ts` holds a 70-note notebook to the index cap.

## Compared with other agent apps

Size of the first model call of a fresh install, in o200k_base tokens. Each app's own prompt builder was run with
its default configuration (not copied by hand). Measured 2026-10-07 (APX v2 again on 2026-10-20): APX v1 1.124.0, OpenClaw
2026.9.5 (Claude model, "full" profile, as its onboarding sets), Hermes Agent (checkout reporting 0.21.4, its default
GLM model).

| App | System prompt | Tools sent | First call |
|---|---|---|---|
| **APX v2** | 1,467 | 45 tools, 6,728 (8 more, 811, when the desktop app lends its browser) | **≈ 8,200** |
| Hermes | 3,956 | 24 tools, 9,070 (the rest behind tool search) | ≈ 13,000 (12,000 with Claude) |
| APX v1, Telegram / CLI / desktop | 4,626 | 39 tools, 8,609 | ≈ 13,200 |
| OpenClaw | 9,800 | 14 tools, 3,411 (50 more behind tool search) | ≈ 13,200 (15,100 on the first turn) |
| APX v1, web chat / API / routines | 4,115 | 102 tools, 19,441 | ≈ 23,600 |

The per-turn context each adds (time, roster) is under 100 tokens and left out. The chart is
[`assets/prompt-size.svg`](../assets/prompt-size.svg).

What the others do that matters as much as size:

- **Tool search.** OpenClaw and Hermes send only common tools; the rest, MCP's included, wait behind a search tool.
  OpenClaw with it off sends 27.5k tokens of tools alone.
- **Prompt cache.** Both keep the start of the prompt identical across calls and mark it for the provider's cache.
  APX v1 had no cache and its system prompt changed every turn (memory in the middle), so every call paid in full.
- **Model-specific padding.** Hermes adds about 1,000 tokens of "use your tools" rules for non-Claude models; v1 added
  475. v2 has one set of rules for every model.

## In a real install

The budget above is the floor. On the owner's machine (2026-10-07) ten ordinary MCP servers brought 319 tools, about
62k tokens per call, when every MCP tool was sent: 64,432 tokens for a one-line answer. With `mcp_search` and
`mcp_call` the same call is 11,838 tokens, and from a chat's second call the ChatGPT plan reads about 97% of it from
its prompt cache ([D-053](DECISIONS.md#d-053)). Thirty skills add about 1,000 tokens to the system prompt's catalog
(33 per skill).
