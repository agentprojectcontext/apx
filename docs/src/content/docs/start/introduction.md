---
title: Introduction
description: What APX is, how it relates to the APC protocol, and why the filesystem is the source of truth.
sidebar:
  order: 1
---

**APX** is a daemon + CLI that brings the [APC convention](https://github.com/agentprojectcontext/agentprojectcontext)
to life. APC (Agent Project Context) is a protocol — a convention for how agent definitions, memory,
and project context live on disk. APX is its reference implementation:

> APX is to APC what a language SDK is to a protocol spec.

## What APX gives you

- **Daemon** — a local HTTP server that manages projects, agents, sessions, and message logs.
- **CLI** (`apx`) — commands for running agents, reading memory, tailing messages, managing sessions.
- **Runtimes** — bridges to external coding CLIs: Claude Code, Codex, OpenCode, Aider, Cursor.
- **Engines** — direct LLM calls via Anthropic, OpenAI, Gemini, Ollama, or a mock.
- **Plugins** — Telegram bot integration out of the box.
- **MCP support** — each agent can expose or consume MCP servers.

## The filesystem is the source of truth

APX is opinionated about storage. Project definitions and curated memory live **in your repo**.
Runtime state — sessions, conversations, messages, caches — lives in `~/.apx/` and is **never
committed**.

| Lives in the repo (committed) | Lives in `~/.apx/` (local only) |
| ----------------------------- | ------------------------------- |
| `AGENTS.md` agent definitions | Sessions & conversation threads |
| `.apc/agents/<slug>.md`       | Agent memory, message history / logs |
| `.apc/mcps.json` (no secrets) | `project.db` SQLite cache       |
| `.apc/skills/`, `.apc/commands/` | MCP runtime tokens           |

This split means your agents and their roles are versioned alongside your
code, while machine-specific runtime noise stays out of git.

## How APX relates to APC

The [APC specification](https://github.com/agentprojectcontext/agentprojectcontext) defines the
on-disk layout. APX provides the tooling to use it: the daemon, the CLI, and every surface built on
top. If you follow the APC convention, any APC-aware tool (Codex, Antigravity, others that read
`AGENTS.md`) can discover your agents — APX just makes them runnable, observable, and reachable from
many surfaces.

## Where to go next

- [Installation](/apx/start/installation/) — get APX on your machine.
- [Quick start](/apx/start/quick-start/) — from `apx init` to your first run.
- [Architecture](/apx/start/architecture/) — the core / host / interfaces layering.
