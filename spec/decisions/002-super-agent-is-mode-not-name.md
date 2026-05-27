# 002 — "super-agent" is a mode, not a persona name

**Date**: 2026-05-27
**Status**: accepted

## Context

The daemon-level agent that handles requests when no project agent is named has been called "super-agent" everywhere in code, prompts, config keys, file names, and channel meta. LLMs were getting confused — some responses started with "Hi, I'm the super-agent" or "the super-agent suggests…", treating it as a persona.

It is not. The user-facing name comes from `~/.apx/identity.json` (today "apx" or whatever the user configured). "super-agent" is the *mode*: the tool-using loop that runs when the request has no agent slug.

## Decision

Treat "super-agent" as a mode descriptor only:

- Code paths, HTTP routes, config keys, file names, channel meta, routine kinds, prompt files: keep "super-agent" / `super_agent` / `super-agent.md`. It's the technical term.
- User-facing copy (Telegram replies, overlay bubbles, CLI status lines, TUI sidebar, error messages): use the agent's display name from `~/.apx/identity.json`. Never "super-agent" in those.
- The base prompt at `src/core/agent/prompts/super-agent-base.md` opens with "You are APX itself, the default APX agent" — and explicitly tells the model "super-agent" is the mode and any user reference to it is a reference to YOU in this mode.

## Implementation

- AGENTS.md rule 7 codifies this. Every project AGENTS.md inherits it.
- TUI sidebar shows "APX" when no `--agent <slug>` was passed.
- Wherever user-visible labels were "SuperAgent" or "super-agent", they now read from identity or default to "APX".

## Consequences

- LLMs no longer roleplay as a persona named "super-agent".
- Renaming the agent in `identity.json` actually propagates to all user-visible surfaces.
- Code keeps the technical term, so refactors don't ripple through every prompt file.

## Supersedes / superseded by

None.
