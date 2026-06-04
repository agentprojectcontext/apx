import readline from "node:readline";
import { http } from "../http.js";

export async function cmdTelegramSend(args) {
  const text = args._[0];
  if (!text) throw new Error("apx telegram send: missing <text>");
  const chat_id = args.flags.chat === true ? undefined : args.flags.chat;
  // --interrupt / --force: send immediately bypassing any pending agent queue
  const interrupt = !!(args.flags.interrupt || args.flags.force);
  const result = await http.post("/telegram/send", { chat_id, text, interrupt });
  if (interrupt) {
    console.log(`⚡ sent (interrupt, message_id=${result.message_id})`);
  } else {
    console.log(`✅ sent (message_id=${result.message_id})`);
  }
}

export async function cmdTelegramStatus() {
  const s = await http.get("/telegram/status");
  console.log(`enabled: ${s.enabled}`);
  if (!s.channels || s.channels.length === 0) {
    console.log("(no channels configured)");
    return;
  }
  for (const c of s.channels) {
    console.log("");
    console.log(`channel:             ${c.name}`);
    console.log(`  polling:           ${c.polling}`);
    console.log(`  bot_token:         ${c.bot_token_present ? "✓" : "✗"} (source: ${c.bot_token_source || "—"})`);
    console.log(`  chat_id:           ${c.chat_id || "(unset)"}`);
    console.log(`  project:           ${c.project || "(first registered)"}`);
    console.log(`  route_to_agent:    ${c.route_to_agent || "(none → super-agent fallback)"}`);
    console.log(`  respond_w/engine:  ${c.respond_with_engine}`);
    console.log(`  offset:            ${c.offset}`);
    console.log(`  last_update_at:    ${c.last_update_at || "(never)"}`);
    console.log(`  last_error:        ${c.last_error || "(none)"}`);
  }
}

export async function cmdTelegramStart() {
  const r = await http.post("/telegram/start", {});
  const channels = r.status?.channels || [];
  const polling = channels.filter((c) => c.polling).length;
  if (channels.length === 0) {
    console.log("⚠️  no telegram channels configured — run: apx telegram setup");
    return;
  }
  if (polling === 0) {
    console.log("⚠️  polling did not start — check telegram.enabled in ~/.apx/config.json and that a bot_token is set");
    for (const c of channels) {
      if (c.last_error) console.log(`   ${c.name}: ${c.last_error}`);
    }
    return;
  }
  console.log(`✅ telegram polling (${polling}/${channels.length} channel${channels.length !== 1 ? "s" : ""})`);
}

export async function cmdTelegramStop() {
  await http.post("/telegram/stop", {});
  console.log("⏹  telegram polling stopped (config unchanged — apx telegram start to resume)");
}

// ─── apx telegram channel <sub> ─────────────────────────────────────────────
// Manages cfg.telegram.channels[] via the daemon CRUD endpoints. Every write
// is followed by POST /admin/reload so the polling plugin picks up the change
// without a daemon restart.

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}

async function reloadDaemon() {
  try {
    await http.post("/admin/reload", {});
  } catch (e) {
    console.log(`⚠️  reload failed: ${e.message} (changes saved, restart daemon to apply)`);
  }
}

async function listProjects() {
  try {
    return await http.get("/projects");
  } catch {
    return [];
  }
}

async function listAgentsForProject(projectId) {
  try {
    const ags = await http.get(`/projects/${projectId}/agents`);
    return Array.isArray(ags) ? ags : (ags?.agents || []);
  } catch {
    return [];
  }
}

function parseBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v !== "string") return null;
  if (/^(true|t|yes|y|1)$/i.test(v)) return true;
  if (/^(false|f|no|n|0)$/i.test(v)) return false;
  return null;
}

function printChannelLine(c) {
  const project = c.project ? c.project : "—";
  const agent = c.route_to_agent || "(super-agent)";
  const respond = c.respond_with_engine === false ? "off" : "on";
  console.log(
    `  ${c.name.padEnd(16)} chat=${(c.chat_id || "—").padEnd(14)} project=${String(project).padEnd(24)} agent=${agent.padEnd(16)} respond=${respond}`
  );
}

export async function cmdTelegramChannelList() {
  const { channels } = await http.get("/telegram/channels");
  if (!channels || channels.length === 0) {
    console.log("(no channels configured — try `apx telegram channel add`)");
    return;
  }
  console.log(`channels (${channels.length}):`);
  for (const c of channels) printChannelLine(c);
}

export async function cmdTelegramChannelShow(args) {
  const name = args._[0];
  if (!name) throw new Error("apx telegram channel show: missing <name>");
  const { channels } = await http.get("/telegram/channels");
  const ch = (channels || []).find((c) => c.name === name);
  if (!ch) throw new Error(`no such channel: ${name}`);
  console.log(JSON.stringify(ch, null, 2));
}

