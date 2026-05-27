---
name: apx-skill-builder
description: How to author a new APX skill. Load when the user asks "creame una skill X", "necesito una skill que enseñe Y", or you (the agent) decide a recurring instruction set deserves to be a skill. Covers file location, frontmatter, body style, and how the super-agent finds it on demand.
---

# apx-skill-builder

A **skill** in APX is a Markdown file the super-agent loads on demand to learn how to do something. Inspired by Anthropic's skill-creator pattern, simplified for APX's daemon-served model.

## When to make a skill (vs. inlining in the system prompt)

- **Make a skill** when the topic is bounded (a tool, a config domain, a recurring workflow), the instructions need >50 tokens to be safe, and not every conversation needs them.
- **Don't** make a skill for one-off explanations, casual chat, or stuff that fits in 2-3 lines in the base prompt.

## File location

Three places APX scans, in priority order:

1. `<repo>/.apc/skills/<slug>/SKILL.md` — project-scoped (only this project's super-agent sees it).
2. `~/.apx/skills/<slug>/SKILL.md` — user-global (all projects).
3. `<repo>/skills/<slug>/SKILL.md` in the APX source — bundled (ships with the package).

Either layout works:
- `<slug>/SKILL.md` (dir-style, preferred — lets you ship `references/`, `assets/`, etc.)
- `<slug>.md` (flat-style, fine for short ones)

## Frontmatter

The file MUST open with YAML frontmatter:

```yaml
---
name: my-skill
description: One-sentence trigger for the super-agent. Include the user-phrases that should cause it to load. Keep under 220 chars — appears in skill listings.
---
```

`description` is what the model sees when deciding whether to call `load_skill`. Write it as the *trigger condition*, not a summary of the body.

**Good**: `"How to register an MCP server. Load BEFORE running 'apx mcp add' — three scopes, gotchas with stdio commands, secrets handling."`

**Bad**: `"This skill describes APX's MCP system."` (no trigger; the model won't know when it matters).

## Body style

Opinionated, concrete, anti-example-driven. Every other APX skill in `skills/apx-*` follows the same shape — read one before writing yours:

1. **One-paragraph "what this is"** (no preamble, no marketing).
2. **Concrete CLI calls** the user runs, with the most common case first.
3. **Schema / shape** if the topic involves files or config.
4. **Anti-examples** — at least one "DON'T do this" with the reason. This is what stops the model from inventing flags.
5. **Open questions / footnotes** if the surface is incomplete.

Length budget: 80-200 lines. If it's longer, split into sub-skills or move scripts into `<slug>/scripts/`.

## How the super-agent loads it

```js
// The model emits a tool call:
load_skill({ slug: "my-skill", project_path: "/abs/path/optional" })
```

That returns the full body. The agent uses the content in-context for that turn; it doesn't persist.

The user can list installed skills with:
```bash
apx skills list
apx skills list --project iacrmar
```

## Workflow: create + register

```bash
# 1. Pick scope
#    Project-scoped:   .apc/skills/<slug>/SKILL.md
#    User-global:      ~/.apx/skills/<slug>/SKILL.md
#    Bundled (in repo): skills/<slug>/SKILL.md

# 2. Write the file
mkdir -p skills/my-thing
$EDITOR skills/my-thing/SKILL.md

# 3. The daemon picks it up on next listSkills() — no restart needed unless
#    you've changed the scaffold sync. Confirm:
apx skills list | grep my-thing

# 4. Inside the super-agent, you can pre-test:
apx exec super-agent "Cargá la skill my-thing y resumime en 3 bullets"
```

## Anti-examples

```yaml
---
# DON'T omit description — the model can't trigger on the slug alone.
name: vague-stuff
---

# DON'T pile general advice into the body. Pick ONE topic per skill.
# A skill that says "lots of useful tips about everything" is dead weight
# in the model's mental cache.

# DON'T duplicate apx --help. Skills explain WHEN and WHY, not just WHAT.
# `apx mcp add --help` already lists flags. The skill teaches the decision
# tree ("when shared vs runtime", "what to do if it fails").

# DON'T leave TODOs in production skills. If a section is incomplete,
# delete it from the skill and add it to spec/backlog/.
```

## Skill scaffolding (optional `<slug>/`)

```
skills/my-thing/
├── SKILL.md           ← the body (always)
├── references/        ← markdown files the skill cites
│   └── examples.md
├── assets/            ← images, JSON schemas, sample inputs
└── scripts/           ← shell / node scripts the skill may shell out to
    └── verify.sh
```

The super-agent only sees `SKILL.md` automatically. `references/` and `scripts/` are addressable via paths from inside the body (e.g. "see references/examples.md"). Use this for skills with lots of supporting material.

## Existing APX skills — copy the style

- `skills/apx-routine/SKILL.md` — routine kind selection + pipeline.
- `skills/apx-mcp/SKILL.md` — three-scope MCP configuration.
- `skills/apx-task/SKILL.md` — TODO management.
- `skills/apx-telegram/SKILL.md` — channel ↔ project ↔ agent wiring.
- `skills/apx-runtime/SKILL.md` — external CLIs (claude-code, codex, …).
- `skills/apx-voice/SKILL.md` — TTS engine setup.
- `skills/apx-agent/SKILL.md` — per-project agents.
- `skills/apx-project/SKILL.md` — project registration + typology.

Pick the closest topic, mimic the structure, then write yours.

## Don't

- Don't ship a skill without the frontmatter `description` — the loader can read the file but the trigger is silent.
- Don't put secrets inside skills. They're meant to be read aloud by an LLM.
- Don't reference filesystem paths that only exist on your machine — use `<repo>` or `~/.apx` placeholders.
- Don't write skills in third person. The reader is the model. Write to it.
