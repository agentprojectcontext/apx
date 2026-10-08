// An IMAP server and an SMTP server on localhost for tests, in plain text (the adapter allows that only to this
// machine): just the commands the email adapter uses, a way for a test to drop mail into the mailbox, and the mail
// the agent sent.
import { randomUUID } from "node:crypto";
import net from "node:net";

const listen = async (server: net.Server) => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as net.AddressInfo).port;
};

/** Calls `onLine` for each CRLF line; `raw(n)` switches to reading until a terminator (SMTP's DATA). */
function lines(sock: net.Socket, onLine: (line: string) => void) {
  let buf = "";
  let until: { end: string; done: (body: string) => void } | undefined;
  sock.on("data", (d: Buffer) => {
    buf += d.toString("latin1");
    for (;;) {
      if (until) {
        const at = buf.indexOf(until.end);
        if (at < 0) return;
        const body = buf.slice(0, at);
        buf = buf.slice(at + until.end.length);
        const u = until;
        until = undefined;
        u.done(body);
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      onLine(line);
    }
  });
  sock.on("error", () => {});
  return { readUntil: (end: string, done: (body: string) => void) => (until = { end, done }) };
}

export type FakeImap = {
  port: number;
  /** Drops a message (raw RFC 5322) into the mailbox, received now or `at`; returns its UID. */
  deliver(raw: string, at?: Date): number;
  /** The server renumbers the mailbox (a new UIDVALIDITY): every message gets a new UID. */
  renumber(): void;
  /** How many messages were fetched. */
  fetches(): number;
  close(): Promise<void>;
};

export async function fakeImap(opts: { user: string; pass: string; idle?: boolean }): Promise<FakeImap> {
  let uidvalidity = 1000;
  let nextUid = 1;
  let fetched = 0;
  let box: Array<{ uid: number; raw: string; at: Date }> = [];
  const idling = new Map<net.Socket, string>();
  /** How many messages each session was told of. */
  const seen = new Map<net.Socket, number>();
  const sockets = new Set<net.Socket>();
  const caps = `IMAP4rev1 AUTH=PLAIN${opts.idle === false ? "" : " IDLE"}`;

  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => {
      sockets.delete(sock);
      idling.delete(sock);
    });
    const send = (s: string) => sock.writable && sock.write(`${s}\r\n`);
    let authing: string | undefined;
    let authed = false;
    send("* OK fake IMAP ready");
    lines(sock, (line) => {
      if (authing) {
        const [, u, p] = Buffer.from(line, "base64").toString("utf8").split("\0");
        authed = u === opts.user && p === opts.pass;
        send(authed ? `${authing} OK signed in` : `${authing} NO [AUTHENTICATIONFAILED] invalid credentials`);
        authing = undefined;
        return;
      }
      if (line === "DONE") {
        const tag = idling.get(sock);
        idling.delete(sock);
        if (tag) send(`${tag} OK IDLE terminated`);
        return;
      }
      const [tag = "*", cmd = "", ...rest] = line.split(" ");
      const args = rest.join(" ");
      const c = cmd.toUpperCase();
      // Like a real server, mail that arrived meanwhile is told with the next command's answer.
      if (authed && box.length > (seen.get(sock) ?? box.length)) send(`* ${box.length} EXISTS`);
      seen.set(sock, box.length);
      if (c === "CAPABILITY") {
        send(`* CAPABILITY ${caps}`);
        return send(`${tag} OK`);
      }
      if (c === "AUTHENTICATE") {
        authing = tag;
        return send("+ ");
      }
      if (c === "LOGOUT") {
        send("* BYE");
        send(`${tag} OK`);
        return sock.end();
      }
      if (!authed) return send(`${tag} NO sign in first`);
      if (c === "EXAMINE" || c === "SELECT") {
        send(`* ${box.length} EXISTS`);
        send(`* OK [UIDVALIDITY ${uidvalidity}] UIDs valid`);
        send(`* OK [UIDNEXT ${nextUid}] next`);
        return send(`${tag} OK [READ-ONLY] done`);
      }
      if (c === "NOOP") return send(`${tag} OK`);
      if (c === "IDLE") {
        idling.set(sock, tag);
        return send("+ idling");
      }
      if (c === "UID" && /^SEARCH /i.test(args)) {
        const q = args.slice(7);
        const max = box.at(-1)?.uid;
        const from = /^UID (\d+):\*$/i.exec(q);
        const uids = from
          ? box.filter((m) => m.uid >= Number(from[1])).map((m) => m.uid)
          : /^UID \*$/i.test(q)
            ? box.slice(-1).map((m) => m.uid)
            : box.map((m) => m.uid);
        // RFC 3501: "n:*" always includes the highest UID, even below n.
        if (from && !uids.length && max) uids.push(max);
        send(`* SEARCH${uids.map((u) => ` ${u}`).join("")}`);
        return send(`${tag} OK`);
      }
      if (c === "UID" && /^FETCH /i.test(args)) {
        const uid = Number(args.split(" ")[1]);
        const i = box.findIndex((m) => m.uid === uid);
        const m = box[i];
        if (m) {
          fetched++;
          const bytes = Buffer.from(m.raw, "utf8");
          const d = m.at;
          const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
          const time = d.toISOString().slice(11, 19);
          const date = `${String(d.getUTCDate()).padStart(2, "0")}-${month}-${d.getUTCFullYear()} ${time} +0000`;
          sock.write(
            `* ${i + 1} FETCH (UID ${uid} RFC822.SIZE ${bytes.length} INTERNALDATE "${date}" BODY[]<0> {${bytes.length}}\r\n`,
          );
          sock.write(bytes);
          sock.write(")\r\n");
        }
        return send(`${tag} OK`);
      }
      send(`${tag} BAD unknown command`);
    });
  });
  const port = await listen(server);
  return {
    port,
    deliver(raw, at = new Date()) {
      const uid = nextUid++;
      box.push({ uid, raw, at });
      for (const s of idling.keys()) {
        s.write(`* ${box.length} EXISTS\r\n`);
        seen.set(s, box.length);
      }
      return uid;
    },
    renumber() {
      uidvalidity++;
      box = box.map((m) => ({ ...m, uid: nextUid++ }));
      // A server that renumbers drops its sessions; the adapter connects again.
      for (const s of sockets) s.destroy();
    },
    fetches: () => fetched,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type SentMail = { from: string; to: string[]; raw: string };

export type FakeSmtp = {
  port: number;
  sent: SentMail[];
  /** What the next messages meet: accepted, the connection dropped after the final ".", or a refusal. */
  mode: "ok" | "drop-after-data" | "busy" | "reject";
  close(): Promise<void>;
};

export async function fakeSmtp(opts: { user: string; pass: string }): Promise<FakeSmtp> {
  const sockets = new Set<net.Socket>();
  const fake: FakeSmtp = {
    port: 0,
    sent: [],
    mode: "ok",
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    const send = (s: string) => sock.writable && sock.write(`${s}\r\n`);
    let authed = false;
    let from = "";
    let to: string[] = [];
    send("220 fake.test ESMTP");
    const reader = lines(sock, (line) => {
      const c = line.slice(0, 4).toUpperCase();
      if (c === "EHLO") {
        for (const l of ["250-fake.test", "250-AUTH PLAIN LOGIN", "250 8BITMIME"]) send(l);
        return;
      }
      if (c === "AUTH") {
        const [, u, p] = Buffer.from(line.split(" ")[2] ?? "", "base64")
          .toString("utf8")
          .split("\0");
        authed = u === opts.user && p === opts.pass;
        return send(authed ? "235 2.7.0 accepted" : "535 5.7.8 bad credentials");
      }
      if (c === "QUIT") {
        send("221 bye");
        return sock.end();
      }
      if (!authed) return send("530 5.7.0 sign in first");
      if (c === "MAIL") {
        from = /<([^>]*)>/.exec(line)?.[1] ?? "";
        to = [];
        return send("250 ok");
      }
      if (c === "RCPT") {
        if (fake.mode === "busy") return send("451 4.3.0 try again later");
        if (fake.mode === "reject") return send("550 5.1.1 no such user");
        to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
        return send("250 ok");
      }
      if (c === "DATA") {
        send("354 go ahead");
        reader.readUntil("\r\n.\r\n", (body) => {
          if (fake.mode === "drop-after-data") return sock.destroy();
          fake.sent.push({ from, to, raw: body.replace(/^\.\./gm, ".") });
          send(`250 2.0.0 queued as ${randomUUID().slice(0, 8)}`);
        });
        return;
      }
      send("502 unknown");
    });
  });
  fake.port = await listen(server);
  return fake;
}

/** A plain mail as a person's client writes it; the receiving server's verdict on top, as Gmail adds it. */
export function mail(m: {
  from: string;
  to: string;
  subject: string;
  text: string;
  id?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  verified?: boolean;
}): { raw: string; id: string } {
  const id = m.id ?? `<${randomUUID()}@example.org>`;
  const domain = /@([^>\s]+)/.exec(m.from)?.[1] ?? "example.org";
  const head = [
    ...(m.verified === false
      ? []
      : [`Authentication-Results: mx.fake.test; dkim=pass header.d=${domain}; spf=pass smtp.mailfrom=${domain}`]),
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${m.subject}`,
    `Message-ID: ${id}`,
    "Date: Thu, 08 Oct 2026 10:00:00 +0000",
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.join(" ")}`] : []),
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return { raw: `${head.join("\r\n")}\r\n\r\n${m.text.replace(/\r?\n/g, "\r\n")}\r\n`, id };
}
