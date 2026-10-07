// apx task — per-project TODO list. Backed by /projects/:pid/tasks.
//
//   apx task add "<title>" [--project X] [--description D] [--body Y] [--tag t]
//                          [--due 2026-05-30] [--agent A]
//                          [--category trip] [--place "Farmacia X"] [--at "-41.13,-71.31"] [--radius 1500]
//   apx task list          [--all | --project X] [--state ...] [--status ...] [--tag X] [--agent Y]
//                          [--due-before ISO] [--due-after ISO] [--updated-since ISO] [--limit N]
//   apx task summary       [--project X]
//   apx task show <id>     [--project X]
//   apx task done <id>     [--project X] [--by name]
//   apx task drop <id>     [--project X] [--by name]
//   apx task reopen <id>   [--project X]
//   apx task depend <id>   --on <id> [--reason R] [--owner O] [--condition C] [--project X]
//   apx task undepend <id> --on <id> --reason R [--project X]
//   apx task patch <id>    [--project X] [--title T] [--description D] [--body B] [--due D]
//                          [--agent A] [--tag t]
//
// --description is what YOU have to do; --body is the prompt an agent receives
// when it runs the task. Keeping them apart is what makes `apx task list`
// readable as a to-do rather than as a dispatch queue.
//
// Each subcommand exports a usage string + a usageX() helper. The top-level
// help (apx task --help / apx task <sub> --help) is wired through HELP_TOPICS
// in src/interfaces/cli/index.js, but these inline helpers keep the
// "wrong args" path readable from the command itself.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

// ── Usage strings (also used by index.js help topics) ────────────────────────
export const TASK_USAGE = {
  add:    'apx task add "<title>" [--project X] [--description D] [--body Y] [--tag t]... [--due 2026-05-30] [--agent A] [--category trip] [--place "Farmacia X"] [--at "lat,lon"] [--radius 1500]',
  list:   "apx task list [--all | --project X] [--state open|done|dropped|all] [--status pending|running|in_review|blocked|<column>] [--tag X] [--agent Y] [--due-before ISO] [--due-after ISO] [--updated-since ISO] [--limit N]",
  summary: "apx task summary [--project X]",
  show:   "apx task show <id> [--project X]",
  done:   "apx task done <id> [--project X] [--by name]",
  drop:   "apx task drop <id> [--project X] [--by name]",
  reopen: "apx task reopen <id> [--project X]",
  depend: "apx task depend <id> --on <id> [--reason R] [--owner O] [--condition C] [--project X]",
  undepend: "apx task undepend <id> --on <id> --reason R [--project X]",
  patch:  "apx task patch <id> [--project X] [--title T] [--description D] [--body B] [--due D] [--agent A] [--tag t]",
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

function renderTable(rows, { showProject = false, filters = null } = {}) {
  if (!rows.length) {
    // A filtered empty list is "nothing matches", never "there are no tasks".
    const f = filters && Object.keys(filters).length
      ? Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(" ")
      : "";
    console.log(f ? `(no tasks match ${f} — try \`apx task summary\` for the full picture)` : "(no tasks)");
    return;
  }
  const idW = Math.max(...rows.map((r) => String(r.id).length), 4);
  const projW = showProject
    ? Math.min(Math.max(...rows.map((r) => String(r.project_name || "").length), 7), 20)
    : 0;
  const proj = (t) => (showProject ? String(t.project_name || "").slice(0, projW).padEnd(projW) + "  " : "");

  console.log(
    "ID".padEnd(idW) + "  " +
    (showProject ? "PROJECT".padEnd(projW) + "  " : "") +
    "STATE".padEnd(7) + "  " +
    "DUE".padEnd(10) + "  " +
    "TAGS".padEnd(18) + "  " +
    "TITLE"
  );
  for (const t of rows) {
    const tags = (t.tags || []).join(",").slice(0, 18).padEnd(18);
    const title = (t.title || "").slice(0, 60);
    console.log(
      String(t.id).padEnd(idW) + "  " +
      proj(t) +
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
    description: t.description || undefined,
    body: t.body,
    tags: t.tags,
    // Only when it says something: a "general" category on every row is noise,
    // and an absent location should read as absent rather than as null.
    category: t.category && t.category !== "general" ? t.category : undefined,
    location: t.location || undefined,
    due: t.due,
    agent: t.agent,
    source: t.source,
    created_at: shortTs(t.created_at),
    updated_at: shortTs(t.updated_at),
    done_at: t.done_at ? shortTs(t.done_at) : undefined,
    dropped_at: t.dropped_at ? shortTs(t.dropped_at) : undefined,
    // Evidence of work, apart from the column: same view the panel draws.
    execution: t.execution || undefined,
  }, null, 2));
}

