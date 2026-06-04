# APX Roadmap

> Living document. Update when a backlog item changes status or a new theme appears.

## Architecture (current)

```
src/
├── core/         ← shared logic (single source of truth)
│   ├── agent/       runAgent + prompt-builder + model-router + tool-call-parser
│   ├── engines/     llm adapters (anthropic, openai-compatible, groq, openrouter, gemini, ollama, mock)
│   ├── tools/       fetch, browser, search, glob, grep, registry
│   ├── mcp/         runner + sources
│   ├── voice/       tts + engines (piper/elevenlabs/openai/gemini/mock)
│   └── …            stores, parsers, config, identity, scaffold, logging
├── host/         ← long-running server processes
│   └── daemon/      Express API (api/ split by domain), super-agent, routines, plugins
└── interfaces/   ← user / external client surfaces
    ├── cli/         apx <command>
    ├── tui/         apx code (Solid + OpenTUI)
    ├── overlay/     Electron mascot
    ├── mcp-server/  apx-mcp bin (APX exposed as MCP server)
    └── web/         admin panel (coming soon)
```

**Rules** (see `spec/decisions/`):
- core → nothing else
- host/interfaces → core (never the other way)
- adapters live where they're used (interface-local or daemon-local) only if they're not shareable

## Backlog status

| # | Title | Prio | Size | Status |
|---|---|---|---|---|
| 01 | Routine output coherence (no double-reply) | P0 | S | idea |
| 02 | Telegram config cleanup | P0 | XS | idea |
| 03 | Wizard: channel ↔ project ↔ master agent | P1 | M | idea |
| 04 | MCPs per-project storage + CLI | P1 | M | idea |
| 05 | Tasks (TODOs) per project | P1 | M | idea |
| 06 | Model per project in wizard | P1 | S | idea |
| 07 | Skills for APX operations | P1 | M | idea |
| 08 | Web admin panel | P2 | L | specced |
| 09 | APX SO Android bridge | P3 | L | specced |
| 10 | util/ cleanup | P0 | XS | idea |

## Decisions log

| ID | Title | Date |
|---|---|---|
| [001](decisions/001-core-host-interfaces.md) | Three-layer architecture: core / host / interfaces | 2026-05-27 |
| [002](decisions/002-super-agent-is-mode-not-name.md) | "super-agent" is a mode, not a persona name | 2026-05-27 |
| [003](decisions/003-web-interface-in-monorepo.md) | Web admin lives in this repo, Android (SO) does not | 2026-05-27 |
| [004](decisions/004-piper-default-local-tts.md) | Piper is the recommended local TTS engine | 2026-05-27 |
| [005](decisions/005-no-radix-on-web-panel.md) | Web panel UI: no Radix-based libraries | 2026-05-27 |

## Conventions

- **One backlog file per theme**: `spec/backlog/NN-kebab-title.md`.
- **Closed items**: move to `spec/done/` (keeps history without bloating backlog).
- **Decisions**: append-only. If a decision is superseded, write a new one that references it.
- **Skill manifests**: `skills/<slug>/SKILL.md`. Don't duplicate skill bodies inside `src/`.

## Outside this repo

- `apx-so` — Android client, separate repo (see decision 003).
- `apc` — APC spec docs, separate repo (sibling: `../apc/`).
