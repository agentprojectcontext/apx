# AGENTS.md Companion Spec for APC

**Version:** 0.1.0  
**Status:** Draft

This document defines the `AGENTS.md` grammar APC consumers parse at the project root.

It is a companion to, not a replacement for, the broader APC specification in
`agentprojectcontext/agentprojectcontext`.

## 1. Purpose

`AGENTS.md` is the compatibility-facing root contract for agent discovery.

APC projects may also include structured per-agent files under `.apc/agents/<slug>.md`, but `AGENTS.md` remains the most broadly portable agent index because many tools already understand it.

## 2. File location

`AGENTS.md` MUST live at the project root, next to `.apc/`.

A directory is an APC project if and only if both exist:

- `AGENTS.md`
- `.apc/project.json`

Consumers SHOULD walk upward from the working directory and use the nearest matching ancestor.

## 3. Top-level structure

```markdown
# Agents

<optional prose>

## architect
- **Role**: System design
- **Model**: claude-sonnet-4-6
- **Skills**: documentation, release-checklist

## reviewer
- **Role**: Code review
- **Model**: gpt-5
```

Rules:

- the file MUST contain exactly one `# Agents` heading
- each agent MUST be declared with an H2 heading of the form `## <slug>`
- the slug MUST match `^[a-z][a-z0-9_-]*$`
- free-form markdown above or between agent sections MAY appear and SHOULD be ignored by strict APC parsers

HTML comments MUST be ignored by parsers.

## 4. Field format

Inside an agent section, fields use markdown bullets:

```markdown
- **Field**: value
```

The field name is case-sensitive in the file, but consumers MAY normalize keys internally.

## 5. Reserved fields

| Field | Type | Required | Description |
|---|---|---|---|
| `Role` | string | no | Short human role label |
| `Model` | string | no | Preferred model identifier |
| `Skills` | comma-separated list | no | Referenced skill names in `.apc/skills/` |
| `Language` | string | no | Default response language tag |
| `Tools` | comma-separated list | no | Allowed or expected tool names |
| `Memory` | string | no | Override path for memory file |
| `Description` | string | no | One-line agent summary |

APC consumers MUST tolerate missing reserved fields.

## 6. Custom fields

Any field of the form:

```markdown
- **AnythingElse**: value
```

MAY appear.

Consumers MUST preserve unknown fields when practical and MUST NOT fail merely because a field is unrecognized.

## 7. Multi-line values

Field values MAY continue on later indented lines:

```markdown
- **Description**: Reviews behavior changes,
  test coverage, and migration risks.
```

Continuation lines SHOULD be treated as part of the preceding scalar value.

## 8. Relationship to structured agent files

If a project also contains `.apc/agents/<slug>.md` for the same slug:

- the structured file SHOULD be treated as the authoritative structured definition
- `AGENTS.md` remains the compatibility and discovery surface

This allows APC projects to serve both human-readable root contracts and machine-oriented structured agent files.

## 9. Minimal example

```markdown
# Agents

## architect
- **Role**: System design
- **Model**: claude-sonnet-4-6
- **Skills**: documentation, release-checklist
- **Description**: Defines architecture and migration strategy.

## reviewer
- **Role**: Code review
- **Model**: gpt-5
- **Skills**: documentation
- **Description**: Reviews risks, tests, and regressions.
```
