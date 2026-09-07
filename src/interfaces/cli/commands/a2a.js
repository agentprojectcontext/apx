import { http } from "../http.js";
import { readAgents } from "#core/apc/parser.js";
import { readConfig } from "#core/config/index.js";
import {
  findAddressedAgent,
  isRuntimeName,
  isSuperAgentName,
  parsePeerAddress,
} from "#core/agent/a2a/peers.js";
import { RUNTIME_IDS } from "#core/runtimes/index.js";
import { resolveProjectId } from "./project.js";

// Find which registered project(s) own an agent with this slug. Returns
// [{ id, name, path }]. Used to pick a target project automatically, and to
// disambiguate when two projects both have (say) a "rocky".
async function projectsWithAgent(name) {
  const projects = await http.get("/api/projects");
  const hits = [];
  for (const proj of projects) {
    let agents = [];
    try { agents = readAgents(proj.path); } catch { /* skip unreadable */ }
    if (findAddressedAgent(name, agents)) hits.push(proj);
  }
  return hits;
}

// Resolve the project id to send into. --project wins. Otherwise locate the
// recipient across the registry. A super-agent target instead follows the
// sender's project, because the daemon-level mode needs that project's context.
export async function resolveSendTarget(to, projectFlag, from) {
  if (projectFlag) return resolveProjectId(projectFlag);

  // `<name>:<thread>` addresses the same peer on a separate thread; only the
  // name decides WHO answers, so that is what every lookup below reads.
  const { name } = parsePeerAddress(to);

  // A real project agent wins over synthetic aliases, matching resolvePeer().
  const hits = await projectsWithAgent(name);
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) {
    const where = hits.map((h) => h.name).join(", ");
    throw new Error(
      `"${to}" exists in ${hits.length} projects (${where}). Pick one with --project <name> — e.g. ` +
      `apx send ${"<from>"} ${to} "<msg>" --project ${hits[0].name}`
    );
  }

  if (isSuperAgentName(name, readConfig())) {
    const senderName = parsePeerAddress(from).name;
    const senderHits = senderName ? await projectsWithAgent(senderName) : [];
    if (senderHits.length === 1) return senderHits[0].id;
    if (senderHits.length > 1) {
      throw new Error(
        `sender "${from}" exists in ${senderHits.length} projects (${senderHits.map((h) => h.name).join(", ")}). ` +
        "Pick the A2A project with --project <name>."
      );
    }
    return resolveProjectId(undefined);
  }

  if (hits.length === 0) {
    // No agent owns the name — a runtime peer (opencode, codex, claude-code, …)
    // is not registered anywhere, so it runs in the project you are standing
    // in, exactly like `apx run --runtime`.
    if (isRuntimeName(name)) return resolveProjectId(undefined);
    throw new Error(
      `no agent or runtime "${to}" in any project. Run \`apx agent list --all\` to see agents and ` +
      `their projects, then retry with --project <name>. Runtime peers: ${RUNTIME_IDS.join(", ")}.`
    );
  }
}

/** The a2a urgency tags. `blocker` reaches the owner in the act (crosses the
 *  interruption budget and quiet hours); `status`/`fyi` wait for a digest. */
const SEVERITY_TAGS = new Set(["blocker", "status", "fyi"]);

// What the ledger says happened, when the socket says nothing.
//
// `apx send --deliver` holds one request open for the whole peer turn, so a
// dropped connection tells you nothing about the delivery — and the daemon
// logs the message to the thread BEFORE it runs the peer, which means the
// answer is already written down. Reading it back is the difference between
// "we could not log your message" and "we logged it and lost the reply", and
// between those two the user does opposite things: retype the message, or
// wait. Guessing wrong is how the same long message landed on one thread five
// times.
export async function readBackSend({ pid, from, to, body, since }) {
  const params = new URLSearchParams({ channel: "a2a", limit: "200", since });
  let rows = [];
  try {
    rows = await http.get(`/api/projects/${pid}/messages?${params}`);
  } catch {
    return { logged: null, reply: null };  // the daemon is unreachable too — say so, claim nothing
  }
  const head = body.slice(0, 60);
  const mine = rows.find((r) => r.author === from && typeof r.body === "string" && r.body.startsWith(head));
  if (!mine) return { logged: false, reply: null };
  const reply = rows.find((r) => r.author === to && r.direction === "out" && r.ts >= mine.ts && r.meta?.final);
  return { logged: true, sent_ts: mine.ts, reply: reply || null };
}

/** Wait for the peer's reply to appear on the thread, checking every 5s. */
export async function awaitReplyOnThread({ pid, from, to, body, since, deadline }) {
  while (Date.now() < deadline) {
    // Capped by what is left: a deadline the caller gave has to be the moment
    // this returns, not that moment plus one whole poll interval.
    await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(0, deadline - Date.now()))));
    const seen = await readBackSend({ pid, from, to, body, since });
    if (seen.reply) return seen;
    if (seen.logged === false) return seen;
  }
  return await readBackSend({ pid, from, to, body, since });
}


