// apx commitment — what you promised, to whom, by when.
//
//   apx commitment add "<what>" --to "<person>" [--due 2026-05-30] [--project X]
//                              [--channel telegram] [--ref <message id>]
//   apx commitment list        [--all | --project X] [--to X] [--state open|kept|missed|all]
//                              [--overdue] [--due-before ISO] [--limit N]
//   apx commitment show <id>   [--project X]
//   apx commitment kept <id>   [--project X] [--note "..."]
//   apx commitment missed <id> [--project X] [--note "..."]
//   apx commitment renegotiate <id> --due <ISO> [--project X] [--note "..."]
//
// A task is something to do; a commitment is something you promised a person.
// Kept separate on purpose — see core/stores/commitments.js.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export const COMMITMENT_USAGE = {
  add:         'apx commitment add "<what>" --to "<person>" [--due ISO] [--project X] [--channel C] [--ref R]',
  list:        "apx commitment list [--all | --project X] [--to X] [--state open|kept|missed|all] [--overdue] [--due-before ISO] [--limit N]",
  show:        "apx commitment show <id> [--project X]",
  kept:        'apx commitment kept <id> [--project X] [--note "..."]',
  missed:      'apx commitment missed <id> [--project X] [--note "..."]',
  renegotiate: 'apx commitment renegotiate <id> --due <ISO> [--project X] [--note "..."]',
};

function fail(sub, msg) {
  console.error(`apx commitment ${sub}: ${msg}`);
  console.error(`Usage: ${COMMITMENT_USAGE[sub]}`);
  process.exit(1);
}

function shortDate(iso) {
  if (!iso) return "";
  return String(iso).replace(/T/, " ").replace(/Z$/, "").slice(0, 16);
}

/** Is this promise past its date and still open? */
function isOverdue(c) {
  return c.state === "open" && c.due && c.due < new Date().toISOString();
}

function renderTable(rows, { showProject = false } = {}) {
  if (!rows.length) {
    console.log("(no commitments)");
    return;
  }
  const idW = Math.max(...rows.map((r) => String(r.id).length), 2);
  const whoW = Math.min(Math.max(...rows.map((r) => String(r.counterparty || "").length), 3), 20);
  const projW = showProject
    ? Math.min(Math.max(...rows.map((r) => String(r.project_name || "").length), 7), 18)
    : 0;

  for (const c of rows) {
    const proj = showProject
      ? String(c.project_name || "").slice(0, projW).padEnd(projW) + "  "
      : "";
    // The flag carries the whole point of the type: a broken promise should be
    // impossible to skim past.
    const flag =
      c.state === "kept" ? "✓" :
      c.state === "missed" ? "✗" :
      isOverdue(c) ? "!" : " ";
    const moved = c.renegotiated_count ? ` (moved ×${c.renegotiated_count})` : "";
    console.log(
      `${flag} ${String(c.id).padEnd(idW)}  ${proj}` +
      `${String(c.counterparty || "").slice(0, whoW).padEnd(whoW)}  ` +
      `${(c.due ? shortDate(c.due).slice(0, 10) : "—").padEnd(10)}  ` +
      `${String(c.body || "").slice(0, 48)}${moved}`
    );
  }
  const overdue = rows.filter(isOverdue).length;
  if (overdue) console.log(`\n${overdue} past their date.`);
}

export async function cmdCommitmentAdd(args) {
  const body = args?._?.[0];
  const to = args?.flags?.to;
  if (!body) fail("add", "what you promised is required");
  if (!to) fail("add", "--to <person> is required — without a counterparty this is a task");

  const pid = await resolveProjectId(args);
  const created = await http("POST", `/projects/${pid}/commitments`, {
    counterparty: to,
    body,
    due: args?.flags?.due || null,
    origin_channel: args?.flags?.channel || "cli",
    origin_message_ref: args?.flags?.ref || null,
  });
  console.log(`${created.id}  → ${created.counterparty}${created.due ? ` by ${shortDate(created.due).slice(0, 10)}` : ""}`);
  console.log(`  ${created.body}`);
}

export async function cmdCommitmentList(args) {
  const f = args?.flags || {};
  const q = new URLSearchParams();
  if (f.state) q.set("state", f.state);
  if (f.to) q.set("counterparty", f.to);
  if (f.overdue) q.set("overdue", "1");
  if (f["due-before"]) q.set("due_before", f["due-before"]);
  if (f.limit) q.set("limit", f.limit);

  if (f.all) {
    const { data } = await http("GET", `/commitments?${q.toString()}`);
    renderTable(data || [], { showProject: true });
    return;
  }
  const pid = await resolveProjectId(args);
  const { data } = await http("GET", `/projects/${pid}/commitments?${q.toString()}`);
  renderTable(data || []);
}

export async function cmdCommitmentShow(args) {
  const id = args?._?.[0];
  if (!id) fail("show", "id required");
  const pid = await resolveProjectId(args);
  const c = await http("GET", `/projects/${pid}/commitments/${encodeURIComponent(id)}`);
  console.log(`${c.id}  [${c.state}${isOverdue(c) ? " · OVERDUE" : ""}]`);
  console.log(`  To:        ${c.counterparty}`);
  console.log(`  What:      ${c.body}`);
  console.log(`  Promised:  ${shortDate(c.promised_at)}${c.origin_channel ? ` on ${c.origin_channel}` : ""}`);
  console.log(`  Due:       ${c.due ? shortDate(c.due) : "(no date)"}`);
  if (c.note) console.log(`  Note:      ${c.note}`);
  // The history is the relationship record — print it, it is the reason the
  // renegotiate event exists at all.
  for (const h of c.history || []) {
    console.log(`  Moved:     ${shortDate(h.due)?.slice(0, 10) || "?"} → (on ${shortDate(h.moved_at)})${h.note ? ` — ${h.note}` : ""}`);
  }
}

async function close(args, sub) {
  const id = args?._?.[0];
  if (!id) fail(sub, "id required");
  const pid = await resolveProjectId(args);
  const c = await http("POST", `/projects/${pid}/commitments/${encodeURIComponent(id)}/${sub}`, {
    note: args?.flags?.note || null,
  });
  console.log(`${c.id} → ${c.state}`);
}

export const cmdCommitmentKept = (args) => close(args, "kept");
export const cmdCommitmentMissed = (args) => close(args, "missed");

export async function cmdCommitmentRenegotiate(args) {
  const id = args?._?.[0];
  const due = args?.flags?.due;
  if (!id) fail("renegotiate", "id required");
  if (!due) fail("renegotiate", "--due <ISO> is required — a promise with no new date is a promise that vanished");
  const pid = await resolveProjectId(args);
  const c = await http("POST", `/projects/${pid}/commitments/${encodeURIComponent(id)}/renegotiate`, {
    due,
    note: args?.flags?.note || null,
  });
  console.log(`${c.id} → new date ${shortDate(c.due).slice(0, 10)} (moved ×${c.renegotiated_count})`);
}
