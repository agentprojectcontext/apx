// Discord transport: one bot connection — the Gateway for reading, REST for
// writing.
//
// Written against the raw Gateway v10 protocol with `ws` (already a
// dependency) instead of pulling in discord.js: we need four events and two
// endpoints, and a 20 MB client library for that would be most of the
// install size of this channel.
//
// What the protocol asks of a client, and what this file does about it:
//   Hello (op 10)          → heartbeat every interval, first beat jittered
//   Heartbeat ACK (op 11)  → missing ACK means a zombie connection: reconnect
//   Heartbeat (op 1)       → the server asked for a beat now
//   Reconnect (op 7)       → reconnect and RESUME
//   Invalid Session (op 9) → resume if d=true, else identify afresh after 1–5 s
//   Dispatch (op 0)        → READY, GUILD_CREATE, CHANNEL_*, THREAD_*, MESSAGE_CREATE
//
// Close codes that must NOT be retried: a bad token (4004) and intents the
// application is not allowed (4013/4014) — retrying those only gets the bot
// rate-limited, and the fix is in the Developer Portal, not here.
import WebSocket from "ws";

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

// GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT. The last one is privileged: it has
// to be switched on for the application in the Developer Portal, or the
// gateway closes with 4014.
export const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

const FATAL_CLOSE = {
  4004: "the bot token was rejected — check discord.token",
  4010: "invalid shard",
  4011: "sharding required",
  4012: "invalid API version",
  4013: "invalid intents",
  4014: "Message Content Intent is not enabled for this bot — turn it on in the Developer Portal (Bot → Privileged Gateway Intents)",
};

// The CDN address of a user's avatar, or null for the default one.
function avatarUrl(user) {
  if (!user?.id || !user.avatar) return null;
  const ext = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

// What Discord accepts as an avatar, and how big. Checked here so a wrong file
// is refused with a sentence instead of Discord's 400. The size cap is ours,
// not Discord's: the daemon's JSON body limit is 2 MB, and the panel downsizes
// the picture to 512 px before sending, which lands far under it.
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const AVATAR_MAX_BYTES = 1.5 * 1024 * 1024;

export function avatarProblem(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) return "the avatar must be an image sent as a data: URL";
  if (!AVATAR_TYPES.includes(m[1])) return "the avatar must be a PNG, JPEG, GIF or WebP image";
  if (Math.floor((m[2].length * 3) / 4) > AVATAR_MAX_BYTES) return "the avatar must be under 1.5 MB";
  return null;
}

// Channel types that are threads (their parent is the room that governs them).
const THREAD_TYPES = new Set([10, 11, 12]);

// Channel types a bot can read and post text in: text, announcement, forum.
// Voice, stage and categories are not rooms for this channel.
const TEXT_ROOM_TYPES = new Set([0, 5, 15]);
const CATEGORY_TYPE = 4;

/**
 * A Discord MESSAGE_CREATE payload, reduced to what the dispatcher reads.
 * `channels` is the name/parent cache the gateway keeps from guild events.
 */
/**
 * Discord writes mentions as ids — `<@123>`, `<#456>`, `<@&789>` — and a model
 * reading "<@1554271631227224091> ya está acá" does not know that is itself.
 * Turn them into the names a person sees in the client.
 */
