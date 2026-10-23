// Twitch chat with a bot account: Twitch's IRC over a WebSocket (wss://irc-ws.chat.twitch.tv), no library. The
// streamer's chat is a room: the owner lists it in the rooms picker and picks how the bot answers there (only when
// @mentioned, for instance). Twitch no longer delivers whispers over chat, so there are no one-to-one conversations.
import { errorMessage } from "../errors.ts";
import { type IrcMessage, ircLine, pacer, parseIrcLine } from "./irc.ts";
import { sleep, splitText } from "./net.ts";
import { calledByName } from "./rooms.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, ChannelRefused, SendError } from "./types.ts";

const MAX_BACKOFF_MS = 60_000;
const REGISTER_MS = 30_000;
/** Twitch pings every five minutes or so: a socket silent much longer than that is gone. */
const DEAD_MS = 420_000;
const MAX_CHARS = 500;
/** A bot that is not a moderator may send 20 messages in 30 seconds. */
const BURST = 3;
const LINE_MS = 1500;
const LOGIN = /^[a-z0-9_]{3,25}$/;
/** Twitch's message ids; the ones made here when a message came without one are never a reply target. */
const MSG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED = /login authentication failed|improperly formatted auth|invalid nick/i;

/** The bot's login, its OAuth token (chat:read chat:edit) and the channel, stored as one secret. */
export function twitchSecret(secret: string | undefined): { login?: string; token?: string; channel?: string } {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const hashed = words.find((w) => w.startsWith("#"));
  const [login, token, bare] = words.filter((w) => w !== hashed).map((w) => w.toLowerCase());
  const channel = hashed?.toLowerCase() ?? (bare ? `#${bare}` : undefined);
  const t = token?.replace(/^oauth:/, "");
  return {
    ...(login && LOGIN.test(login) ? { login } : {}),
    ...(t && /^[a-z0-9]{20,40}$/.test(t) ? { token: t } : {}),
    ...(channel && LOGIN.test(channel.slice(1)) ? { channel } : {}),
  };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const twitchAdapter = ((config, secret, url = "wss://irc-ws.chat.twitch.tv:443"): ChannelAdapter => {
  const ac = new AbortController();
  const { login, token, channel } = twitchSecret(secret);
  const listedAs = (config.rooms?.rooms ?? []).find((r) => channel && same(r.id, channel))?.id;
  /** The room's id: the owner's spelling once listed, else the channel as Twitch writes it. */
  const room = listedAs ?? channel ?? "";
  const pace = pacer(BURST, LINE_MS, ac.signal);
  let socket: WebSocket | undefined;
  let ready = false;
  let n = 0;
  let loop: Promise<void> | undefined;

  const write = (line: string) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(`${line}\r\n`);
  };

  function privmsg(m: IrcMessage, io: AdapterIO): void {
    const [to, raw] = m.params;
    const from = m.nick;
    if (!to || raw === undefined || !from || !login || !channel || !same(to, channel) || same(from, login)) return;
    io.room?.({ id: room, name: room });
    if (!listedAs) return;
    // "/me waves" arrives as a CTCP ACTION: the words are what count.
    const said = raw.startsWith("\u0001ACTION ") && raw.endsWith("\u0001") ? raw.slice(8, -1) : raw;
    const own = new RegExp(`@${login}\\b`, "gi");
    const text = said.replace(own, "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const name = (m.tags["display-name"] || from).replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 60);
    io.receive({
      external_id: m.tags.id || `${Date.now()}-${++n}`,
      conversation: room,
      sender: { id: m.tags["user-id"] || from, name, handle: from },
      text,
      private: false,
      room: { called: calledByName(said, [login]) || same(m.tags["reply-parent-user-login"] ?? "", login) },
    });
  }

  /** One socket: tags and commands, PASS and NICK, JOIN, then lines until it closes or Twitch asks to reconnect. */
  function session(io: AdapterIO, welcomed: () => void): Promise<"again" | undefined> {
    return new Promise((resolve, reject) => {
      let registered = false;
      let again = false;
      let failure: Error | undefined;
      let lastSeen = Date.now();
      const ws = new WebSocket(url);
      socket = ws;
      const fail = (err: Error) => {
        failure ??= err;
        ws.close();
      };
      const giveUp = setTimeout(() => {
        if (!registered) fail(new Error("Twitch did not welcome the bot in time"));
      }, REGISTER_MS);
      const keepAlive = setInterval(() => {
        if (Date.now() - lastSeen > DEAD_MS) ws.close();
      }, 30_000);
      keepAlive.unref();
      const signal = AbortSignal.any([ac.signal, io.signal]);
      const onAbort = () => ws.close(1000, "stopped");
      signal.addEventListener("abort", onAbort, { once: true });

      function onLine(m: IrcMessage) {
        const [p0 = ""] = m.params;
        switch (m.command) {
          case "PING":
            return write(ircLine("PONG", m.params));
          case "RECONNECT":
            again = true;
            return ws.close();
          case "NOTICE":
            if (!registered && REFUSED.test(m.params.at(-1) ?? ""))
              fail(new ChannelRefused("Twitch refused the bot's token: make a new one with chat:read and chat:edit"));
            return;
          case "001":
            registered = true;
            ready = true;
            clearTimeout(giveUp);
            write(ircLine("JOIN", [channel ?? ""]));
            io.status("running");
            return welcomed();
          case "JOIN":
            if (m.nick && login && same(m.nick, login)) io.room?.({ id: room, name: room });
            return;
          case "PRIVMSG":
            return privmsg(m, io);
          case "CLEARCHAT":
            // The bot itself banned or timed out in the channel: the owner hears it in the app.
            if (login && same(m.params[1] ?? "", login)) io.status("error", `Twitch: the bot was removed from ${p0}`);
            return;
        }
      }

      ws.addEventListener("open", () => {
        write("CAP REQ :twitch.tv/tags twitch.tv/commands");
        write(`PASS oauth:${token}`);
        write(ircLine("NICK", [login ?? ""]));
      });
      ws.addEventListener("message", (msg) => {
        lastSeen = Date.now();
        for (const line of String(msg.data).split("\r\n")) {
          const m = line ? parseIrcLine(line) : undefined;
          if (m) onLine(m);
        }
      });
      ws.addEventListener("error", () => {
        failure ??= new Error("the connection to Twitch failed");
      });
      ws.addEventListener("close", () => {
        ready = false;
        clearTimeout(giveUp);
        clearInterval(keepAlive);
        signal.removeEventListener("abort", onAbort);
        if (registered) resolve(again ? "again" : undefined);
        else reject(failure ?? new Error("Twitch closed the connection before welcoming the bot"));
      });
    });
  }

  async function run(io: AdapterIO, first: { resolve(): void; reject(err: unknown): void }): Promise<void> {
    let welcomed = false;
    let backoff = 1000;
    const stopped = () => ac.signal.aborted || io.signal.aborted;
    while (!stopped()) {
      const opened = Date.now();
      try {
        const next = await session(io, () => {
          if (!welcomed) first.resolve();
          welcomed = true;
        });
        // Twitch asked for it before a restart of its own: connect again at once.
        if (next === "again") continue;
      } catch (err) {
        if (!welcomed) return first.reject(err);
        if (stopped()) return;
        io.status("error", `cannot reach Twitch: ${errorMessage(err)}`.slice(0, 200));
        if (err instanceof ChannelRefused) return;
      }
      if (stopped()) return;
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  return {
    caps: { typing: false, buttons: false },
    async start(io) {
      if (!login || !token || !channel)
        throw new ChannelRefused("Twitch needs the bot's login, its OAuth token and the channel (#name)");
      await new Promise<void>((resolve, reject) => {
        loop = run(io, { resolve, reject });
      });
      return { account: login };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p) {
      if (!same(conversation, room))
        throw new SendError("fatal", "Twitch: only the channel's chat can be written to (whispers are not supported)");
      const lines = p.text.split(/\r?\n/).flatMap((l) => (l.trim() ? splitText(l, MAX_CHARS) : []));
      const skip = p.skip ?? 0;
      for (let i = skip; i < lines.length; i++) {
        await pace();
        if (!ready) throw new SendError("retry", "Twitch: not connected", 5000, i - skip);
        const reply =
          i === 0 && p.reply_to && MSG_ID.test(p.reply_to) ? { "reply-parent-msg-id": p.reply_to } : undefined;
        write(ircLine("PRIVMSG", [channel ?? room, lines[i] ?? ""], reply));
      }
      return {};
    },
  };
}) satisfies AdapterFactory;
