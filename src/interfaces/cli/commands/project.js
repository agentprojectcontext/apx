import path from "node:path";
import { findApfRoot } from "#core/apc/parser.js";
import { http } from "../http.js";

function requireRoot() {
  const root = findApfRoot();
  if (!root) {
    throw new Error("not inside an APC project (run `apx init` first)");
  }
  return root;
}

export async function cmdProjectAdd(args) {
  const target = args._[0] || requireRoot();
  const result = await http.post("/api/projects", { path: path.resolve(target) });
  console.log(`Registered #${result.id}: ${result.path}`);
}

export async function cmdProjectList() {
  const projects = await http.get("/api/projects");
  if (projects.length === 0) {
    console.log("(no projects registered — try `apx project add .`)");
    return;
  }
  // A project whose folder is gone used to render as a perfectly ordinary row
  // that happened to say 0 agents — the name even looked right, because it fell
  // back to the basename of the path that no longer exists. The marker is the
  // difference between "this project has no agents" and "we cannot read this
  // project at all", and the footer says what to do about it.
  const missing = projects.filter((p) => p.missing);
  console.log(`  \tID\tNAME\t\t\tAGENTS\tPATH`);
  for (const p of projects) {
    console.log(`${p.missing ? "! " : "  "}\t${p.id}\t${p.name}\t\t${p.agents}\t${p.path}`);
  }
  if (missing.length) {
    console.log("");
    for (const p of missing) {
      console.log(`!  #${p.id} ${p.name}: ${p.missing_reason}`);
    }
    console.log(
      `\nReattach one with \`apx project relink <id> [new-path]\` — it keeps the id,` +
      ` so nothing pointing at the project breaks. Omit the path to let APX look for it.`
    );
  }
}

// Point a project at its new folder. The repair for a renamed or moved
// directory: the id survives, and with it the storage (which hangs off the
// apx_id, not the path), the routines, the tasks and every chat that named it.
export async function cmdProjectRelink(args) {
  const target = args._[0];
  if (!target) {
    throw new Error("apx project relink: missing <id|name|path> (see `apx project list`)");
  }
  const id = await resolveProjectId(target);
  const newPath = args._[1] ? path.resolve(args._[1]) : undefined;

  const result = await http.post(`/api/projects/${id}/relink`, {
    ...(newPath ? { path: newPath } : {}),
    ...(args.force ? { force: true } : {}),
  });
  console.log(`Relinked project #${result.id}: ${result.from} → ${result.path}`);
  console.log(`${result.agents} agents; id and stored data kept.`);
  if (!result.persisted) {
    // The in-memory move worked but the config did not record it, so the old
    // path comes back on the next boot. Better said out loud than discovered.
    console.log(
      "WARNING: this was not written to ~/.apx/config.json — the old path will return on the next daemon restart."
    );
  }
}

export async function cmdProjectRemove(args) {
  const target = args._[0];
  if (!target) throw new Error("apx project remove: missing <path|id>");
  const projects = await http.get("/api/projects");
  let id;
  if (/^\d+$/.test(target)) id = parseInt(target, 10);
  else {
    const abs = path.resolve(target);
    const found = projects.find((p) => p.path === abs);
    if (!found) throw new Error(`not registered: ${target}`);
    id = found.id;
  }
  await http.delete(`/api/projects/${id}`);
  console.log(`Removed project #${id}`);
}

export async function cmdProjectRebuild(args) {
  const target = args._[0];
  let id;
  if (target) {
    if (/^\d+$/.test(target)) id = parseInt(target, 10);
    else {
      const abs = path.resolve(target);
      const projects = await http.get("/api/projects");
      const found = projects.find((p) => p.path === abs);
      if (!found) throw new Error(`not registered: ${target}`);
      id = found.id;
    }
  } else {
    const root = requireRoot();
    const projects = await http.get("/api/projects");
    const found = projects.find((p) => p.path === root);
    if (!found) throw new Error(`current project not registered — run \`apx project add .\``);
    id = found.id;
  }
  const result = await http.post(`/api/projects/${id}/rebuild`);
  console.log(`Rebuilt project #${id}: ${result.agents} agents`);
}

/**
 * The filesystem root of a project, from the same selectors resolveProjectId
 * accepts (numeric id, path, exact name, fuzzy name/path).
 *
 * WHY THIS EXISTS. Commands that edit files under `.apc/` need the path, not the
 * id, and they all resolved it by walking up from cwd. So `apx agent set magui
 * --tools …` run from anywhere but that one checkout failed with "not inside an
 * APC project (run `apx init` first)" — advice that would have scaffolded a
 * second project on top of the shell's cwd instead of editing the agent the
 * user named. `--project` already works everywhere else; now it works here.
 */
export async function resolveProjectRoot(target) {
  if (target === true) {
    throw new Error("--project needs a value: a project name, id, or path (`apx project list` shows them)");
  }
  if (target === undefined || target === null || target === "") {
    const root = findApfRoot();
    if (root) return root;
    throw new Error(
      "not inside an APC project — cd into one, run `apx init` here, or name the project with --project <name|id|path>"
    );
  }
  const id = await resolveProjectId(target);
  const projects = await http.get("/api/projects");
  const found = projects.find((p) => Number(p.id) === Number(id));
  if (!found) throw new Error(`--project "${target}" is not registered — run \`apx project list\``);
  return found.path;
}

// Resolve a project id from one of:
//   numeric id   ("2")
//   absolute path ("/abs/path/to/project")
//   relative path (resolved against cwd)
//   project name ("APX testing sandbox")
// Falls back to walking up from cwd if `target` is null/undefined.
export async function resolveProjectId(target) {
  if (target !== undefined && target !== null && target !== "") {
    if (typeof target === "number" || /^\d+$/.test(String(target))) {
      return parseInt(target, 10);
    }
    const projects = await http.get("/api/projects");
    const tgt = String(target);

    // exact path
    const abs = path.resolve(tgt);
    const byPath = projects.find((p) => p.path === abs);
    if (byPath) return byPath.id;

    // exact name
    const byName = projects.find((p) => p.name === tgt);
    if (byName) return byName.id;

    // case-insensitive substring on name OR full path — friendly default
    const tgtLow = tgt.toLowerCase();
    const fuzzy = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(tgtLow) ||
        p.path.toLowerCase().includes(tgtLow)
    );
    if (fuzzy.length === 1) return fuzzy[0].id;
    if (fuzzy.length > 1) {
      throw new Error(
        `--project "${tgt}" is ambiguous; matches: ${fuzzy.map((p) => `${p.id}/${p.name}`).join(", ")}`
      );
    }
    throw new Error(`--project "${tgt}" not found in registered projects`);
  }

  // No override: walk up from cwd
  const root = findApfRoot();
  if (!root) {
    // Fall back to the default project (id=0) — always available, no .apc/ required.
    return 0;
  }
  const projects = await http.get("/api/projects");
  const found = projects.find((p) => p.path === root);
  if (found) return found.id;
  // auto-register
  const result = await http.post("/api/projects", { path: root });
  return result.id;
}