export async function cmdSend(args) {
  const from = args._[0];
  const to = args._[1];
  if (!from || !to) {
    throw new Error('apx send: usage: apx send <from> <to> "<body>" [--deliver] [--code] [--background] [--timeout <s>] [--severity blocker|status|fyi] [--project <name>]');
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

  // Attribution override. Normally the daemon stamps the sender agent's
  // configured model automatically; `--model` / `--usage '{"input_tokens":…}'`
  // let a caller that KNOWS the real cost (e.g. a routine relaying its run)
  // record it precisely. A plain relay spends no tokens, so usage stays empty.
  const modelFlag = args?.flags?.model;
  const model = modelFlag && modelFlag !== true ? String(modelFlag) : null;
  const usageFlag = args?.flags?.usage;
  let usage = null;
  if (usageFlag && usageFlag !== true) {
    try { usage = JSON.parse(String(usageFlag)); }
    catch { throw new Error(`apx send: --usage must be JSON, e.g. '{"input_tokens":10,"output_tokens":5}'`); }
  }

  const timeoutFlag = args?.flags?.timeout;
  const timeoutS = timeoutFlag && timeoutFlag !== true ? parseInt(timeoutFlag, 10) : null;
  if (timeoutFlag && timeoutFlag !== true && !(timeoutS > 0)) {
    throw new Error(`apx send: --timeout must be a positive number of seconds (got "${timeoutFlag}")`);
  }

  const pid = await resolveSendTarget(to, args?.flags?.project, from);
  const deliver = !!args.flags.deliver;
  const background = !!args.flags.background;
  // Wait a little LONGER than the daemon will. Its own budget for a delivered
  // turn is 300 s, and fetch's ceiling is the same 300 s, so a peer that used
  // its whole budget lost the race by a hair and the CLI reported a failure
  // over a delivery that had happened. The margin makes the daemon's answer —
  // reply or timeout — the thing that ends the call.
  const waitMs = deliver && !background ? ((timeoutS || 300) + 30) * 1000 : 0;
  const sentSince = new Date(Date.now() - 10_000).toISOString();

  let result;
  try {
    result = await sendRequest();
  } catch (e) {
    // Only a dropped socket is ambiguous. A refusal from the daemon (400, 429,
    // "agent not found") already says what happened — let it through.
    if (!e?.transport) throw e;

    const seen = await readBackSend({ pid, from, to, body, since: sentSince });
    if (seen.logged === null) {
      throw new Error(`apx send: lost the connection to the daemon and could not reach it to check (${e.message}). Whether ${to} got the message is unknown — read the thread before resending: apx messages chat --channel a2a`);
    }
    if (!seen.logged) {
      throw new Error(`apx send: the message was NOT logged — nothing reached ${to} (${e.message}). Safe to send again.`);
    }

    console.log(`✉  ${from} → ${to}  @ ${seen.sent_ts}${severity ? `  [${severity}]` : ""}`);
    console.log(`   ${body}`);
    console.log(`\n⚠  delivered, but the connection dropped while ${to} was still working (${e.message}).`);
    console.log(`   The message IS on the thread — do NOT send it again, that duplicates it.`);
    if (!deliver) {
      console.log(`   Read the thread: apx messages chat --channel a2a`);
      return;
    }
    console.log(`   Waiting for the reply on the thread instead…`);
    const done = await awaitReplyOnThread({
      pid, from, to, body, since: sentSince,
      deadline: Date.now() + (waitMs || 300_000),
    });
    if (done.reply) {
      console.log(`\n← ${to} replies:`);
      console.log(done.reply.body);
      return;
    }
    console.log(`\n   ${to} has not answered yet. It may still be running (engine retries make a turn slow).`);
    console.log(`   Read it when it lands: apx messages chat --channel a2a`);
    return;
  }

  function sendRequest() {
    return http.post(`/api/projects/${pid}/send`, {
      from,
      to,
      body,
      deliver,
      // Where the sender is standing. A runtime peer answers by running a coding
      // CLI, and an exchange between two coding CLIs is about a codebase — the
      // one you are in, which the project record does not know (the default
      // project's path is a storage directory, not a checkout).
      cwd: process.cwd(),
      // --code opens the exchange as a working session instead of a conversation:
      // the peer runs with its write access on. Off by default, deliberately —
      // being messaged is not consent to have your checkout edited.
      ...(args.flags.code ? { code: true } : {}),
      // --background hands the turn back immediately; the reply lands on the
      // thread when the peer finishes. What makes a long coding session usable.
      ...(args.flags.background ? { background: true } : {}),
      ...(timeoutS ? { timeout_s: timeoutS } : {}),
      ...(severity ? { severity } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(requested_by ? { requested_by } : {}),
    }, waitMs ? { timeoutMs: waitMs } : {});
  }

  console.log(`✉  ${from} → ${to}  @ ${result.ts}${severity ? `  [${severity}]` : ""}`);
  console.log(`   ${body}`);
  if (result.owner_notified) console.log(`   ⚠️  owner alerted now (critical): ${result.owner_notified_line || ""}`);
  else if (result.owner_notify_reason) console.log(`   (owner not alerted: ${result.owner_notify_reason})`);
  if (result.reply) {
    if (result.reply.status === "delivering") {
      console.log(
        `\n⏳ ${to} is working on it (up to ${result.reply.timeout_s}s). ` +
        `The reply lands on this thread — read it with \`apx messages\` or the web inbox.`
      );
    } else if (result.reply.error) {
      console.log(`\n⚠  delivery failed: ${result.reply.error}`);
    } else {
      console.log(`\n← ${to} replies:`);
      console.log(result.reply.text);
      // The session the peer is keeping for this thread. Printed because it is
      // the thing that makes the next turn a continuation instead of a restart,
      // and a run you cannot see is a run you cannot debug.
      if (result.reply.session_id) {
        console.log(`\n   (${result.reply.runtime || "session"} ${result.reply.session_id})`);
      } else if (result.reply.session_note) {
        // No session is fine — the thread still continues, carried in the
        // prompt. Saying WHY beats leaving the line blank and looking broken.
        console.log(`\n   (sin sesión reanudable: ${result.reply.session_note})`);
      }
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
