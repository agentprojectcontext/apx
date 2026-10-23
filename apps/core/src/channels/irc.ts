// IRC with a nick of its own: one TCP (or TLS, ircs://) connection to any network, no library. Private messages are
// one-to-one; the channels (#room) the owner listed are joined and read as rooms. IRC has no buttons (numbered options)
// and no files. Someone is their services account when the network tags it (account-tag), else their nick, which
// anyone can take while it is free.
import net from "node:net";
import tls from "node:tls";
import { errorMessage } from "../errors.ts";
import { numberedOptions, sleep } from "./net.ts";
import { calledByName } from "./rooms.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, ChannelRefused, SendError } from "./types.ts";

const MAX_BACKOFF_MS = 60_000;
/** The server answers CAP LS at once; one that does not know CAP registers without it. */
const CAP_WAIT_MS = 4000;
const REGISTER_MS = 30_000;
const IDLE_MS = 120_000;
const DEAD_MS = 300_000;
const MAX_LINE = 512;
const BURST = 4;
const LINE_MS = 500;
/** The capabilities used when offered: message ids, services accounts, and SASL for the password. */
const WANTED_CAPS = ["message-tags", "account-tag", "sasl"] as const;
const CHANNEL = /^[#&]/;
const NICK = /^[A-Za-z[\]\\`_^{|}][\w[\]\\`^{|}-]{0,29}$/;
/** The ids made here for a network without message ids: never a reply target. */
const SYNTHETIC = /^\d+-\d+$/;

export type IrcMessage = {
  tags: Record<string, string>;
  /** `nick!user@host`, or a server's name. */
  prefix?: string;
  nick?: string;
  command: string;
  params: string[];
};

const UNESCAPE: Record<string, string> = { ":": ";", s: " ", "\\": "\\", r: "\r", n: "\n" };
const ESCAPE: Record<string, string> = { ";": "\\:", " ": "\\s", "\\": "\\\\", "\r": "\\r", "\n": "\\n" };

/** One line of the protocol (IRCv3 tags, prefix, command, params with the trailing one); none when malformed. */
export function parseIrcLine(line: string): IrcMessage | undefined {
  let rest = line.replace(/\r?\n$/, "").replace(/\r$/, "");
  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp < 0) return undefined;
    for (const kv of rest.slice(1, sp).split(";")) {
      if (!kv) continue;
      const eq = kv.indexOf("=");
      const key = eq < 0 ? kv : kv.slice(0, eq);
      tags[key] = eq < 0 ? "" : kv.slice(eq + 1).replace(/\\(.?)/g, (_, c: string) => UNESCAPE[c] ?? c);
    }
    rest = rest.slice(sp + 1).replace(/^ +/, "");
  }
  let prefix: string | undefined;
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    if (sp < 0) return undefined;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1).replace(/^ +/, "");
  }
  const params: string[] = [];
  while (rest) {
    if (rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const sp = rest.indexOf(" ");
    if (sp < 0) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1).replace(/^ +/, "");
  }
  const command = params.shift()?.toUpperCase();
  if (!command) return undefined;
  const nick = prefix?.split("!")[0]?.split("@")[0];
  return { tags, ...(prefix ? { prefix } : {}), ...(nick ? { nick } : {}), command, params };
}

/** A line to send (without CRLF). Line breaks and NUL never get through: a param cannot start a second command. */
export function ircLine(command: string, params: readonly string[] = [], tags?: Record<string, string>): string {
  const clean = (s: string) => s.replace(/[\r\n\0]/g, " ");
  const head = Object.entries(tags ?? {})
    .map(([k, v]) => (v ? `${k.replace(/[\s;=]/g, "")}=${v.replace(/[; \\\r\n]/g, (c) => ESCAPE[c] ?? c)}` : k))
    .join(";");
  const middle = params.slice(0, -1).map((p) => clean(p).replace(/ /g, "").replace(/^:+/, ""));
  const last = params.length ? clean(params[params.length - 1] ?? "") : undefined;
  const trailing =
    last === undefined ? [] : [last === "" || last.includes(" ") || last.startsWith(":") ? `:${last}` : last];
  return [...(head ? [`@${head}`] : []), command, ...middle, ...trailing].join(" ");
}

