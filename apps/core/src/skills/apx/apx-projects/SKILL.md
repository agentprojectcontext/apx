---
name: apx-projects
description: Create a project in APX, rename one or change its kind or description, list them, or add an existing folder as one, with the `apx projects` command. Use it whenever the owner asks for a new project, workspace or client, or to rename or reorganize their projects.
---

# Projects in APX

A project is a folder with an `AGENTS.md` and a `.apc/` folder: its agents, skills, memory, tasks and routines live
there. APX knows a project only once it is registered, which the `apx projects` command does (run it with `shell`;
the owner approves each call). **Never make one by writing files yourself**: a folder you make by hand is not in APX
until it is registered, and `.apc/project.json` is APX's to write.

## Commands

```bash
apx projects                                   # id, name and kind of each project ("!" = its folder is missing)
apx projects create "Northwind"                # a new folder of its own in APX's home
apx projects create "Northwind" --kind company --desc "Wholesale client: orders and invoices"
apx projects create "Acme site" --path ~/work/acme-site --kind software   # in that folder (made if missing)
apx projects register ~/work/existing-repo     # a folder that already has AGENTS.md or .apc/
apx projects set <project-id> --name "Northwind Ltd" --desc "…"           # only what you give changes
apx projects set <project-id> --desc ""        # an empty value removes the description
```

- Kind is one of `personal`, `app`, `company`, `software`, `other`. A company gets areas and roles for its agents;
  software is a code repository.
- `--path` is for a folder the owner names (an existing repo, a client's folder). Without it the project gets a
  folder of its own; do not invent a path.
- `register` takes a folder that already is a project (it has `AGENTS.md` or `.apc/`). For a plain folder use
  `create --path`, which writes a short `AGENTS.md` and an empty `.apc/` there and touches nothing else. Run
  `apx projects` first and never create again a project already in the list.
- The default project (no folder) cannot be renamed here; the owner does it in the app.

## After creating one

Tell the owner its name and id, and link it: `[Northwind](apx:project/<project-id>)`. A new project has no agents:
offer to add them with `agent_set` (if you have it) or point the owner to the project's Team screen.

## Removing

`apx projects rm <project-id>` only makes APX forget the project; its folder and files stay. Do it only when the owner
asks for that exact project, and say the folder was not touched. Deleting the folder is never yours to do.
