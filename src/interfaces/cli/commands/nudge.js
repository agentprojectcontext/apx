// apx nudge — the interruption budget: what APX said without being asked,
// what you thought of it, and how much room is left.
//
//   apx nudge status
//   apx nudge list    [--limit N] [--kind K] [--project P] [--rated | --unrated]
//   apx nudge set     [--enabled true|false] [--daily-max N] [--quiet 22:00-07:30]
//                     [--cooldown N] [--project-cooldown N] [--kind-cooldown N]
//   apx nudge check   --kind K [--severity critical]
//   apx nudge feedback <id> --useful | --noise [--note "..."]
import { http } from "../http.js";

export const NUDGE_USAGE = {
  status:   "apx nudge status",
  list:     "apx nudge list [--limit N] [--kind K] [--project P] [--rated|--unrated]",
  set:      "apx nudge set [--enabled true|false] [--daily-max N] [--quiet HH:MM-HH:MM] [--cooldown N] [--project-cooldown N] [--kind-cooldown N]",
  check:    "apx nudge check --kind K [--severity low|normal|high|critical]",
  feedback: 'apx nudge feedback <id> --useful|--noise [--note "..."]',
};

function fail(sub, msg) {
  console.error(`apx nudge ${sub}: ${msg}`);
  console.error(`Usage: ${NUDGE_USAGE[sub]}`);
  process.exit(1);
}

function shortTs(iso) {
  if (!iso) return "";
  return String(iso).replace(/T/, " ").replace(/Z$/, "").slice(0, 16);
}

export async function cmdNudgeStatus() {
  const { policy, source, user_overrides } = await http("GET", "/nudges/policy");
  const { meta } = await http("GET", "/nudges?limit=1");
  const stats = meta?.stats || { total: 0, today: 0, rated: 0, by_kind: [] };

  if (!policy.enabled) {
    console.log("interruption budget: OFF — every unrequested message goes out.");
    console.log("  Nothing is blocked, but everything is still recorded below.");
    console.log("  Turn it on: apx nudge set --enabled true --daily-max 3");
  } else {
    const left = policy.daily_max > 0 ? Math.max(0, policy.daily_max - stats.today) : "∞";
    console.log(`interruption budget: ON — ${stats.today} sent today, ${left} left`);
    if (policy.daily_max > 0) console.log(`  Daily max:      ${policy.daily_max}`);
    if (policy.quiet_hours)   console.log(`  Quiet hours:    ${policy.quiet_hours}`);
    if (policy.cooldown_minutes) console.log(`  Cooldown:       ${policy.cooldown_minutes}m between any two`);
    if (policy.project_cooldown_minutes) console.log(`  Per project:    ${policy.project_cooldown_minutes}m`);
    if (policy.kind_cooldown_minutes)    console.log(`  Per kind:       ${policy.kind_cooldown_minutes}m`);
    console.log(`  Critical:       ${policy.critical_bypasses_budget ? "may bypass (logged)" : "no bypass"}`);
  }
  // Provenance matters: a number the user did not choose should say who did.
  console.log(`  Set by:         ${source.join(" → ")}`);
  if (Object.keys(user_overrides || {}).length) {
    console.log(`  Your overrides: ${Object.entries(user_overrides).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  console.log("");
  console.log(`recorded: ${stats.total} total, ${stats.rated} rated`);
  for (const k of stats.by_kind.slice(0, 8)) {
    const verdict = k.useful || k.noise ? `  (👍 ${k.useful} / 👎 ${k.noise})` : "";
    console.log(`  ${k.kind.padEnd(18)} ${String(k.sent).padStart(4)}${verdict}`);
  }
}

export async function cmdNudgeList(args) {
  const q = new URLSearchParams();
  if (args?.flags?.limit) q.set("limit", args.flags.limit);
  if (args?.flags?.kind) q.set("kind", args.flags.kind);
  if (args?.flags?.project) q.set("project_id", args.flags.project);
  if (args?.flags?.rated) q.set("with_feedback", "1");
  if (args?.flags?.unrated) q.set("with_feedback", "0");

  const { data } = await http("GET", `/nudges?${q.toString()}`);
  if (!data?.length) {
    console.log("(nothing sent unprompted yet)");
    return;
  }
  const idW = Math.max(...data.map((r) => r.id.length), 2);
  const kindW = Math.max(...data.map((r) => String(r.kind).length), 4);
  for (const row of data) {
    const rating = row.feedback ? (row.feedback.useful ? "👍" : "👎") : "  ";
    const flag = row.bypassed_budget ? " ⚠︎bypass" : "";
    console.log(
      `${row.id.padEnd(idW)}  ${shortTs(row.at)}  ${rating}  ` +
      `${String(row.kind).padEnd(kindW)}  ${String(row.preview || "").slice(0, 60)}${flag}`
    );
  }
}

export async function cmdNudgeSet(args) {
  const f = args?.flags || {};
  const body = {};
  if (f.enabled !== undefined) body.enabled = String(f.enabled) !== "false";
  if (f["daily-max"] !== undefined) body.daily_max = Number(f["daily-max"]);
  if (f.quiet !== undefined) body.quiet_hours = String(f.quiet);
  if (f.cooldown !== undefined) body.cooldown_minutes = Number(f.cooldown);
  if (f["project-cooldown"] !== undefined) body.project_cooldown_minutes = Number(f["project-cooldown"]);
  if (f["kind-cooldown"] !== undefined) body.kind_cooldown_minutes = Number(f["kind-cooldown"]);
  if (!Object.keys(body).length) fail("set", "nothing to set");

  const { policy, source } = await http("PUT", "/nudges/policy", body);
  console.log(`budget updated (${source.join(" → ")})`);
  console.log(`  enabled: ${policy.enabled} · daily max: ${policy.daily_max || "∞"} · quiet: ${policy.quiet_hours || "none"}`);
  console.log("  Applies to the next unrequested message; nothing to restart.");
}

export async function cmdNudgeCheck(args) {
  const kind = args?.flags?.kind;
  if (!kind) fail("check", "--kind required");
  const r = await http("POST", "/nudges/check", {
    kind,
    severity: args?.flags?.severity || "normal",
    project_id: args?.flags?.project || null,
  });
  console.log(r.allowed ? `would send — ${r.reason}` : `would be held — ${r.reason}`);
  if (!r.allowed && r.retry_after_ms) {
    console.log(`  Retry in ~${Math.ceil(r.retry_after_ms / 60000)} min.`);
  }
}

export async function cmdNudgeFeedback(args) {
  const id = args?._?.[0];
  if (!id) fail("feedback", "nudge id required");
  const f = args?.flags || {};
  if (!f.useful && !f.noise) fail("feedback", "--useful or --noise required");
  await http("POST", `/nudges/${encodeURIComponent(id)}/feedback`, {
    useful: !!f.useful,
    note: f.note || "",
  });
  console.log(f.useful ? "noted: useful" : "noted: not useful");
}
