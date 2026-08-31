# 001 — Three-layer architecture: core / host / interfaces

**Date**: 2026-05-27
**Status**: accepted

## Context

The codebase grew with the LLM loop, engines, tools, MCP runner, plugins, scheduler, and 30+ CLI commands all living under `src/daemon/`. The CLI had two parallel trees (`src/cli/` and `src/cli-ts/`), and overlay + TUI were yet another isolated tree. Every new surface (voice CLI, MCP server, Android bridge) had to either reach into `src/daemon/` or reimplement logic. The boundary between "shared logic" and "transport" was blurred.

## Decision

Three top-level layers under `src/`:

- **`core/`** — pure logic. No transports, no Express, no Electron, no spawn. Imports nothing from `host/` or `interfaces/`. Stores, parsers, the LLM loop (`runAgent`), prompts, engine adapters, tool registry, MCP runner, voice synthesis facade. Anything that could conceivably be used from any surface lives here.
- **`host/`** — long-running server processes. Today only `daemon/`. Owns Express routing, plugin lifecycle, scheduler ticks, runtime adapters (claude-code, codex, …), conversation files on disk, transcription sidecar.
- **`interfaces/`** — every surface a human or external client uses to talk to APX. `cli/` (apx command), `tui/` (apx code), `overlay/` (Electron mascot), `mcp-server/` (apx-mcp bin), `web/` (admin panel — coming).

## Rules

- `core/` imports from nothing in `host/` or `interfaces/`. Detected violations are real bugs.
- `host/` and `interfaces/` import from `core/`. They never import from each other directly — the daemon is the only thing that talks to plugins; interfaces talk to the daemon over HTTP.
- Adapters with a transport bias (e.g. an HTTP-flavored OpenAI client) live in `core/engines/` because the bias is part of the LLM adapter, not the transport. The actual HTTP routing of a TTS request lives in `host/daemon/api/tts.js`.
- Each layer can have its own local utils (`src/interfaces/tui/util/`). They do not get promoted to `core/` unless another layer needs them.

## Consequences

- Every surface (CLI, TUI, overlay, Android client, web panel, MCP server) becomes a thin client over `core/` or `host/`.
- Adding a new engine, prompt, or tool is one place. Adding a new surface is one folder under `interfaces/`.
- Refactors stop rippling: a change to `runAgent()` is felt everywhere, but no surface needs to know.

## Supersedes / superseded by

None.
