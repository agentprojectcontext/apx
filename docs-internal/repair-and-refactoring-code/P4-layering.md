# P4 — Layering repair

Three live imports invert `core → adapter → surface`. After P1 the ESLint rule
reports them; this phase makes the rule pass honestly instead of by exception.

## P4-1 — Move `host/daemon/runtimes/` → `core/runtimes/`

```
core/runtimes/detect.js:4,5                      → #host/daemon/runtimes/_spawn.js, antigravity.js
core/agent/tools/handlers/call-runtime.js:18,19  → #host/daemon/runtimes/_spawn.js, index.js
```

`src/host/daemon/runtimes/` is 515 lines across 10 files and contains **no HTTP or
host concern at all** — it is a pure adapter registry for external coding CLIs
(claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code,
antigravity). It is simply misfiled. Moving it erases all four violations at once
and gives `core/runtimes/detect.js` a home next to what it detects.

Note `antigravity` is registered but undocumented in `AGENTS.md` — fix in P0-2.

## P4-2 — Extract the use-cases stranded in `api/*`

Rule: an `api/*.js` file is `body → core → response`. These four are full
use-cases, ~740 lines of domain logic resident in adapters.

| File | Lines | Extract to |
|---|---|---|
| `api/exec.js` | 210 (~180 domain) | `core/agent/run-agent-chat.js` — model resolution cascade, conversation lifecycle, compact-summary regex, history flattening, dual ledger writes |
| `api/skills.js` | 448 (~230 domain) | `core/agent/skills/install.js` — zip decode, `spawnSync("unzip")`, `git clone` + `.git` strip, delete-with-policy GC |
| `api/voice.js` | 271 (~200 domain) | `core/voice/turn.js` — the STT→agent→TTS pipeline. Its own header claims "just glue"; it is not |
| `api/code.js` | 258 (~130 domain) | `core/agent/code-turn.js` — git auto-init, plan/build allow-list gating, iteration policy, turn dedup |

Also worth moving while here:

- `api/pairing.js` — the whole pairing state machine sits in module scope
  (`const sessions = new Map()` at :46, TTL purge, NIC enumeration). There is no
  `core/pairing/`.
- `api/shared.js:198-243` — `agentToResponse` owns the APC frontmatter field
  vocabulary in the adapter instead of next to the parser in `core/apc/`.
- `plugins/desktop/index.js:84-229` — `_handleMessage` is ~145 lines of turn
  orchestration including `formatAskQuestionsForVoice`, which is a **prompt/format
  concern** and per rule 12 belongs in `prompts/channels/`.

**Model to copy:** `plugins/telegram/index.js` is 419 lines and *clean* — it
delegates everything to `#core/channels/telegram/*`. The other plugins should look
like it.

## P4-3 — Break the import cycles

9 cycles, all inside `core/`, none crossing layers:

- 4× `memory/embeddings.js` ↔ `embed-engines/{ollama,openai,gemini,tf}.js` — same
  shape; extract the shared helper to `embed-engines/_shared.js`.
- `agent/super-agent.js → tools/registry.js → handlers/run-subagent.js →
  super-agent.js` — real recursion expressed as a static cycle; inject the runner.
- `agent/skills/index.js → skills/rag.js → skills/index.js` — classic barrel cycle.
- `integrations/plugins/obsidian.js ↔ obsidian-memory.js`.
- `i18n/index.js` and `mascot.js` self-referencing re-export loops.

## P4-4 — Document the TUI island

`src/interfaces/tui/` is 23709 lines that import `@opencode-ai/*` in 50 files and
make **zero** `#core/` imports — it talks to APX over HTTP. That is a legitimate
architectural choice, but it is described nowhere, so "one domain function, one
home" cannot be applied there and nobody knows why. Say so in `AGENTS.md`.
