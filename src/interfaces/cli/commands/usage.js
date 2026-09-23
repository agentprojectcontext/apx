// apx usage — what the model calls cost, by account, surface and agent.
//
//   apx usage                   today (UTC)
//   apx usage --date 2026-09-23 a given UTC day
//   apx usage --since 11        only calls from that UTC hour on
//   apx usage --json            the raw summary
//   apx usage breaker           the spend breaker: last hour of unwatched calls, any pause
//   apx usage resume            lift a spend-breaker pause now
//
// Reads ~/.apx/usage/<day>.jsonl, written by callEngine on every call. The
// logic lives in core (stores/llm-usage.js); this only prints it.
import { summarizeLlmUsage } from "#core/stores/llm-usage.js";
import { http } from "../http.js";

const c = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", cyan: "\x1b[36m" };

function table(title, rows) {
  if (!rows.length) return;
  console.log(`\n${c.bold}${title}${c.reset}`);
  const w = Math.max(8, ...rows.map((r) => String(r.key).length));
  console.log(`${c.dim}  ${"".padEnd(w)}  calls  failed   tok in  tok out${c.reset}`);
  for (const r of rows) {
    const failed = r.failed ? `${c.red}${String(r.failed).padStart(6)}${c.reset}` : String(r.failed).padStart(6);
    console.log(`  ${String(r.key).padEnd(w)}  ${String(r.calls).padStart(5)}  ${failed}  ${String(r.in).padStart(7)}  ${String(r.out).padStart(7)}`);
  }
}

export async function cmdUsage(args) {
  const f = args.flags || {};
  const day = typeof f.date === "string" ? f.date : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("apx usage: --date must be YYYY-MM-DD");
  const sinceHour = f.since != null ? Number(f.since) : null;
  if (sinceHour != null && !(sinceHour >= 0 && sinceHour <= 23)) throw new Error("apx usage: --since must be an hour 0-23 (UTC)");
  const s = summarizeLlmUsage(day, { sinceHour });
  if (f.json) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  console.log(`${c.cyan}${day}${c.reset} (UTC${sinceHour != null ? `, from ${sinceHour}:00` : ""}) — ${s.total} model calls, ${s.failed} failed`);
  if (!s.total) {
    console.log(`${c.dim}Nothing recorded for this day.${c.reset}`);
    return;
  }
  table("By model", s.byModel);
  table("By channel", s.byChannel);
  table("By agent", s.byAgent);
}

export async function cmdUsageBreaker() {
  const s = await http.get("/api/usage/breaker");
  const l = s.limits || {};
  console.log(`${c.bold}Spend breaker${c.reset} ${l.enabled ? "" : `${c.red}(off)${c.reset}`}`);
  console.log(`  unwatched model calls, last hour: ${s.calls_last_hour} / ${l.calls_per_hour} (per project ${l.project_calls_per_hour})`);
  for (const [p, n] of Object.entries(s.by_project || {})) console.log(`    project ${p}: ${n}`);
  if (s.paused) {
    const where = s.paused.scope === "project" ? `project ${s.paused.project}` : "all projects";
    console.log(`  ${c.red}paused${c.reset} (${where}) until ${new Date(s.paused.until).toISOString()} — \`apx usage resume\` lifts it`);
  } else {
    console.log("  not paused");
  }
}

export async function cmdUsageResume() {
  const r = await http.post("/api/usage/breaker/resume", {});
  console.log(r.resumed ? "✅ background work resumed" : "Nothing was paused.");
}