/** One line of text in parts of at most `max` UTF-8 bytes, cut at a space when there is one. */
export function splitBytes(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (Buffer.byteLength(rest) > max) {
    let end = 0;
    let bytes = 0;
    for (const ch of rest) {
      const b = Buffer.byteLength(ch);
      if (bytes + b > max) break;
      bytes += b;
      end += ch.length;
    }
    const space = rest.lastIndexOf(" ", end);
    const at = space > end / 2 ? space : end;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Lines out at the network's pace: a burst, then one every `everyMs` (servers disconnect a client that floods). */
export function pacer(burst: number, everyMs: number, signal: AbortSignal): () => Promise<void> {
  let credit = burst;
  let at = Date.now();
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(async () => {
      const now = Date.now();
      credit = Math.min(burst, credit + (now - at) / everyMs);
      at = now;
      if (credit < 1) {
        await sleep((1 - credit) * everyMs, signal);
        credit = 1;
        at = Date.now();
      }
      credit -= 1;
    });
    return chain;
  };
}

/** The words without IRC's bold, colour and other formatting codes. */
export function plainIrc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 3) i += /^\d{1,2}(,\d{1,2})?/.exec(text.slice(i + 1))?.[0].length ?? 0;
    else if (c === 4) i += /^[0-9a-f]{6}(,[0-9a-f]{6})?/i.exec(text.slice(i + 1))?.[0].length ?? 0;
    else if (c >= 32 && c !== 127) out += text[i];
  }
  return out;
}

