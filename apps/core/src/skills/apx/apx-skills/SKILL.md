---
name: apx-skills
description: Create, import, edit, turn on or off APX skills, the know-how agents load on demand (a SKILL.md with name and description), for every agent or for one project. Use it when the owner asks to make, change, install or import a skill (from a folder, a zip, a git repo or another agent app), teach agents a procedure, or save a way of working for next time.
---

# Skills in APX

A skill is a folder with a `SKILL.md`: frontmatter (`name`, `description`) and a body with the know-how. Agents see
each skill's name and the first sentence of its description in every turn and load the body with `load_skill` only
when a task matches, so a skill costs almost nothing until it is used.

| Kind | Where | Who sees it |
|---|---|---|
| APX's own (`apx-*`) | Come with APX | Every agent; always on, read-only |
| The owner's | APX's home, `skills/` | Every agent, unless turned off in a project |
| A project's | `<project>/.apc/skills/<name>/` | That project's agents; committed with the repo |
| An extension's | Inside the extension | While the extension is on |
| Another agent app's | `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.agents/skills` (and `.claude/skills`… in a project) | Every agent (that project's), read where the app keeps it |

The owner sees them all in [Resources › Skills](apx:resources/skills). One name found in two places is one skill: the
first in the table's order wins (a project's own, the owner's, then the other apps', then extensions') and the others
are listed as its copies ("also in"). Another app's skill is read-only here: it changes in that app, or is copied into
APX (`apx skills import <its folder>`) to change it here.

## Write a good one

```markdown
---
name: weekly-report
description: Writes the Friday status report for a client from the week's tasks and commits. Use it when the owner asks for the weekly report or a client update.
---

# Weekly report

1. …the steps, the commands, the format, the traps…
```

- `name`: letters, digits, `_`, `.` and `-`, at most 64; kebab-case. Not the name of one of APX's own skills.
- `description`: what it does, then "Use it when …" with the words the owner would say. The first sentence is what
  agents see in every turn: make it count, keep it under about 180 characters.
- Body: steps, exact commands, formats and the mistakes to avoid. No secrets (use variables, apx-variables), no
  personal data unless the owner asked for it there.
- Write it in English unless the owner wants another language.

## Save it

Use the `apx skills save` command (through `shell`): it writes the file where APX reads it and checks it.

```bash
# For every agent (the owner's skills)
apx skills save weekly-report < "$TMP/weekly-report/SKILL.md"

# Only for one project (written to its .apc/skills/)
apx skills save weekly-report --project <project-id> < "$TMP/weekly-report/SKILL.md"
```

Write the draft in your temp folder first. Saving an existing name replaces it (from a project, an owner's skill gets
a project copy instead). The command prints where the `SKILL.md` lives; extra files a skill needs (scripts,
references) go next to it, and the body says when to read them (`load_skill <name> file=<path>`).

## Import

From a folder, a `.zip` or a git repository (https or ssh; a GitHub link to a folder takes only that folder). Reading
runs nothing: it lists each skill found, its files, the scripts it brings, settings only another app reads, and what
is left out (links, oversized files).

```bash
apx skills import https://github.com/acme/skills            # list what is there
apx skills import https://github.com/acme/skills --only pdf --yes
apx skills import ~/.claude/skills/pdf --yes                # copy another app's skill into APX
apx skills import ./pack.zip --project <project-id> --yes   # into that project's .apc/skills/
```

A name already taken is kept unless `--replace`. Show the owner the list (and any scripts) before `--yes` when the
source is not theirs.

## On and off

```bash
apx skills                                   # all, with "off" where turned off ("apx" marks APX's own)
apx skills off <name> --project <project-id> # not in that project
apx skills on <name>
```

APX's own skills cannot be turned off, edited or replaced.

## After saving

It is live from the next message. Tell the owner its name, whether it is for everyone or one project, and the one line
agents will see.
