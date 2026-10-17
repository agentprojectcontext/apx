# Prompt size

What every model call carries before the conversation: the system prompt and the tool definitions. It is paid on
every step of every turn, so it is a budget, not a detail. APX v2 is the smallest of the agent apps we measured; keep
it that way.

## The budget

Measured on a fresh install: the secretary, a new chat, default settings, no skills or MCP servers added.

| Part | Budget | Now (2026-10-17) |
|---|---|---|
| System prompt | 6,500 chars (about 1,450 tokens) | 6,402 chars, about 1,450 tokens |
| Tool definitions (44, without the browser) | 28,000 chars (about 6,700 tokens) | 27,982 chars, about 6,700 tokens |
| Browser tools (8, lent by the desktop app) | — | 811 tokens |

`apps/core/src/engine/prompt-budget.test.ts` fails past the budget; it fixes the temp folder and the build it names,
so every machine measures the same. Raising it is allowed with a reason in the commit and the numbers here updated;
trimming something else first is better.

How to stay within it:

- A new tool earns its place (AGENTS.md rule 15). Its description says what it does and when, once; the rule that
  applies to every turn lives in the system prompt, not repeated in a tool.
- Argument descriptions do not list an enum's values: the schema already does.
- Tools that come and go (MCP servers', extensions') are reached through `mcp_search` and `mcp_call`, never added one
  schema each ([D-053](DECISIONS.md#d-053)).
- APX's own skills (`apps/core/src/skills/apx/`, how to change APX itself) are always there, so the catalog names
  them in one sentence (about 50 tokens) instead of a line each; their bodies load only with `load_skill`.
- What changes per turn (time, roster, memory, matched skills) goes in the turn's input, never in the system prompt:
  the system prompt stays byte-stable so the provider's prompt cache keeps it.
- `pnpm tools:review` checks that a model still picks the right tool after a description changes, and prints the
  largest tools.

## Compared with other agent apps

Size of the first model call of a fresh install, in o200k_base tokens. Each app's own prompt builder was run with
its default configuration (not copied by hand). Measured 2026-10-07: APX v2 at this commit, APX v1 1.124.0, OpenClaw
2026.9.5 (Claude model, "full" profile, as its onboarding sets), Hermes Agent (checkout reporting 0.21.4, its default
GLM model).

| App | System prompt | Tools sent | First call |
|---|---|---|---|
| **APX v2** | 1,260 | 50 tools, 6,859 | **≈ 8,100** |
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
