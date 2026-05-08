import path from "node:path";
import { findApfRoot } from "../../core/parser.js";
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
  const result = await http.post("/projects", { path: path.resolve(target) });
  console.log(`Registered #${result.id}: ${result.path}`);
}

export async function cmdProjectList() {
  const projects = await http.get("/projects");
  if (projects.length === 0) {
    console.log("(no projects registered — try `apx project add .`)");
    return;
  }
  console.log("ID\tNAME\t\t\tAGENTS\tPATH");
  for (const p of projects) {
    console.log(`${p.id}\t${p.name}\t\t${p.agents}\t${p.path}`);
  }
}

export async function cmdProjectRemove(args) {
  const target = args._[0];
  if (!target) throw new Error("apx project remove: missing <path|id>");
  const projects = await http.get("/projects");
  let id;
  if (/^\d+$/.test(target)) id = parseInt(target, 10);
  else {
    const abs = path.resolve(target);
    const found = projects.find((p) => p.path === abs);
    if (!found) throw new Error(`not registered: ${target}`);
    id = found.id;
  }
  await http.delete(`/projects/${id}`);
  console.log(`Removed project #${id}`);
}

export async function cmdProjectRebuild(args) {
  const target = args._[0];
  let id;
  if (target) {
    if (/^\d+$/.test(target)) id = parseInt(target, 10);
    else {
      const abs = path.resolve(target);
      const projects = await http.get("/projects");
      const found = projects.find((p) => p.path === abs);
      if (!found) throw new Error(`not registered: ${target}`);
      id = found.id;
    }
  } else {
    const root = requireRoot();
    const projects = await http.get("/projects");
    const found = projects.find((p) => p.path === root);
    if (!found) throw new Error(`current project not registered — run \`apx project add .\``);
    id = found.id;
  }
  const result = await http.post(`/projects/${id}/rebuild`);
  console.log(`Rebuilt project #${id}: ${result.agents} agents`);
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
    const projects = await http.get("/projects");
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
    const registered = await http.get("/projects").catch(() => []);
    const hint = registered.length
      ? `registered projects: ${registered.map((p) => `"${p.name}" (id ${p.id})`).join(", ")}`
      : "no projects registered yet — run `apx project add <path>` first";
    throw new Error(`not inside an APC project. Use --project <name|id|path>. ${hint}`);
  }
  const projects = await http.get("/projects");
  const found = projects.find((p) => p.path === root);
  if (found) return found.id;
  // auto-register
  const result = await http.post("/projects", { path: root });
  return result.id;
}
