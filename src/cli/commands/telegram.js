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