export async function cmdTelegramChannelAdd(args) {
  const name = args._[0];
  // Non-interactive form: name + --bot-token + --chat-id ...
  if (name && (args.flags["bot-token"] || args.flags["chat-id"])) {
    const patch = { name };
    if (args.flags["bot-token"]) patch.bot_token = String(args.flags["bot-token"]);
    if (args.flags["chat-id"]) patch.chat_id = String(args.flags["chat-id"]);
    if (args.flags.project) patch.project = String(args.flags.project);
    if (args.flags.agent) patch.route_to_agent = String(args.flags.agent);
    if (args.flags["respond-engine"] !== undefined) {
      const b = parseBool(args.flags["respond-engine"]);
      if (b !== null) patch.respond_with_engine = b;
    }
    const result = await http.post("/telegram/channels", patch);
    await reloadDaemon();
    console.log(`${result.created ? "✅ created" : "ℹ️  updated"} channel "${name}"`);
    return;
  }

  // Interactive wizard
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const channelName = name || (await ask(rl, "name: "));
    if (!channelName) throw new Error("name is required");
    const botToken = await ask(rl, "bot_token (blank to keep env fallback): ");
    const chatId = await ask(rl, "chat_id (default outbound): ");

    // Optional: pin to a project
    const projects = await listProjects();
    let projectPath = "";
    if (projects.length === 0) {
      console.log("(no registered projects — skipping project pin)");
    } else {
      console.log("\nRegistered projects:");
      console.log("  0. (none — first registered project as fallback)");
      projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}  (${p.path})`));
      const idx = parseInt(await ask(rl, "Pin to project [0]: "), 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= projects.length) {
        projectPath = projects[idx - 1].path;
      }
    }

    // Optional: master agent
    let agent = "";
    if (projectPath) {
      const pinned = projects.find((p) => p.path === projectPath);
      const agents = await listAgentsForProject(pinned.id);
      if (agents.length === 0) {
        console.log("(no agents in that project — defaulting to super-agent)");
      } else {
        console.log("\nAgents in that project:");
        console.log("  0. (default APX super-agent)");
        agents.forEach((a, i) => console.log(`  ${i + 1}. ${a.slug || a.name}`));
        const aIdx = parseInt(await ask(rl, "Master agent [0]: "), 10);
        if (Number.isInteger(aIdx) && aIdx >= 1 && aIdx <= agents.length) {
          agent = agents[aIdx - 1].slug || agents[aIdx - 1].name;
        }
      }
    }

    const respondAns = await ask(rl, "respond_with_engine [Y/n]: ");
    const respond = !/^n/i.test(respondAns);

    const patch = { name: channelName };
    if (botToken) patch.bot_token = botToken;
    if (chatId) patch.chat_id = chatId;
    if (projectPath) patch.project = projectPath;
    if (agent) patch.route_to_agent = agent;
    patch.respond_with_engine = respond;

    const result = await http.post("/telegram/channels", patch);
    await reloadDaemon();
    console.log(`\n${result.created ? "✅ created" : "ℹ️  updated"} channel "${channelName}"`);
  } finally {
    rl.close();
  }
}

export async function cmdTelegramChannelSet(args) {
  const name = args._[0];
  if (!name) throw new Error("apx telegram channel set: missing <name>");
  const patch = {};
  if (args.flags.project !== undefined) patch.project = String(args.flags.project);
  if (args.flags.agent !== undefined) patch.route_to_agent = String(args.flags.agent);
  if (args.flags["bot-token"] !== undefined) patch.bot_token = String(args.flags["bot-token"]);
  if (args.flags["chat-id"] !== undefined) patch.chat_id = String(args.flags["chat-id"]);
  if (args.flags["respond-engine"] !== undefined) {
    const b = parseBool(args.flags["respond-engine"]);
    if (b === null) throw new Error("--respond-engine must be true|false");
    patch.respond_with_engine = b;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("apx telegram channel set: nothing to update (use --project / --agent / --respond-engine / --bot-token / --chat-id)");
  }
  await http.patch(`/telegram/channels/${encodeURIComponent(name)}`, patch);
  await reloadDaemon();
  console.log(`✅ updated channel "${name}"`);
}

export async function cmdTelegramChannelUnset(args) {
  const name = args._[0];
  if (!name) throw new Error("apx telegram channel unset: missing <name>");
  // Flag presence means "unset this field". Map to null in the PATCH body.
  const fields = [];
  if (args.flags.project) fields.push("project");
  if (args.flags.agent) fields.push("route_to_agent");
  if (args.flags["bot-token"]) fields.push("bot_token");
  if (args.flags["chat-id"]) fields.push("chat_id");
  if (fields.length === 0) {
    throw new Error("apx telegram channel unset: specify at least one of --project --agent --bot-token --chat-id");
  }
  const body = Object.fromEntries(fields.map((f) => [f, null]));
  await http.patch(`/telegram/channels/${encodeURIComponent(name)}`, body);
  await reloadDaemon();
  console.log(`✅ cleared ${fields.join(", ")} on "${name}"`);
}

export async function cmdTelegramChannelRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx telegram channel remove: missing <name>");
  await http.delete(`/telegram/channels/${encodeURIComponent(name)}`);
  await reloadDaemon();
  console.log(`🗑  removed channel "${name}"`);
}

// ─── apx telegram contacts / role / owner ───────────────────────────────────
// Manage the global roster (cfg.telegram.contacts[]), per-channel owners
// (cfg.telegram.channels[].owner_user_id) and roles (cfg.telegram.roles).
// The poller re-reads config per inbound message, so these take effect on the
// next message without an explicit reload.

function roleTag(c, owners) {
  if (owners.some((o) => String(o.owner_user_id) === String(c.user_id))) return "owner";
  return c.role || "guest";
}

export async function cmdTelegramContacts() {
  const { contacts, channel_owners = [] } = await http.get("/telegram/contacts");
  if (!contacts || contacts.length === 0) {
    console.log("(no contacts yet — they're recorded automatically when people message a bot)");
    return;
  }
  console.log(`contacts (${contacts.length}):`);
  for (const c of contacts) {
    const handle = c.username ? `@${c.username}` : "—";
    const last = c.last_seen ? c.last_seen.slice(0, 10) : "—";
    console.log(
      `  ${String(c.user_id).padEnd(12)} ${String(c.name || "—").padEnd(20)} ${handle.padEnd(18)} role=${roleTag(c, channel_owners).padEnd(10)} seen=${last}`
    );
  }
}

export async function cmdTelegramRole(args) {
  const userId = args._[0];
  const role = args._[1];
  if (!userId || !role) {
    throw new Error("apx telegram role <user_id> <role>  (e.g. apx telegram role 123 editor)");
  }
  const r = await http.patch(`/telegram/contacts/${encodeURIComponent(userId)}`, { role });
  console.log(`✅ ${r.contact?.name || userId} → role "${role}"`);
}

export async function cmdTelegramContactRemove(args) {
  const userId = args._[0];
  if (!userId) throw new Error("apx telegram contact rm <user_id>");
  await http.delete(`/telegram/contacts/${encodeURIComponent(userId)}`);
  console.log(`🗑  removed contact ${userId}`);
}

export async function cmdTelegramOwner(args) {
  const channel = args._[0];
  const userId = args._[1];
  if (!channel || !userId) {
    throw new Error("apx telegram owner <channel> <user_id>");
  }
  await http.patch(`/telegram/channels/${encodeURIComponent(channel)}`, {
    owner_user_id: /^\d+$/.test(String(userId)) ? Number(userId) : userId,
  });
  await reloadDaemon();
  console.log(`✅ owner of channel "${channel}" set to ${userId}`);
}

export async function cmdTelegramRoles(args) {
  const sub = args._[0];
  if (sub === "set") {
    const name = args._[1];
    if (!name) throw new Error("apx telegram roles set <name> [--tools a,b,c | --tools '*']");
    const raw = args.flags.tools;
    let tools = [];
    if (raw === "*" || raw === true) tools = "*";
    else if (typeof raw === "string") tools = raw.split(",").map((s) => s.trim()).filter(Boolean);
    await http.put(`/telegram/roles/${encodeURIComponent(name)}`, { tools });
    console.log(`✅ role "${name}" → tools ${tools === "*" ? "*" : `[${tools.join(", ")}]`}`);
    return;
  }
  if (sub === "rm" || sub === "remove") {
    const name = args._[1];
    if (!name) throw new Error("apx telegram roles rm <name>");
    await http.delete(`/telegram/roles/${encodeURIComponent(name)}`);
    console.log(`🗑  removed role "${name}"`);
    return;
  }
  // default: list
  const { roles } = await http.get("/telegram/roles");
  const names = Object.keys(roles || {});
  if (names.length === 0) {
    console.log("(no roles defined)");
    return;
  }
  console.log(`roles (${names.length}):`);
  for (const n of names) {
    const t = roles[n]?.tools;
    const desc = t === "*" ? "all tools" : Array.isArray(t) ? (t.length ? t.join(", ") : "no tools") : "—";
    console.log(`  ${n.padEnd(12)} ${desc}`);
  }
}

export function cmdTelegramSetup() {
  console.log(`Edit ~/.apx/config.json — telegram section:

  "telegram": {
    "enabled": true,
    "bot_token": "<your bot token from @BotFather>",
    "chat_id": "<numeric chat id where outbound goes>",
    "poll_interval_ms": 1500,
    "route_to_agent": "<slug>",          // optional: who auto-replies
    "respond_with_engine": true          // false → only log inbound
  }

Then restart the daemon (apx daemon stop && any apx command will auto-start it).
You can verify with: apx telegram status
`);
}
