// Inbound Discord: store it, decide whether to speak, and if so, speak once.
//
// The order is the design, as on WhatsApp. Whether a room is listed, whether
// the bot was called and whether a limit applies are all settled by code
// (./trigger.js) before any model sees the message. By the time a turn runs,
// the only open question is the wording.
//
// Every turn here is SEALED (`audience: "third_party"`), the owner's included:
// the reply is posted in a public room, so a turn with the owner's memory,
// projects or tools would be one careless sentence away from publishing them.
// The owner gives the agent real work on Telegram or the panel, not here.
//
// A burst is one question. People write "roby" / "una pregunta" / the actual
// question as three messages; answering the first would answer a third of it.
// So a call opens a short settle window per (room, person) and the turn runs
// on whatever that person said by the time it closes.
import { CHANNELS } from "#core/constants/channels.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { readConfig } from "#core/config/index.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { compactChannelIfNeeded } from "#core/memory/index.js";
import { readDiscordConfig } from "./config.js";
import { decideDiscordMessage, createDiscordLimiter, SKIP_REASONS } from "./trigger.js";
import { gatherDiscordContext } from "./context.js";
import { postDiscord } from "./outbox.js";

// How many new messages in a room before we ask the compactor whether it is
// time for a summary. The compactor decides; this only keeps us from asking on
// every single message of a busy room.
const COMPACT_CHECK_EVERY = 20;

// One report to the owner per room per window. The owner wants to know the bot
// spoke in their community — not to be pinged for every reply.
const REPORT_WINDOW_MS = 30 * 60_000;

/** Who the turn is talking to, in two lines. Nothing about the owner. */
function relationshipFor(msg, dc) {
  const name = msg.author?.name || "someone";
  const lines = [`# Who you are answering\n${name}, a member of this Discord community.`];
  if ((dc.owner_ids || []).includes(msg.author?.id)) {
    lines.push("This is your owner's own Discord account. The room is still public: answer them as you would anyone here, with nothing private.");
  }
  return lines.join("\n");
}

function inboundMeta(msg) {
  return {
    chat_id: msg.channel_id,
    // One thread per room: the inbox groups a Discord day by channel, not by
    // person, because a room is read as a room.
    contact_key: msg.channel_id,
    message_id: msg.id,
    speaker: msg.author?.name || "",
    discord_user_id: msg.author?.id || "",
    ...(msg.author?.bot ? { discord_bot: true } : {}),
    ...(msg.guild_id ? { guild_id: msg.guild_id } : {}),
    ...(msg.parent_id ? { parent_id: msg.parent_id } : {}),
    ...(msg.reply_to?.id ? { reply_to_id: msg.reply_to.id } : {}),
    ...(msg.channel_name ? { room: msg.channel_name } : {}),
  };
}

/**
 * Build the dispatcher for one connected bot.
 *
 * transport: { botId() → string, send(channelId, text, { replyTo }) → {id}, typing(channelId) }
 * runTurn / settleMs / now are injectable for tests; nothing else is.
 */
