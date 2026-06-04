import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

// Channels that live in ~/.apx/messages/<channel>/ (global, cross-project).
// Everything else is project-scoped.
const GLOBAL_CHANNELS = new Set(["telegram", "direct", "whatsapp"]);

function isGlobalChannel(channel) {
  return channel && GLOBAL_CHANNELS.has(channel);
}

export async function cmdMessagesTail(args) {
  const channel = args.flags.channel && args.flags.channel !== true ? args.flags.channel : null;
  const n = args.flags.n || args.flags.last || "50";
  const isGlobal = args.flags.global || isGlobalChannel(channel);

  if (isGlobal) {
    // Read from global store — no project needed
    const params = new URLSearchParams({ limit: String(n) });
    if (channel) params.set("channel", channel);
    const rows = await http.get(`/messages/global?${params}`);
    if (rows.length === 0) {
      console.log("(no messages)");
      return;
    }
    for (const r of rows) {
      const arrow = r.direction === "in" ? "←" : "→";
      console.log(`${r.ts}  ${arrow} ${(r.channel || channel || "").padEnd(10)} ${r.author || ""}: ${r.body}`);
    }
    return;
  }

  // Project-scoped
  const pid = await resolveProjectId(args?.flags?.project);
  const params = new URLSearchParams({ limit: String(n) });
  if (args.flags.agent && args.flags.agent !== true) params.set("agent", args.flags.agent);
  if (channel) params.set("channel", channel);
  const rows = await http.get(`/projects/${pid}/messages?${params}`);
  if (rows.length === 0) {
    console.log("(no messages)");
    return;
  }
  for (const r of rows.reverse()) {
    const arrow = r.direction === "in" ? "←" : "→";
    console.log(`${r.ts}  ${arrow} ${r.channel.padEnd(8)} ${r.author || ""}: ${r.body}`);
  }
}

function chatTimestamp(ts) {
  if (!ts) return "????-??-?? ??:??:??";
  return ts.replace("T", " ").replace(/Z$/, "");
}

function chatActor(row) {
  const type = row.type || (row.direction === "in" ? "user" : "agent");
  const who = row.author || row.actor_id || "";
  return who ? `${type} ${who}` : type;
}

function printChatRows(rows) {
  if (rows.length === 0) {
    console.log("(no messages)");
    return;
  }
  for (const r of rows) {
    const body = String(r.body || "");
    const lines = body.split("\n");
    console.log(`[${chatTimestamp(r.ts)}] ${chatActor(r)}: ${lines[0] || ""}`);
    for (const line of lines.slice(1)) console.log(`  ${line}`);
  }
}

export async function cmdMessagesChat(args) {
  const channel = args.flags.channel && args.flags.channel !== true ? args.flags.channel : "telegram";
  const n = args.flags.n || args.flags.last || "50";
  const isGlobal = args.flags.global || isGlobalChannel(channel);

  if (isGlobal) {
    const params = new URLSearchParams({ limit: String(n) });
    if (channel) params.set("channel", channel);
    const rows = await http.get(`/messages/global?${params}`);
    printChatRows(rows);
    return;
  }

  const pid = await resolveProjectId(args?.flags?.project);
  const params = new URLSearchParams({ limit: String(n) });
  if (args.flags.agent && args.flags.agent !== true) params.set("agent", args.flags.agent);
  if (channel) params.set("channel", channel);
  const rows = await http.get(`/projects/${pid}/messages?${params}`);
  printChatRows(rows.reverse());
}

export async function cmdMessagesSearch(args) {
  const q = args._[0];
  if (!q) throw new Error("apx messages search: missing <query>");
  const pid = await resolveProjectId(args?.flags?.project);
  const rows = await http.get(`/projects/${pid}/messages/search?q=${encodeURIComponent(q)}`);
  if (rows.length === 0) {
    console.log("(no matches)");
    return;
  }
  for (const r of rows) {
    console.log(`${r.ts}  ${r.channel} ${r.author || ""}: ${r.body}`);
  }
}
