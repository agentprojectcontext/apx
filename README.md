# APX — Agent Project eXecutor

> The reference implementation of the [APC protocol](https://github.com/agentprojectcontext/agentprojectcontext).
> APX is to APC what a language SDK is to a protocol spec.

## What APX is

APX is a daemon + CLI that brings the APC convention to life:

- **Daemon** — a local HTTP server that manages projects, agents, sessions, and message logs
- **CLI** (`apx`) — commands for running agents, reading memory, tailing messages, managing sessions
- **Runtimes** — bridges to Claude Code, Codex, OpenCode, Aider
- **Engines** — direct LLM calls via Anthropic, OpenAI, Gemini, Ollama, or a mock
- **Plugins** — Telegram bot integration out of the box
- **MCP support** — each agent can expose or consume MCP servers

APX is opinionated about storage: the filesystem is the source of truth. No database required to read agent state.

## Quick start

```bash
npm install -g apx

# In any directory with an AGENTS.md
apx init

# Spawn an agent with a full Claude Code runtime
apx run sofia --runtime claude-code "Review the open PRs and summarize them"

# Or a quick one-shot LLM exec
apx exec sofia "What is my role in this project?"

# Watch what's happening
apx messages tail
```

## Installation

```bash
npm install -g apx
```

Requires Node.js 20+. The daemon starts automatically on first `apx` call.

## Project layout

```text
project-root/
├── AGENTS.md              ← agent definitions (auto-generated from .apc/agents/)
└── .apc/
    ├── project.json       ← project metadata
    ├── agents/
    │   └── <slug>/
    │       ├── <slug>.md  ← agent frontmatter (role, model, skills…)
    │       ├── memory.md  ← durable memory, updated by the agent
    │       └── sessions/  ← one .md per runtime invocation
    ├── messages/          ← JSONL activity log (runtime, telegram, a2a)
    ├── mcps.json          ← MCP servers available to this project
    ├── skills/            ← reusable skill prompts
    └── commands/          ← custom slash commands
```

## Core commands

```bash
apx init [path]                          # initialize a project
apx agent list                           # list agents
apx agent add <slug> --role R --model M  # add an agent
apx memory <slug>                        # read agent memory
apx memory <slug> --append "<note>"      # append to memory

apx run   <slug> --runtime claude-code "<prompt>"   # full runtime session
apx exec  <slug> "<prompt>"                          # quick LLM call

apx session list <slug>                  # list past sessions
apx messages tail                        # last 50 messages, all channels
apx messages tail --channel runtime      # only agent invocations
```

## Message channels

All activity is logged to `.apc/messages/YYYY-MM-DD.jsonl`:

| Channel | What it captures |
|---------|-----------------|
| `runtime` | `apx run` invocations (prompt in, response out) |
| `a2a` | Agent-to-agent calls made from within a session |
| `telegram` | Telegram bot messages (stored globally in `~/.apx/messages/telegram/`) |
| `exec` | Quick `apx exec` calls |

## Runtimes

| Runtime | Description |
|---------|-------------|
| `claude-code` | Spawns Claude Code CLI with the agent's system prompt injected |
| `codex` | OpenAI Codex CLI |
| `opencode` | OpenCode CLI |
| `aider` | Aider CLI |

## Engines (for `apx exec`)

Configured in `~/.apx/config.json`:

```json
{
  "engines": {
    "anthropic": { "api_key": "sk-ant-..." },
    "openai":    { "api_key": "sk-..." },
    "ollama":    { "base_url": "http://localhost:11434" },
    "gemini":    { "api_key": "..." }
  }
}
```

## APC protocol

APX implements the [APC specification](https://github.com/agentprojectcontext/agentprojectcontext). The spec defines the on-disk layout; APX provides the tooling to use it.

## License

MIT