export function createDiscordDispatcher({
  transport,
  globalConfig = null,
  projects = null,
  plugins = null,
  registries = null,
  log = () => {},
  notifyOwner = async () => {},
  runTurn = runSuperAgent,
  compact = compactChannelIfNeeded,
  settleMs = null,
  limiter = createDiscordLimiter(),
} = {}) {
  const pending = new Map();      // room|user → { timer, msg }
  const sinceCompact = new Map(); // room → messages stored since the last check
  const compacting = new Set();   // rooms with a compaction in flight
  const lastReport = new Map();   // room|kind → ms
  const running = new Set();      // turns in flight, for stop()/tests

  const cfgNow = () => globalConfig || readConfig();

  async function report(kind, roomId, text) {
    const key = `${roomId}|${kind}`;
    const last = lastReport.get(key);
    if (last !== undefined && Date.now() - last < REPORT_WINDOW_MS) return;
    lastReport.set(key, Date.now());
    try { await notifyOwner(text, { kind: `discord_${kind}` }); } catch { /* the log line below still says it */ }
  }

  function maybeCompact(roomId, dc) {
    const n = (sinceCompact.get(roomId) || 0) + 1;
    sinceCompact.set(roomId, n);
    if (n < COMPACT_CHECK_EVERY || compacting.has(roomId)) return;
    sinceCompact.set(roomId, 0);
    compacting.add(roomId);
    compact({
      channel: CHANNELS.DISCORD,
      chat_id: roomId,
      config: cfgNow(),
      log,
      maxTurns: dc.context.summary_threshold,
      keepRecent: dc.context.recent_messages,
      keepFirst: 0,
      max_age_hours: 14 * 24,
    })
      .catch((e) => log(`discord: summary for ${roomId} failed: ${e.message}`))
      .finally(() => compacting.delete(roomId));
  }

  async function answer(msg, dc) {
    const roomId = msg.channel_id;
    const where = msg.channel_name ? `#${msg.channel_name}` : roomId;
    try { await transport.typing?.(roomId); } catch { /* cosmetic */ }

    const config = cfgNow();
    let text = "";
    try {
      const note = await gatherDiscordContext(msg, { dc, config, roomName: msg.channel_name || "" });
      const turn = await runTurn({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt: `${msg.author?.name || "someone"}: ${msg.content}`,
        previousMessages: [],
        channel: CHANNELS.DISCORD,
        audience: "third_party",
        channelNote: note,
        relationshipBlock: relationshipFor(msg, dc),
        channelMeta: { chatId: roomId, discord: true, roomName: msg.channel_name || "" },
      });
      text = String(turn?.text || "").trim();
    } catch (e) {
      log(`discord: turn for ${msg.author?.name} in ${where} failed: ${e.message}`);
      await report("failed", roomId, `Discord ${where}: ${String(msg.author?.name || "alguien").slice(0, 40)} me llamó y no pude contestar (${e.message}).`);
      return { replied: false, error: e.message };
    }
    if (!text) {
      log(`discord: empty reply for ${msg.author?.name} in ${where} — nothing posted`);
      return { replied: false, error: "empty reply" };
    }

    const { parts, firstId } = await postDiscord({
      transport,
      channelId: roomId,
      text,
      replyTo: msg.id,
      room: msg.channel_name || null,
    });
    log(`discord: answered ${msg.author?.name} in ${where} (${text.length} chars, ${parts} message${parts === 1 ? "" : "s"})`);
    // No quote of the reply and a capped name: this lands in the owner's own
    // Telegram thread, and both were steered by whoever wrote in the room.
    await report("replied", roomId, `Discord ${where}: le contesté a ${String(msg.author?.name || "alguien").slice(0, 40)}.`);
    return { replied: true, messageId: firstId };
  }

  /**
   * Handle one inbound message. Resolves with the decision as soon as it is
   * made; the answer itself runs after the settle window, in the background.
   */
  async function handle(msg) {
    const dc = readDiscordConfig(cfgNow());
    // A message from someone whose answer is already waiting joins that answer
    // instead of asking the limits again: the cooldown their first call just
    // reserved would otherwise refuse the rest of their own burst.
    const key = `${msg.channel_id}|${msg.author?.id}`;
    const collapsing = pending.has(key);
    const decision = decideDiscordMessage(msg, {
      dc, botId: transport.botId?.(), limiter: collapsing ? null : limiter,
    });
    if (!decision.store) return decision;

    appendGlobalMessage({
      channel: CHANNELS.DISCORD,
      direction: "in",
      type: "user",
      author: msg.author?.name || "",
      actor_id: `discord:${msg.author?.id || "unknown"}`,
      body: msg.content,
      // Stamped with OUR clock, like every other row. The indexer's cursor is
      // the latest ts it has seen; a row carrying Discord's slightly older
      // time could land behind it and never be indexed.
      meta: { ...inboundMeta(msg), ...(msg.ts ? { discord_ts: msg.ts } : {}) },
    });
    maybeCompact(msg.channel_id, dc);

    if (!decision.reply) {
      if (decision.reason === SKIP_REASONS.CHANNEL_CAP) {
        const where = msg.channel_name ? `#${msg.channel_name}` : msg.channel_id;
        log(`discord: ${where} hit its hourly reply cap — staying quiet`);
        await report("cap", msg.channel_id, `Discord ${where}: llegué al tope de respuestas por hora y me callé. Si es flood o spam, conviene mirarlo.`);
      }
      return decision;
    }

    // Reserve the slot NOW, not when the answer runs. Recording it after the
    // settle window let every distinct caller inside that window pass the
    // hourly cap: a raid of N accounts bought N model turns.
    if (!collapsing) limiter.record({ channelId: msg.channel_id, userId: msg.author?.id });

    // Settle: a newer message from the same person in the same room replaces
    // the one waiting. Their whole burst is in the room's recent window anyway.
    const prev = pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const wait = settleMs ?? dc.limits.burst_window_ms;
    const entry = { msg };
    entry.done = new Promise((resolve) => {
      entry.resolve = resolve;
      entry.timer = setTimeout(() => {
        pending.delete(key);
        const p = answer(entry.msg, readDiscordConfig(cfgNow()))
          .catch((e) => {
            log(`discord: answer failed: ${e.message}`);
            return { replied: false, error: e.message };
          })
          .finally(() => running.delete(p));
        running.add(p);
        p.then(resolve);
      }, wait);
    });
    // The superseded message is answered by the same turn as the newer one.
    if (prev) prev.resolve(entry.done);
    pending.set(key, entry);
    return { ...decision, done: entry.done };
  }

  return {
    handle,
    /** Wait for every answer in flight. Tests and a clean shutdown use it. */
    async drain() {
      while (pending.size || running.size) {
        await Promise.all([...[...pending.values()].map((e) => e.done), ...running]);
      }
    },
    stop() {
      for (const e of pending.values()) {
        clearTimeout(e.timer);
        e.resolve({ replied: false, error: "stopped" });
      }
      pending.clear();
    },
  };
}
