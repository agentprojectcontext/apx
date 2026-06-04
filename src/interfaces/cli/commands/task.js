// apx task — per-project TODO list. Backed by /projects/:pid/tasks.
//
//   apx task add "<title>" [--project X] [--body Y] [--tag t] [--due 2026-05-30] [--agent A]
//   apx task list          [--project X] [--state open|done|dropped|all] [--tag X] [--agent Y] [--due-before ISO] [--limit N]
//   apx task show <id>     [--project X]
//   apx task done <id>     [--project X] [--by name]
//   apx task drop <id>     [--project X] [--by name]
//   apx task reopen <id>   [--project X]
//   apx task patch <id>    [--project X] [--title T] [--body B] [--due D] [--agent A] [--tag t]
//
// Each subcommand exports a usage string + a usageX() helper. The top-level
// help (apx task --help / apx task <sub> --help) is wired through HELP_TOPICS
// in src/interfaces/cli/index.js, but these inline helpers keep the
// "wrong args" path readable from the command itself.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

// ── Usage strings (also used by index.js help topics) ────────────────────────
export const TASK_USAGE = {
  add:    'apx task add "<title>" [--project X] [--body Y] [--tag t]... [--due 2026-05-30] [--agent A]',
  list:   "apx task list [--project X] [--state open|done|dropped|all] [--tag X] [--agent Y] [--due-before ISO] [--limit N]",
  show:   "apx task show <id> [--project X]",
  done:   "apx task done <id> [--project X] [--by name]",
  drop:   "apx task drop <id> [--project X] [--by name]",
  reopen: "apx task reopen <id> [--project X]",
  patch:  "apx task patch <id> [--project X] [--title T] [--body B] [--due D] [--agent A] [--tag t]",
};

// Print "<msg>\nUsage: <usage>" to stderr and exit 1. Each cmd has a tiny
// wrapper so errors point at the right usage line.
function fail(sub, msg) {
  console.error(`apx task ${sub}: ${msg}`);
  console.error(`Usage: ${TASK_USAGE[sub]}`);
  process.exit(1);
}

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function shortTs(iso) {
  if (!iso) return "";
  return String(iso).replace(/T/, " ").replace(/Z$/, "").slice(0, 16);
}

function renderTable(rows) {
  if (!rows.length) {
    console.log("(no tasks)");
    return;
  }
  const idW = Math.max(...rows.map((r) => r.id.length), 4);
  console.log(
    "ID".padEnd(idW) + "  " +
    "STATE".padEnd(7) + "  " +
    "DUE".padEnd(10) + "  " +
    "TAGS".padEnd(18) + "  " +
    "TITLE"
  );
  for (const t of rows) {
    const tags = (t.tags || []).join(",").slice(0, 18).padEnd(18);
    const title = (t.title || "").slice(0, 60);
    console.log(
      t.id.padEnd(idW) + "  " +
      (t.state || "open").padEnd(7) + "  " +
      (t.due || "—").padEnd(10) + "  " +
      tags + "  " +
      title
    );
  }
}

function renderDetail(t) {
  console.log(JSON.stringify({
    id: t.id,
    state: t.state,
    title: t.title,
    body: t.body,
    tags: t.tags,
    due: t.due,
    agent: t.agent,
    source: t.source,
    created_at: shortTs(t.created_at),
    updated_at: shortTs(t.updated_at),
    done_at: t.done_at ? shortTs(t.done_at) : undefined,
    dropped_at: t.dropped_at ? shortTs(t.dropped_at) : undefined,
  }, null, 2));
}

// ── add ───────────────────────────────────────────────────────────────────────
export async function cmdTaskAdd(args) {
  const title = (args._ || []).join(" ").trim();
  if (!title) return fail("add", "title required");
  const pid = await resolveProjectId(args?.flags?.project);
  const body = {
    title,
    body: args.flags?.body || null,
    due: args.flags?.due || null,
    agent: args.flags?.agent || null,
    source: args.flags?.source || "cli",
    tags: asArray(args.flags?.tag).filter(Boolean),
  };
  const task = await http.post(`/projects/${pid}/tasks`, body);
  console.log(`added task ${task.id}: ${task.title}`);
}

// ── list ──────────────────────────────────────────────────────────────────────
export async function cmdTaskList(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const params = new URLSearchParams();
  if (args.flags?.state)          params.set("state", args.flags.state);
  if (args.flags?.tag)            params.set("tag", args.flags.tag);
  if (args.flags?.agent)          params.set("agent", args.flags.agent);
  if (args.flags?.["due-before"]) params.set("due_before", args.flags["due-before"]);
  if (args.flags?.limit)          params.set("limit", String(args.flags.limit));
  const qs = params.toString();
  const rows = await http.get(`/projects/${pid}/tasks${qs ? "?" + qs : ""}`);
  renderTable(rows);
}

// ── show ──────────────────────────────────────────────────────────────────────
export async function cmdTaskShow(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("show", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.get(`/projects/${pid}/tasks/${encodeURIComponent(id)}`);
  renderDetail(t);
}

// ── done ──────────────────────────────────────────────────────────────────────
export async function cmdTaskDone(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("done", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(
    `/projects/${pid}/tasks/${encodeURIComponent(id)}/done`,
    { by: args.flags?.by || null }
  );
  console.log(`done: ${t.id} — ${t.title}`);
}

// ── drop ──────────────────────────────────────────────────────────────────────
export async function cmdTaskDrop(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("drop", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(
    `/projects/${pid}/tasks/${encodeURIComponent(id)}/drop`,
    { by: args.flags?.by || null }
  );
  console.log(`dropped: ${t.id} — ${t.title}`);
}

// ── reopen ────────────────────────────────────────────────────────────────────
export async function cmdTaskReopen(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("reopen", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(`/projects/${pid}/tasks/${encodeURIComponent(id)}/reopen`);
  console.log(`reopened: ${t.id} — ${t.title}`);
}

// ── patch ─────────────────────────────────────────────────────────────────────
export async function cmdTaskPatch(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("patch", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const patch = {};
  if (args.flags?.title !== undefined) patch.title = args.flags.title;
  if (args.flags?.body  !== undefined) patch.body  = args.flags.body;
  if (args.flags?.due   !== undefined) patch.due   = args.flags.due || null;
  if (args.flags?.agent !== undefined) patch.agent = args.flags.agent || null;
  if (args.flags?.tag   !== undefined) patch.tags  = asArray(args.flags.tag).filter(Boolean);
  if (Object.keys(patch).length === 0) {
    return fail("patch", "at least one --title|--body|--due|--agent|--tag required");
  }
  const t = await http.patch(`/projects/${pid}/tasks/${encodeURIComponent(id)}`, { patch });
  renderDetail(t);
}
