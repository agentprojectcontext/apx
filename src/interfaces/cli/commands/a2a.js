import { http } from "../http.js";
import { readAgents } from "#core/apc/parser.js";
import { resolveProjectId } from "./project.js";

const SUPER_AGENT_ALIASES = new Set(["super-agent", "superagent", "super_agent"]);

// Find which registered project(s) own an agent with this slug. Returns
// [{ id, name, path }]. Used to pick a target project automatically, and to
// disambiguate when two projects both have (say) a "rocky".
async function projectsWithAgent(slug) {
  const projects = await http.get("/api/projects");
  const hits = [];
  for (const proj of projects) {
    let agents = [];
    try { agents = readAgents(proj.path); } catch { /* skip unreadable */ }
    if (agents.some((a) => a.slug === slug)) hits.push(proj);
  }
  return hits;
}

// Resolve the project id to send into. --project wins. Otherwise locate the
// recipient across the registry: 1 match → use it; 0 or many → a clear,
// actionable error (the terminal tells you what to do, per the design).
async function resolveSendTarget(to, projectFlag) {
  if (projectFlag) return resolveProjectId(projectFlag);

  if (SUPER_AGENT_ALIASES.has(to)) {
    throw new Error(
      `"${to}" is the super-agent — it is not addressable via a2a send yet. ` +
      `Talk to it with \`apx exec "<msg>"\` (no -a). To reach a project agent named "${to}", pass --project <name>.`
    );
  }

  const hits = await projectsWithAgent(to);
  if (hits.length === 1) return hits[0].id;
  if (hits.length === 0) {
    throw new Error(
      `no agent "${to}" in any project. Run \`apx agent list --all\` to see agents and their projects, ` +
      `then retry with --project <name>.`
    );
  }
  const where = hits.map((h) => h.name).join(", ");
  throw new Error(
    `"${to}" exists in ${hits.length} projects (${where}). Pick one with --project <name> — e.g. ` +
    `apx send ${"<from>"} ${to} "<msg>" --project ${hits[0].name}`
  );
}

/** The a2a urgency tags. `blocker` reaches the owner in the act (crosses the
 *  interruption budget and quiet hours); `status`/`fyi` wait for a digest. */
const SEVERITY_TAGS = new Set(["blocker", "status", "fyi"]);

export async function cmdSend(args) {
  const from = args._[0];
  const to = args._[1];
  if (!from || !to) {
    throw new Error('apx send: usage: apx send <from> <to> "<body>" [--deliver] [--severity blocker|status|fyi] [--project <name>]');
  }
  let body = args._.slice(2).join(" ").trim();
  if (!body || body === "-") {
    const fs = await import("node:fs");
    if (!process.stdin.isTTY) {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      try {
        while (true) {
          const n = fs.readSync(0, buf, 0, buf.length);
          if (!n) break;
          chunks.push(buf.slice(0, n).toString("utf8"));
        }
      } catch {}
      body = chunks.join("").trim();
    }
  }
  if (!body) throw new Error("apx send: body is empty");

  // --for <who>: this a2a is being sent on someone's behalf (an agent relaying a
  // person's request). Surfaces as "a pedido de <who>" so the exchange connects
  // back to who triggered it instead of floating detached.
  const forFlag = args?.flags?.for;
  const requested_by = forFlag && forFlag !== true ? String(forFlag) : null;

  // --severity blocker|status|fyi. A `blocker` is an alert: Roby pings the owner
  // in the act. status/fyi ride the digest. An unknown value fails loudly rather
  // than silently downgrading a critical alert to a normal one.
  const sevFlag = args?.flags?.severity;
  const severity = sevFlag && sevFlag !== true ? String(sevFlag).toLowerCase() : null;
  if (severity && !SEVERITY_TAGS.has(severity)) {
    throw new Error(`apx send: --severity must be one of blocker|status|fyi (got "${severity}")`);
  }

  const pid = await resolveSendTarget(to, args?.flags?.project);
  const result = await http.post(`/api/projects/${pid}/send`, {
    from,
    to,
    body,
    deliver: !!args.flags.deliver,
    ...(severity ? { severity } : {}),
    ...(requested_by ? { requested_by } : {}),
  });
  console.log(`✉  ${from} → ${to}  @ ${result.ts}${severity ? `  [${severity}]` : ""}`);
  console.log(`   ${body}`);
  if (result.owner_notified) console.log(`   ⚠️  owner alerted now (critical): ${result.owner_notified_line || ""}`);
  else if (result.owner_notify_reason) console.log(`   (owner not alerted: ${result.owner_notify_reason})`);
  if (result.reply) {
    if (result.reply.error) {
      console.log(`\n⚠  delivery failed: ${result.reply.error}`);
    } else {
      console.log(`\n← ${to} replies:`);
      console.log(result.reply.text);
    }
  }
}

export async function cmdConnections(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx connections: missing <agent-slug>");
  const pid = await resolveProjectId(args?.flags?.project);
  const peers = await http.get(`/api/projects/${pid}/agents/${slug}/connections`);
  if (peers.length === 0) {
    console.log(`(no connections logged for ${slug} yet)`);
    return;
  }
  console.log("PEER".padEnd(16) + " CH".padEnd(11) + " DIR  N    LAST");
  for (const p of peers) {
    console.log(
      (p.peer || "?").padEnd(16) + " " +
      (p.channel || "").padEnd(10) + " " +
      (p.direction || "").padEnd(4) + " " +
      String(p.n).padEnd(4) + " " +
      (p.last_ts || "")
    );
  }
}
