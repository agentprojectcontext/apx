// An IRC server and Twitch's chat (IRC over a WebSocket) on localhost for tests: just the lines their adapters use,
// plus a way for a test to write as someone and to read what the bot sent.
import http from "node:http";
import net from "node:net";
import { WebSocketServer } from "ws";
import { ircLine, parseIrcLine } from "./irc.ts";

export type Sent = { to: string; text: string; tags: Record<string, string> };

export type FakeIrc = {
  url: string;
  /** A message from `from` to the bot, or in `room` (a #channel). */
  message(from: string, text: string, opts?: { room?: string; account?: string }): void;
  /** What the bot said to `to` (a nick or a #channel). */
  sentTo(to: string): Sent[];
  /** The channels the bot joined, and the nick it got. */
  joined: Set<string>;
  nick(): string;
  /** Every line the bot sent. */
  lines: string[];
  close(): Promise<void>;
};

export async function fakeIrc(opts: { password?: string; sasl?: boolean; taken?: string[] } = {}): Promise<FakeIrc> {
  const sent: Sent[] = [];
  const lines: string[] = [];
  const joined = new Set<string>();
  const clients = new Set<net.Socket>();
  let nick = "";
  let tagged = false;
  let n = 1;
  const server = net.createServer((s) => {
    clients.add(s);
    let buf = "";
    let user = false;
    let capping = false;
    let pass = "";
    let authed = false;
    const out = (line: string) => s.write(`${line}\r\n`);
    const welcome = () => {
      if (!nick || !user || capping) return;
      if (opts.password && !authed && pass !== opts.password) {
        out(":irc.example.org 464 * :Password incorrect");
        return void s.end();
      }
      out(`:irc.example.org 001 ${nick} :Welcome to the Acme network`);
    };
    s.on("data", (chunk) => {
      buf += String(chunk);
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const raw = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        lines.push(raw);
        const m = parseIrcLine(raw);
        if (!m) continue;
        const [p0 = "", p1 = ""] = m.params;
        if (m.command === "CAP" && p0 === "LS") {
          capping = true;
          out(`:irc.example.org CAP * LS :message-tags account-tag${opts.sasl ? " sasl" : ""}`);
        } else if (m.command === "CAP" && p0 === "REQ") {
          tagged = p1.includes("message-tags");
          out(`:irc.example.org CAP * ACK :${p1}`);
        } else if (m.command === "CAP" && p0 === "END") {
          capping = false;
          welcome();
        } else if (m.command === "AUTHENTICATE" && p0 === "PLAIN") out("AUTHENTICATE +");
        else if (m.command === "AUTHENTICATE") {
          const [, , password] = Buffer.from(p0, "base64").toString().split("\0");
          authed = password === opts.password;
          out(authed ? ":irc.example.org 903 * :SASL authentication successful" : ":irc.example.org 904 * :failed");
        } else if (m.command === "PASS") pass = p0;
        else if (m.command === "NICK") {
          if (opts.taken?.includes(p0)) out(`:irc.example.org 433 * ${p0} :Nickname is already in use`);
          else {
            nick = p0;
            welcome();
          }
        } else if (m.command === "USER") {
          user = true;
          welcome();
        } else if (m.command === "JOIN")
          for (const ch of p0.split(",")) {
            joined.add(ch);
            out(`:${nick}!bot@apx.example JOIN ${ch}`);
          }
        else if (m.command === "PING") out(ircLine("PONG", ["irc.example.org", p0]));
        else if (m.command === "PRIVMSG") sent.push({ to: p0, text: p1, tags: m.tags });
        else if (m.command === "QUIT") s.end();
      }
    });
    s.on("error", () => {});
    s.on("close", () => clients.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `irc://127.0.0.1:${port}`,
    message(from, text, o = {}) {
      const tags: Record<string, string> = tagged ? { msgid: `m${n++}` } : {};
      if (o.account) tags.account = o.account;
      const line = ircLine("PRIVMSG", [o.room ?? nick, text], tags).replace(
        /PRIVMSG/,
        `:${from}!${from}@users.example PRIVMSG`,
      );
      for (const s of clients) s.write(`${line}\r\n`);
    },
    sentTo: (to) => sent.filter((x) => x.to.toLowerCase() === to.toLowerCase()),
    joined,
    nick: () => nick,
    lines,
    close: async () => {
      for (const s of clients) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type FakeTwitch = {
  url: string;
  token: string;
  /** A chat message in the channel from `login`; returns its id. */
  message(login: string, text: string): string;
  sent: Sent[];
  /** Asks the bot to connect again (Twitch does before restarting a server). */
  reconnect(): void;
  connections(): number;
  close(): Promise<void>;
};

export async function fakeTwitch(channel: string): Promise<FakeTwitch> {
  const TOKEN = "abcdefghijklmnopqrstuvwxyz0123";
  const sent: Sent[] = [];
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const sockets = new Set<import("ws").WebSocket>();
  let connections = 0;
  let n = 1;
  wss.on("connection", (ws) => {
    connections++;
    let pass = "";
    const out = (line: string) => ws.send(`${line}\r\n`);
    ws.on("message", (raw) => {
      for (const l of String(raw).split("\r\n")) {
        const m = parseIrcLine(l);
        if (!m) continue;
        const [p0 = "", p1 = ""] = m.params;
        if (m.command === "CAP") out(`:tmi.twitch.tv CAP * ACK :${p1}`);
        else if (m.command === "PASS") pass = p0;
        else if (m.command === "NICK") {
          if (pass !== `oauth:${TOKEN}`) {
            out(":tmi.twitch.tv NOTICE * :Login authentication failed");
            ws.close();
            continue;
          }
          sockets.add(ws);
          out(`:tmi.twitch.tv 001 ${p0} :Welcome, GLHF!`);
        } else if (m.command === "JOIN") out(`:apxbot!apxbot@apxbot.tmi.twitch.tv JOIN ${p0}`);
        else if (m.command === "PING") out(`PONG :${p0}`);
        else if (m.command === "PRIVMSG") sent.push({ to: p0, text: p1, tags: m.tags });
      }
    });
    ws.on("close", () => sockets.delete(ws));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    message(login, text) {
      const id = `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
      const tags = {
        "display-name": `${login.slice(0, 1).toUpperCase()}${login.slice(1)}`,
        id,
        "user-id": `${1000 + login.length}`,
      };
      const line = ircLine("PRIVMSG", [channel, text], tags).replace(
        / PRIVMSG/,
        ` :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG`,
      );
      for (const ws of sockets) ws.send(`${line}\r\n`);
      return id;
    },
    sent,
    reconnect() {
      for (const ws of sockets) {
        ws.send(":tmi.twitch.tv RECONNECT\r\n");
        ws.close();
      }
    },
    connections: () => connections,
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
