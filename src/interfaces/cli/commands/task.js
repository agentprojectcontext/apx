// apx task — per-project TODO list. Backed by /projects/:pid/tasks.
//
//   apx task add "<title>" [--project X] [--body Y] [--tag t] [--due 2026-05-30] [--agent A]
//   apx task list          [--project X] [--state open|done|dropped|all] [--tag X] [--agent Y] [--due-before ISO] [--limit N]
//   apx task show <id>     [--project X]
//   apx task done <id>     [--project X] [--by name]
//   apx task drop <id>     [--project X] [--by name]
//   apx task reopen <id>   [--project X]
//   apx task patch <id>    [--project X] [--title T] [--body B] [--due D] [--agent A] [--tag t]
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

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

export async function cmdTaskAdd(args) {
  const title = (args._ || []).join(" ").trim();
  if (!title) {
    console.error("apx task add: title required");
    process.exit(1);
  }
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

export async function cmdTaskShow(args) {
  const id = (args._ || [])[0];
  if (!id) { console.error("apx task show: id required"); process.exit(1); }
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.get(`/projects/${pid}/tasks/${encodeURIComponent(id)}`);
  renderDetail(t);
}

export async function cmdTaskDone(args) {
  const id = (args._ || [])[0];
  if (!id) { console.error("apx task done: id required"); process.exit(1); }
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(
    `/projects/${pid}/tasks/${encodeURIComponent(id)}/done`,
    { by: args.flags?.by || null }
  );
  console.log(`done: ${t.id} — ${t.title}`);
}

export async function cmdTaskDrop(args) {
  const id = (args._ || [])[0];
  if (!id) { console.error("apx task drop: id required"); process.exit(1); }
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(
    `/projects/${pid}/tasks/${encodeURIComponent(id)}/drop`,
    { by: args.flags?.by || null }
  );
  console.log(`dropped: ${t.id} — ${t.title}`);
}

export async function cmdTaskReopen(args) {
  const id = (args._ || [])[0];
  if (!id) { console.error("apx task reopen: id required"); process.exit(1); }
  const pid = await resolveProjectId(args?.flags?.project);
  const t = await http.post(`/projects/${pid}/tasks/${encodeURIComponent(id)}/reopen`);
  console.log(`reopened: ${t.id} — ${t.title}`);
}

export async function cmdTaskPatch(args) {
  const id = (args._ || [])[0];
  if (!id) { console.error("apx task patch: id required"); process.exit(1); }
  const pid = await resolveProjectId(args?.flags?.project);
  const patch = {};
  if (args.flags?.title !== undefined) patch.title = args.flags.title;
  if (args.flags?.body  !== undefined) patch.body  = args.flags.body;
  if (args.flags?.due   !== undefined) patch.due   = args.flags.due || null;
  if (args.flags?.agent !== undefined) patch.agent = args.flags.agent || null;
  if (args.flags?.tag   !== undefined) patch.tags  = asArray(args.flags.tag).filter(Boolean);
  if (Object.keys(patch).length === 0) {
    console.error("apx task patch: at least one --title|--body|--due|--agent|--tag required");
    process.exit(1);
  }
  const t = await http.patch(`/projects/${pid}/tasks/${encodeURIComponent(id)}`, { patch });
  renderDetail(t);
}