/**
 * Build the `location` field from the place flags, or return {} when none were
 * given so a patch that touches nothing else stays a no-op.
 *
 * `--at` takes "lat,lon" as one argument because that is how coordinates are
 * copied out of Maps — asking for two separate flags guarantees one of them is
 * eventually forgotten, and half a coordinate is worse than none.
 */
function locationFrom(flags = {}) {
  const place = flags.place;
  const address = flags.address;
  const at = flags.at;
  const radius = flags.radius;
  if (place === undefined && address === undefined && at === undefined && radius === undefined) return {};
  // An explicitly empty --place clears the location.
  if (place === "" && at === undefined && address === undefined) return { location: null };
  const location = {};
  if (place) location.place = place;
  if (address) location.address = address;
  if (at) {
    const [lat, lon] = String(at).split(",").map((part) => Number(part.trim()));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      location.latitude = lat;
      location.longitude = lon;
    }
  }
  if (radius) location.radius_m = Number(radius);
  return { location };
}

// ── add ───────────────────────────────────────────────────────────────────────
export async function cmdTaskAdd(args) {
  const title = (args._ || []).join(" ").trim();
  if (!title) return fail("add", "title required");
  const pid = await resolveProjectId(args?.flags?.project);
  const body = {
    title,
    description: args.flags?.description || null,
    body: args.flags?.body || null,
    due: args.flags?.due || null,
    agent: args.flags?.agent || null,
    source: args.flags?.source || "cli",
    tags: asArray(args.flags?.tag).filter(Boolean),
    ...(args.flags?.category ? { category: args.flags.category } : {}),
    ...locationFrom(args.flags),
  };
  const task = await http.post(`/api/projects/${pid}/tasks`, body);
  console.log(`added task ${task.id}: ${task.title}`);
}

// ── list ──────────────────────────────────────────────────────────────────────
// The list endpoints answer with a { meta, data } envelope. Older callers here
// treated the response as a bare array, which made `apx task list` print
// "(no tasks)" no matter what — the rows were sitting in `.data`.
function unwrap(res) {
  if (Array.isArray(res)) return { rows: res, meta: null };
  return { rows: Array.isArray(res?.data) ? res.data : [], meta: res?.meta || null };
}