export function readableMentions(text, { mentions = [], channels = new Map() } = {}) {
  const names = new Map(mentions.map((m) => [m.id, m.member?.nick || m.global_name || m.username || "someone"]));
  return String(text || "")
    .replace(/<@!?(\d+)>/g, (_m, id) => `@${names.get(id) || "someone"}`)
    .replace(/<#(\d+)>/g, (_m, id) => `#${channels.get(id)?.name || "channel"}`)
    .replace(/<@&(\d+)>/g, "@role");
}

export function normalizeDiscordMessage(d, channels = new Map()) {
  const room = channels.get(d.channel_id) || {};
  const author = d.author || {};
  const ref = d.referenced_message || null;
  return {
    id: d.id,
    channel_id: d.channel_id,
    guild_id: d.guild_id || null,
    parent_id: room.parent_id || null,
    channel_name: room.name || null,
    author: {
      id: author.id,
      name: d.member?.nick || author.global_name || author.username || "someone",
      bot: author.bot === true,
    },
    content: readableMentions(d.content, { mentions: d.mentions || [], channels }),
    mentions: (d.mentions || []).map((m) => m.id),
    mention_everyone: d.mention_everyone === true,
    reply_to: ref
      ? {
          id: ref.id,
          author_id: ref.author?.id || null,
          author_name: ref.member?.nick || ref.author?.global_name || ref.author?.username || null,
          content: readableMentions(ref.content, { mentions: ref.mentions || [], channels }),
        }
      : null,
    ts: d.timestamp ? new Date(d.timestamp).toISOString() : null,
  };
}

/**
 * Open and keep one bot connection.
 *
 * onMessage(normalizedMessage) is called for every MESSAGE_CREATE in a guild.
 * `WebSocketImpl`, `fetchImpl`, `gatewayUrl` and `apiBase` exist for tests.
 */
export function createDiscordGateway({
  token,
  log = () => {},
  onMessage = () => {},
  onStatus = () => {},
  WebSocketImpl = WebSocket,
  fetchImpl = globalThis.fetch,
  gatewayUrl = DISCORD_GATEWAY,
  apiBase = DISCORD_API,
  intents = DISCORD_INTENTS,
} = {}) {
  if (!token) throw new Error("discord: no bot token configured");

  let ws = null;
  let seq = null;
  let sessionId = null;
  let resumeUrl = null;
  let botUser = null;
  let heartbeat = null;
  let acked = true;
  let stopped = false;
  let backoffMs = 1_000;
  let state = "off";
  let lastError = null;
  const channels = new Map(); // id → { name, parent_id, guild_id, type, category_id, position }
  const guilds = new Map();   // id → name

  function setState(s, error = null) {
    state = s;
    lastError = error;
    onStatus({ state, error, bot: botUser });
  }

  function send(op, d) {
    if (ws?.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify({ op, d }));
  }

  function rememberChannel(c) {
    if (!c?.id) return;
    const thread = THREAD_TYPES.has(c.type);
    channels.set(c.id, {
      name: c.name || null,
      parent_id: thread ? c.parent_id || null : null,
      // For a room, its parent is a CATEGORY — shown as a heading in the
      // picker, never used to decide a mode.
      category_id: thread ? null : c.parent_id || null,
      guild_id: c.guild_id || null,
      type: c.type ?? null,
      position: c.position ?? 0,
    });
  }

  function clearHeartbeat() {
    if (heartbeat) {
      clearInterval(heartbeat.interval);
      clearTimeout(heartbeat.first);
    }
    heartbeat = null;
  }

  function startHeartbeat(intervalMs) {
    clearHeartbeat();
    acked = true;
    const beat = () => {
      if (!acked) {
        // No ACK since the last beat: the connection is a zombie. Drop it and
        // resume; waiting longer only delays the messages it is not delivering.
        log("discord: heartbeat not acknowledged — reconnecting");
        // terminate, not close: a close handshake on a dead TCP connection
        // waits out ws's own timeout before the reconnect can even start.
        ws?.terminate();
        return;
      }
      acked = false;
      send(1, seq);
    };
    // The interval starts from the first (jittered) beat, not alongside it: a
    // jitter near 1.0 would otherwise put two beats a few ms apart, and the
    // second would find the first unacknowledged and tear down a healthy link.
    heartbeat = { interval: null };
    heartbeat.first = setTimeout(() => {
      beat();
      if (heartbeat) heartbeat.interval = setInterval(beat, intervalMs);
    }, Math.floor(intervalMs * Math.random()));
  }

  function identify() {
    send(2, {
      token,
      intents,
      properties: { os: process.platform, browser: "apx", device: "apx" },
    });
  }

  function resume() {
    send(6, { token, session_id: sessionId, seq });
  }

  function onDispatch(t, d) {
    if (t === "READY") {
      sessionId = d.session_id;
      resumeUrl = d.resume_gateway_url ? `${d.resume_gateway_url}/?v=10&encoding=json` : null;
      botUser = { id: d.user?.id, name: d.user?.username, avatar_url: avatarUrl(d.user) };
      backoffMs = 1_000;
      setState("connected");
      log(`discord: connected as ${botUser.name} (${botUser.id})`);
    } else if (t === "RESUMED") {
      backoffMs = 1_000;
      setState("connected");
      log("discord: session resumed");
    } else if (t === "GUILD_CREATE") {
      guilds.set(d.id, d.name || null);
      for (const c of d.channels || []) rememberChannel({ ...c, guild_id: d.id });
      for (const c of d.threads || []) rememberChannel({ ...c, guild_id: d.id });
    } else if (t === "CHANNEL_CREATE" || t === "CHANNEL_UPDATE" || t === "THREAD_CREATE" || t === "THREAD_UPDATE") {
      rememberChannel(d);
    } else if (t === "MESSAGE_CREATE") {
      if (!d.guild_id) return; // DMs are not a room; not handled here
      try {
        const r = onMessage(normalizeDiscordMessage(d, channels));
        r?.catch?.((e) => log(`discord: message handler failed: ${e.message}`));
      } catch (e) {
        log(`discord: message handler failed: ${e.message}`);
      }
    }
  }

  function connect(useResume = false) {
    if (stopped) return;
    const url = useResume && resumeUrl ? resumeUrl : gatewayUrl;
    setState("connecting");
    ws = new WebSocketImpl(url);
    ws.on("message", (raw) => {
      let p;
      try { p = JSON.parse(String(raw)); } catch { return; }
      if (p.s != null) seq = p.s;
      switch (p.op) {
        case 10:
          startHeartbeat(p.d.heartbeat_interval);
          if (useResume && sessionId) resume();
          else identify();
          break;
        case 11:
          acked = true;
          break;
        case 1:
          send(1, seq);
          break;
        case 7:
          ws.close(4000, "reconnect requested");
          break;
        case 9: {
          const resumable = p.d === true;
          if (!resumable) { sessionId = null; seq = null; }
          // Bound to THIS socket: if Discord closes it in the meantime (it
          // usually does) the reconnect identifies on its own Hello, and a
          // stale timer sending a second IDENTIFY there gets closed with 4005.
          const sock = ws;
          setTimeout(() => {
            if (ws !== sock || stopped) return;
            if (resumable) resume();
            else identify();
          }, 1_000 + Math.random() * 4_000);
          break;
        }
        case 0:
          onDispatch(p.t, p.d || {});
          break;
        default:
          break;
      }
    });
    ws.on("close", (code) => {
      clearHeartbeat();
      if (stopped) return setState("off");
      if (FATAL_CLOSE[code]) {
        log(`discord: gateway closed ${code} — ${FATAL_CLOSE[code]}. Not retrying.`);
        return setState("error", FATAL_CLOSE[code]);
      }
      // Invalid seq / session timed out: that session cannot be resumed, so
      // the next connection identifies afresh instead of trying.
      if (code === 4007 || code === 4009) { sessionId = null; seq = null; }
      const wait = backoffMs;
      backoffMs = Math.min(backoffMs * 2, 60_000);
      log(`discord: gateway closed (${code}) — reconnecting in ${Math.round(wait / 1000)}s`);
      setState("reconnecting");
      setTimeout(() => connect(Boolean(sessionId)), wait);
    });
    ws.on("error", (e) => log(`discord: gateway error: ${e.message}`));
  }

  async function rest(method, route, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(`${apiBase}${route}`, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          "content-type": "application/json",
          "user-agent": "DiscordBot (https://github.com/agentprojectcontext/apx, 1)",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt === 0) {
        const j = await res.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, Math.min(Number(j.retry_after || 1) * 1000, 10_000)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`discord ${method} ${route} → ${res.status} ${text.slice(0, 200)}`);
      }
      return res.status === 204 ? null : res.json();
    }
    throw new Error(`discord ${method} ${route} → rate limited`);
  }

  return {
    start() {
      stopped = false;
      connect(false);
    },
    stop() {
      stopped = true;
      clearHeartbeat();
      try { ws?.close(1000, "stop"); } catch { /* already closed */ }
      setState("off");
    },
    status() {
      return { state, error: lastError, bot: botUser, rooms_known: channels.size, guilds: guilds.size };
    },
    botId: () => botUser?.id || null,
    channelName: (id) => channels.get(id)?.name || null,
    /**
     * The text rooms of every server the bot is in, as Discord reported them
     * at connect time (GUILD_CREATE) and since. Empty until the bot has been
     * invited somewhere — that is the answer to "why is the list empty".
     */
    rooms() {
      const out = [];
      for (const [id, c] of channels) {
        if (!TEXT_ROOM_TYPES.has(c.type)) continue;
        const cat = c.category_id ? channels.get(c.category_id) : null;
        out.push({
          id,
          name: c.name,
          guild_id: c.guild_id,
          guild: guilds.get(c.guild_id) || null,
          category: cat?.type === CATEGORY_TYPE ? cat.name : null,
          category_position: cat?.position ?? -1,
          position: c.position,
        });
      }
      out.sort((a, b) =>
        String(a.guild).localeCompare(String(b.guild)) ||
        a.category_position - b.category_position ||
        a.position - b.position);
      return out.map(({ category_position: _c, position: _p, ...r }) => r);
    },
    /**
     * Post a message. Mentions are switched off at the API level, whatever the
     * text says: the model is told never to @everyone, and this is what makes
     * that true even when it does. Only the person being replied to is pinged.
     */
    async send(channelId, content, { replyTo = null } = {}) {
      return rest("POST", `/channels/${channelId}/messages`, {
        content,
        allowed_mentions: { parse: [], replied_user: true },
        ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
      });
    },
    /**
     * Change the bot's own avatar. Discord rate-limits this hard (a couple of
     * changes an hour), so a 429 here is surfaced, not retried in a loop.
     */
    async setAvatar(dataUrl) {
      const problem = avatarProblem(dataUrl);
      if (problem) throw new Error(problem);
      const user = await rest("PATCH", "/users/@me", { avatar: dataUrl });
      botUser = { ...(botUser || {}), id: user.id, name: user.username, avatar_url: avatarUrl(user) };
      onStatus({ state, error: lastError, bot: botUser });
      return botUser;
    },
    async typing(channelId) {
      return rest("POST", `/channels/${channelId}/typing`);
    },
    /** Recent messages of a channel, newest first, straight from Discord. */
    async history(channelId, { limit = 50, before = null } = {}) {
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
      if (before) q.set("before", before);
      const rows = await rest("GET", `/channels/${channelId}/messages?${q}`);
      return (rows || []).map((d) => normalizeDiscordMessage(d, channels));
    },
  };
}
