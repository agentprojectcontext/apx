// apx discord — the bot's settings and the list of rooms it lives in.
//
// Adapter only: every command is one call to the daemon, and the daemon's
// routes call core/channels/discord/config.js. Mode changes apply to the next
// message without a restart; a new token needs `apx restart`.
import { http } from "../http.js";
import { readStdinSync } from "../stdin.js";

const dash = "—";

export async function cmdDiscordStatus() {
  const s = await http.get("/api/discord/status");
  console.log(`state:      ${s.state || "off"}${s.error ? ` (${s.error})` : ""}`);
  console.log(`bot:        ${s.bot ? `${s.bot.name} (${s.bot.id})` : dash}`);
  console.log(`enabled:    ${s.enabled !== false}`);
  console.log(`token:      ${s.has_token ? "set" : "missing"}`);
  console.log(`owner ids:  ${(s.owner_ids || []).join(", ") || dash}`);
  console.log(`names:      ${(s.names || []).join(", ") || dash}`);
  printChannels(s.channels || []);
}

function printChannels(rows) {
  if (!rows.length) {
    console.log("channels:   none listed — the bot reads and says nothing anywhere");
    return;
  }
  console.log("channels:");
  for (const c of rows) console.log(`  ${c.id}  ${c.mode.padEnd(7)} ${c.name ? `#${c.name}` : ""}`);
}

export async function cmdDiscordChannels() {
  const s = await http.get("/api/discord/status");
  printChannels(s.channels || []);
}

export async function cmdDiscordChannelSet(id, mode, a, { die }) {
  if (!id || !mode) die("usage: apx discord channel set <channel_id> <always|useful|mention|read> [--name <name>]");
  const row = await http.put(`/api/discord/channels/${encodeURIComponent(id)}`, {
    mode,
    ...(a.flags.name ? { name: String(a.flags.name) } : {}),
  });
  console.log(`✅ ${row.id} → ${row.mode}${row.name ? ` (#${row.name})` : ""}`);
}

export async function cmdDiscordChannelRemove(id, { die }) {
  if (!id) die("usage: apx discord channel remove <channel_id>");
  await http.delete(`/api/discord/channels/${encodeURIComponent(id)}`);
  console.log(`✅ ${id} removed — the bot no longer reads or answers there`);
}

/**
 * Settings. The token is read from stdin, never from an argument: an argument
 * lands in the shell history and in `ps` output for anyone on the machine.
 */
export async function cmdDiscordSet(a, { die }) {
  const f = a.flags;
  const patch = {};
  if (f["token-stdin"] && f["knowledge-stdin"]) die("one stdin at a time: --token-stdin or --knowledge-stdin");
  if (f["token-stdin"]) {
    const token = readStdinSync().trim();
    if (!token) die("no token on stdin — try: pbpaste | apx discord set --token-stdin");
    patch.token = token;
  }
  if (f.owner !== undefined) patch.owner_ids = String(f.owner).split(",").map((x) => x.trim()).filter(Boolean);
  if (f.names !== undefined) patch.names = String(f.names).split(",").map((x) => x.trim()).filter(Boolean);
  if (f["knowledge-stdin"]) patch.knowledge = readStdinSync().trim();
  if (f.enabled !== undefined) patch.enabled = !["false", "0", "no", "off"].includes(String(f.enabled));
  if (!Object.keys(patch).length) {
    die("nothing to set — use --token-stdin, --owner <id,…>, --names <a,b>, --knowledge-stdin or --enabled <true|false>");
  }
  await http.patch("/api/discord/settings", patch);
  console.log(`✅ updated: ${Object.keys(patch).map((k) => (k === "token" ? "token (hidden)" : k)).join(", ")}`);
  if (patch.token || patch.enabled !== undefined) console.log("   run `apx restart` for the connection to pick it up");
}