export async function cmdTaskList(args) {
  const params = new URLSearchParams();
  if (args.flags?.state)             params.set("state", args.flags.state);
  if (args.flags?.tag)               params.set("tag", args.flags.tag);
  if (args.flags?.agent)             params.set("agent", args.flags.agent);
  if (args.flags?.status)            params.set("status", args.flags.status);
  if (args.flags?.["due-before"])    params.set("due_before", args.flags["due-before"]);
  if (args.flags?.["due-after"])     params.set("due_after", args.flags["due-after"]);
  if (args.flags?.["updated-since"]) params.set("updated_since", args.flags["updated-since"]);
  if (args.flags?.limit)             params.set("limit", String(args.flags.limit));
  const qs = params.toString();

  // --all folds every registered project into one list, each row carrying the
  // project it came from. Without it, behaviour is exactly as before.
  const all = !!args.flags?.all;
  const path = all
    ? `/api/tasks${qs ? "?" + qs : ""}`
    : `/api/projects/${await resolveProjectId(args?.flags?.project)}/tasks${qs ? "?" + qs : ""}`;

  const { rows, meta } = unwrap(await http.get(path));
  renderTable(rows, { showProject: all, filters: Object.fromEntries(params) });

  // A project whose task log could not be read is reported, never swallowed.
  for (const s of meta?.skipped || []) {
    console.error(`warning: project #${s.id} skipped — ${s.error}`);
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
// The same aggregator as the panel and the agent's list_tasks {summary:true}.
export async function cmdTaskSummary(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const s = await http.get(`/api/projects/${pid}/tasks-summary`);
  if (args.flags?.json) return console.log(JSON.stringify(s, null, 2));
  console.log(`open ${s.open} · done ${s.done} · dropped ${s.dropped} · total ${s.total}` +
    (s.overdue ? ` · overdue ${s.overdue}` : ""));
  for (const [col, n] of Object.entries(s.status || {})) console.log(`  ${col.padEnd(12)} ${n}`);
  if (s.attention?.awaits_owner) console.log(`waiting on you: ${s.attention.awaits_owner}`);
  if (s.attention?.blocked_by_owner) console.log(`blocked on you: ${s.attention.blocked_by_owner}`);
}

// ── show ──────────────────────────────────────────────────────────────────────
export async function cmdTaskShow(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("show", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.get(`/api/projects/${pid}/tasks/${encodeURIComponent(id)}`);
  renderDetail(t);
}

// ── done ──────────────────────────────────────────────────────────────────────
export async function cmdTaskDone(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("done", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(
    `/api/projects/${pid}/tasks/${encodeURIComponent(id)}/done`,
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
    `/api/projects/${pid}/tasks/${encodeURIComponent(id)}/drop`,
    { by: args.flags?.by || null }
  );
  console.log(`dropped: ${t.id} — ${t.title}`);
}

// ── reopen ────────────────────────────────────────────────────────────────────
export async function cmdTaskReopen(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("reopen", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(`/api/projects/${pid}/tasks/${encodeURIComponent(id)}/reopen`);
  console.log(`reopened: ${t.id} — ${t.title}`);
}

// ── depend / undepend ─────────────────────────────────────────────────────────
// <id> waits on --on. Lifting a wait takes a reason, so it is never silent.
export async function cmdTaskDepend(args) {
  const id = (args._ || [])[0];
  const on = args.flags?.on;
  if (!id || !on) return fail("depend", "id and --on required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(`/api/projects/${pid}/tasks/${encodeURIComponent(id)}/dependencies`, {
    on, reason: args.flags?.reason || null, owner: args.flags?.owner || null, condition: args.flags?.condition || null,
  });
  console.log(`${t.id} now waits on: ${(t.depends_on || []).map((d) => `${d.task_id} (${d.state})`).join(", ")}`);
}

export async function cmdTaskUndepend(args) {
  const id = (args._ || [])[0];
  const on = args.flags?.on;
  const reason = args.flags?.reason;
  if (!id || !on || !reason) return fail("undepend", "id, --on and --reason required");
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.delete(`/api/projects/${pid}/tasks/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(on)}?reason=${encodeURIComponent(reason)}`);
  console.log(`${t.id} no longer waits on ${on}`);
}

// ── patch ─────────────────────────────────────────────────────────────────────
export async function cmdTaskPatch(args) {
  const id = (args._ || [])[0];
  if (!id) return fail("patch", "id required");
  const pid = await resolveProjectId(args?.flags?.project);
  const patch = {};
  if (args.flags?.title !== undefined) patch.title = args.flags.title;
  if (args.flags?.description !== undefined) patch.description = args.flags.description || null;
  if (args.flags?.body  !== undefined) patch.body  = args.flags.body;
  if (args.flags?.due   !== undefined) patch.due   = args.flags.due || null;
  if (args.flags?.agent !== undefined) patch.agent = args.flags.agent || null;
  if (args.flags?.tag   !== undefined) patch.tags  = asArray(args.flags.tag).filter(Boolean);
  if (args.flags?.category !== undefined) patch.category = args.flags.category;
  const located = locationFrom(args.flags);
  if ("location" in located) patch.location = located.location;
  if (Object.keys(patch).length === 0) {
    return fail("patch", "at least one --title|--description|--body|--due|--agent|--tag|--category|--place|--at required");
  }
  const t = await http.patch(`/api/projects/${pid}/tasks/${encodeURIComponent(id)}`, { patch });
  renderDetail(t);
}