/** The network and the bot's nick, stored as one secret: "ircs://irc.example.org:6697 apxbot [password]". */
export function ircSecret(secret: string | undefined): {
  host?: string;
  port?: number;
  tls?: boolean;
  nick?: string;
  password?: string;
} {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const address = words.find((w) => /^ircs?:\/\//i.test(w));
  const [nick, password] = words.filter((w) => w !== address);
  let server: { host: string; port: number; tls: boolean } | undefined;
  try {
    const u = address ? new URL(address) : undefined;
    const secure = u?.protocol.toLowerCase() === "ircs:";
    const host = u?.hostname.replace(/^\[|\]$/g, "");
    if (u && host) server = { host, port: Number(u.port) || (secure ? 6697 : 6667), tls: secure };
  } catch {
    server = undefined;
  }
  return {
    ...(server ?? {}),
    ...(nick && NICK.test(nick) ? { nick, ...(password ? { password } : {}) } : {}),
  };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ircAdapter = ((config, secret): ChannelAdapter => {
  const ac = new AbortController();
  const target = ircSecret(secret);
  /** The listed rooms by lowercase name: IRC channel names ignore case, the room keeps the owner's spelling. */
  const listed = new Map((config.rooms?.rooms ?? []).map((r) => [r.id.toLowerCase(), r.id]));
  const options = numberedOptions();
  const pace = pacer(BURST, LINE_MS, ac.signal);
  let socket: net.Socket | undefined;
  let ready = false;
  let me = target.nick ?? "";
  let caps = new Set<string>();
  let n = 0;
  let loop: Promise<void> | undefined;

  const write = (line: string) => {
    if (socket?.writable) socket.write(`${line}\r\n`);
  };
  const roomId = (name: string) => listed.get(name.toLowerCase()) ?? name;

  function privmsg(m: IrcMessage, io: AdapterIO): void {
    const [to, raw] = m.params;
    const from = m.nick;
    // A server's notice has no user prefix; CTCP (VERSION, ACTION…) is not a message to answer.
    if (!to || raw === undefined || !from || !m.prefix?.includes("!") || same(from, me) || raw.startsWith("\u0001"))
      return;
    const text = plainIrc(raw).trim();
    if (!text) return;
    const account = m.tags.account;
    const sender = { id: account ? `account:${account}` : `nick:${from.toLowerCase()}`, name: from, handle: from };
    const external_id = m.tags.msgid ?? `${Date.now()}-${++n}`;
    if (CHANNEL.test(to)) {
      const id = roomId(to);
      io.room?.({ id, name: id });
      if (!listed.has(to.toLowerCase())) return;
      // "apxbot: hi" is how IRC addresses someone: the address calls the bot and says nothing itself.
      const addressed = new RegExp(`^${escapeRe(me)}[:,]\\s*`, "i");
      io.receive({
        external_id,
        conversation: id,
        sender,
        text: text.replace(addressed, "").trim() || text,
        private: false,
        room: { called: calledByName(text, [me]) },
      });
      return;
    }
    if (!same(to, me)) return;
    const picked = options.pick(from, text);
    if (picked) io.action({ conversation: from, sender, data: picked });
    else io.receive({ external_id, conversation: from, sender, text, private: true });
  }

  /** One connection: capabilities, SASL or PASS, NICK and USER, then lines until it closes. */
  function session(io: AdapterIO, welcomed: () => void): Promise<void> {
    const { host = "", port = 6697, nick = "", password } = target;
    return new Promise((resolve, reject) => {
      let wanted = nick;
      let registered = false;
      let registering = false;
      let offered = "";
      let failure: Error | undefined;
      let lastSeen = Date.now();
      let buf = "";
      me = nick;
      caps = new Set();
      const s = target.tls
        ? tls.connect({ host, port, ...(net.isIP(host) ? {} : { servername: host }) })
        : net.connect({ host, port });
      socket = s;
      s.setEncoding("utf8");
      const fail = (err: Error) => {
        failure ??= err;
        s.destroy();
      };
      const register = (sasl: boolean) => {
        if (registering) return;
        registering = true;
        clearTimeout(capWait);
        if (password && !sasl) write(ircLine("PASS", [password]));
        write(ircLine("NICK", [wanted]));
        write(ircLine("USER", [nick, "0", "*", "APX"]));
      };
      const authenticate = () => {
        const b64 = Buffer.from(`${nick}\0${nick}\0${password ?? ""}`).toString("base64");
        for (let i = 0; i < b64.length; i += 400) write(`AUTHENTICATE ${b64.slice(i, i + 400)}`);
        if (b64.length % 400 === 0) write("AUTHENTICATE +");
      };
      let capWait: ReturnType<typeof setTimeout> | undefined;
      const giveUp = setTimeout(() => {
        if (!registered) fail(new Error("the IRC server did not welcome the bot in time"));
      }, REGISTER_MS);
      const keepAlive = setInterval(() => {
        const idle = Date.now() - lastSeen;
        if (idle > DEAD_MS) s.destroy();
        else if (idle > IDLE_MS) write("PING :apx");
      }, 30_000);
      keepAlive.unref();
      const onAbort = () => {
        s.end(`${ircLine("QUIT", ["Stopped"])}\r\n`);
        setTimeout(() => s.destroy(), 1000).unref();
      };
      const signal = AbortSignal.any([ac.signal, io.signal]);
      signal.addEventListener("abort", onAbort, { once: true });

      function onLine(m: IrcMessage) {
        const [p0 = "", p1 = ""] = m.params;
        const last = m.params.at(-1) ?? "";
        switch (m.command) {
          case "PING":
            return write(ircLine("PONG", m.params));
          case "CAP":
            if (p1 === "LS") {
              offered += ` ${last}`;
              if (m.params[2] === "*") return;
              const have = new Set(offered.split(" ").map((c) => c.split("=")[0]));
              const want = WANTED_CAPS.filter((c) => have.has(c) && (c !== "sasl" || password));
              register(want.includes("sasl"));
              return write(want.length ? ircLine("CAP", ["REQ", want.join(" ")]) : "CAP END");
            }
            if (p1 === "ACK") {
              for (const c of last.split(" ")) if (c) caps.add(c.replace(/^-/, ""));
              return write(caps.has("sasl") && password ? "AUTHENTICATE PLAIN" : "CAP END");
            }
            if (p1 === "NAK") return write("CAP END");
            return;
          case "AUTHENTICATE":
            if (p0 === "+") authenticate();
            return;
          case "903":
            return write("CAP END");
          case "902":
          case "904":
          case "905":
            return fail(new ChannelRefused("the IRC network refused the bot's password (SASL)"));
          case "464":
            return fail(new ChannelRefused("the IRC server refused the password"));
          case "465":
            return fail(new ChannelRefused("the IRC server banned this connection"));
          case "432":
            return fail(new ChannelRefused(`the IRC server does not accept the nick ${wanted}`));
          case "433":
            if (registered) return;
            wanted = wanted.length < 30 ? `${wanted}_` : `${wanted.slice(0, 29)}${Math.floor(Math.random() * 10)}`;
            return write(ircLine("NICK", [wanted]));
          case "001":
            registered = true;
            ready = true;
            me = p0 || wanted;
            clearTimeout(giveUp);
            if (listed.size) write(ircLine("JOIN", [[...listed.values()].join(",")]));
            io.status("running");
            return welcomed();
          case "NICK":
            if (m.nick && same(m.nick, me)) me = p0;
            return;
          case "JOIN":
            if (m.nick && same(m.nick, me) && CHANNEL.test(p0)) io.room?.({ id: roomId(p0), name: roomId(p0) });
            return;
          case "KICK":
            if (same(p1, me)) io.room?.({ id: roomId(p0), name: roomId(p0), left: true });
            return;
          case "INVITE":
            // Offered in the rooms picker; listing it joins it on the restart that follows.
            if (CHANNEL.test(p1)) io.room?.({ id: roomId(p1), name: roomId(p1) });
            return;
          case "PRIVMSG":
            return privmsg(m, io);
        }
      }

      s.on(target.tls ? "secureConnect" : "connect", () => {
        write("CAP LS 302");
        capWait = setTimeout(() => register(false), CAP_WAIT_MS);
      });
      s.on("data", (chunk: string) => {
        lastSeen = Date.now();
        buf += chunk;
        if (buf.length > 64 * MAX_LINE) return fail(new Error("the IRC server sent a line too long"));
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const m = parseIrcLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (m) onLine(m);
        }
      });
      s.on("error", (err) => {
        failure ??= err;
      });
      s.on("close", () => {
        ready = false;
        clearTimeout(giveUp);
        clearTimeout(capWait);
        clearInterval(keepAlive);
        signal.removeEventListener("abort", onAbort);
        if (registered) resolve();
        else reject(failure ?? new Error("the IRC server closed the connection before welcoming the bot"));
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
        await session(io, () => {
          if (!welcomed) first.resolve();
          welcomed = true;
        });
      } catch (err) {
        if (!welcomed) return first.reject(err);
        if (stopped()) return;
        io.status("error", `cannot reach the IRC server: ${errorMessage(err)}`.slice(0, 200));
        // A password refused now will be refused again: the owner changes it, which starts the channel anew.
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
      if (!target.host || !target.nick)
        throw new ChannelRefused("IRC needs the server's address (ircs://host:6697) and the bot's nick");
      await new Promise<void>((resolve, reject) => {
        loop = run(io, { resolve, reject });
      });
      return { account: me };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p) {
      const full = options.text(conversation, p.text, p.buttons);
      // Each line goes whole as the server will relay it: ":nick!user@host PRIVMSG to :…\r\n" within 512 bytes.
      const overhead = `:${me}!${"u".repeat(10)}@${"h".repeat(63)} PRIVMSG ${conversation} :\r\n`;
      const room = CHANNEL.test(conversation);
      const lines = full
        .split(/\r?\n/)
        .flatMap((l) => (l.trim() ? splitBytes(l, MAX_LINE - Buffer.byteLength(overhead)) : []));
      const reply =
        room && p.reply_to && caps.has("message-tags") && !SYNTHETIC.test(p.reply_to)
          ? { "+draft/reply": p.reply_to }
          : undefined;
      const skip = p.skip ?? 0;
      for (let i = skip; i < lines.length; i++) {
        await pace();
        if (!ready || !socket?.writable) throw new SendError("retry", "IRC: not connected", 5000, i - skip);
        write(ircLine("PRIVMSG", [conversation, lines[i] ?? ""], i === 0 ? reply : undefined));
      }
      return {};
    },
  };
}) satisfies AdapterFactory;
