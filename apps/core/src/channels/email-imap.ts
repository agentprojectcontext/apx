// The IMAP4rev1 (RFC 3501) commands the email channel needs, over Node's own sockets: sign in, open a mailbox
// read-only (EXAMINE: flags and messages stay as the owner left them), find new messages by UID, fetch one, and wait
// for new mail with IDLE where the server has it.
import { type Endpoint, MailSocket, MailTimeout } from "./email-socket.ts";

const STEP_MS = 30_000;
const FETCH_MS = 120_000;
/** No literal is held beyond this: fetches ask for less. */
const MAX_LITERAL = 8 * 1024 * 1024;

/** The server answered NO or BAD. */
export class ImapRefused extends Error {
  readonly auth: boolean;
  constructor(text: string, auth = false) {
    super(`IMAP: ${text}`.slice(0, 300));
    this.auth = auth;
  }
}

/** One response: its line(s) with each literal's place marked "{n}", and the literals' bytes. */
type Resp = { line: string; literals: Buffer[] };

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export class Imap {
  private n = 0;
  /** The server said a message arrived since the last search. */
  private arrived = false;
  caps = new Set<string>();
  private readonly sock: MailSocket;

  private constructor(sock: MailSocket) {
    this.sock = sock;
  }

  /** Connects, encrypts (STARTTLS when asked, never falling back to plain text) and signs in. */
  static async connect(ep: Endpoint, user: string, pass: string, signal: AbortSignal): Promise<Imap> {
    const sock = await MailSocket.open(ep, STEP_MS, signal);
    const imap = new Imap(sock);
    try {
      const hello = await imap.read(STEP_MS);
      if (!/^\* (OK|PREAUTH)/i.test(hello.line)) throw new ImapRefused(hello.line.slice(0, 120));
      await imap.capability();
      if (ep.tls === "starttls") {
        if (!imap.caps.has("STARTTLS")) throw new ImapRefused("the server does not offer STARTTLS");
        await imap.command("STARTTLS");
        await sock.upgrade(STEP_MS);
        await imap.capability();
      }
      await imap.login(user, pass);
      await imap.capability();
      return imap;
    } catch (err) {
      sock.close();
      throw err;
    }
  }

  private async capability(): Promise<void> {
    const r = await this.command("CAPABILITY");
    const line = r.find((x) => /^\* CAPABILITY /i.test(x.line))?.line ?? "";
    this.caps = new Set(line.slice(13).toUpperCase().split(/\s+/).filter(Boolean));
  }

  private async login(user: string, pass: string): Promise<void> {
    try {
      // AUTHENTICATE PLAIN carries any characters; LOGIN's quoted strings cannot carry line breaks.
      if (this.caps.has("AUTH=PLAIN")) {
        const tag = this.tag();
        await this.sock.write(`${tag} AUTHENTICATE PLAIN\r\n`);
        const go = await this.read(STEP_MS);
        if (!go.line.startsWith("+")) throw new ImapRefused(go.line.slice(0, 200), true);
        await this.sock.write(`${Buffer.from(`\0${user}\0${pass}`).toString("base64")}\r\n`);
        await this.finish(tag, STEP_MS);
      } else {
        if (/[\r\n]/.test(user + pass)) throw new ImapRefused("the password cannot be sent with LOGIN", true);
        await this.command(`LOGIN ${quote(user)} ${quote(pass)}`);
      }
    } catch (err) {
      throw err instanceof ImapRefused ? new ImapRefused(err.message.replace(/^IMAP: /, ""), true) : err;
    }
  }

  private tag(): string {
    return `A${++this.n}`;
  }

  /** One response, with its literals (a line ending in "{n}" is followed by n bytes, then the rest of the line). */
  private async read(ms: number): Promise<Resp> {
    const end = Date.now() + ms;
    let line = await this.sock.line(ms, "the mail server");
    const literals: Buffer[] = [];
    for (;;) {
      const m = /\{(\d+)\+?\}$/.exec(line);
      if (!m) return { line, literals };
      if (Number(m[1]) > MAX_LITERAL) throw new Error("the mail server sent more than was asked for");
      literals.push(await this.sock.bytes(Number(m[1]), Math.max(1, end - Date.now())));
      line += await this.sock.line(Math.max(1, end - Date.now()), "the mail server");
    }
  }

  /** Untagged responses until this tag's own; NO or BAD throws. */
  private async finish(tag: string, ms: number): Promise<Resp[]> {
    const end = Date.now() + ms;
    const out: Resp[] = [];
    for (;;) {
      const r = await this.read(Math.max(1, end - Date.now()));
      if (r.line.startsWith(`${tag} `)) {
        const status = r.line.slice(tag.length + 1);
        if (/^OK/i.test(status)) return out;
        throw new ImapRefused(status);
      }
      // A server tells of new mail in passing, with any command's answer: the next wait does not sleep through it.
      if (/^\* \d+ EXISTS\b/i.test(r.line)) this.arrived = true;
      out.push(r);
    }
  }

  async command(cmd: string, ms = STEP_MS): Promise<Resp[]> {
    const tag = this.tag();
    await this.sock.write(`${tag} ${cmd}\r\n`);
    return this.finish(tag, ms);
  }

  /** Opens a mailbox read-only: its UIDVALIDITY (UIDs mean nothing across a change) and the next UID. */
  async examine(mailbox: string): Promise<{ uidvalidity: number; uidnext?: number }> {
    const r = await this.command(`EXAMINE ${quote(mailbox)}`);
    const num = (key: string) => {
      for (const x of r) {
        const m = new RegExp(`\\[${key} (\\d+)\\]`, "i").exec(x.line);
        if (m) return Number(m[1]);
      }
      return undefined;
    };
    const uidnext = num("UIDNEXT");
    return { uidvalidity: num("UIDVALIDITY") ?? 0, ...(uidnext ? { uidnext } : {}) };
  }

  /** UIDs matching a search ("UID 41:*", "SINCE 1-Oct-2026"), in order. */
  async search(criteria: string): Promise<number[]> {
    this.arrived = false;
    const r = await this.command(`UID SEARCH ${criteria}`);
    const uids = r
      .filter((x) => /^\* SEARCH\b/i.test(x.line))
      .flatMap((x) => x.line.slice(8).trim().split(/\s+/).filter(Boolean).map(Number));
    return [...new Set(uids.filter((u) => Number.isSafeInteger(u) && u > 0))].sort((a, b) => a - b);
  }

  /** One message's bytes, at most `max` of them (a bigger one is cut), without marking it read. */
  async fetch(uid: number, max: number): Promise<{ raw: Buffer; size: number; arrived?: number } | undefined> {
    const r = await this.command(`UID FETCH ${uid} (UID RFC822.SIZE INTERNALDATE BODY.PEEK[]<0.${max}>)`, FETCH_MS);
    for (const x of r) {
      if (!/^\* \d+ FETCH /i.test(x.line) || !/BODY\[\]/i.test(x.line)) continue;
      const got = /\bUID (\d+)/i.exec(x.line);
      if (got && Number(got[1]) !== uid) continue;
      const size = Number(/RFC822\.SIZE (\d+)/i.exec(x.line)?.[1] ?? 0);
      const raw = x.literals[0] ?? Buffer.from(/BODY\[\](?:<\d+>)? "((?:[^"\\]|\\.)*)"/i.exec(x.line)?.[1] ?? "");
      // "08-Oct-2026 10:00:00 +0000": when the server received it (the Date header is the sender's word).
      const date = /INTERNALDATE "\s?(\d{1,2})-(\w{3})-(\d{4}) ([\d:]+) ([+-]\d{4})"/i.exec(x.line);
      const arrived = date ? Date.parse(`${date[1]} ${date[2]} ${date[3]} ${date[4]} ${date[5]}`) : Number.NaN;
      return { raw, size: size || raw.length, ...(Number.isFinite(arrived) ? { arrived } : {}) };
    }
    return undefined;
  }

  /**
   * Waits for new mail: IDLE until the server says a message arrived or `ms` pass; without IDLE, a NOOP after
   * `ms`. Returns early when stopped.
   */
  async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.arrived) return;
    if (!this.caps.has("IDLE")) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
      if (!signal.aborted) await this.command("NOOP");
      return;
    }
    const tag = this.tag();
    await this.sock.write(`${tag} IDLE\r\n`);
    let go = await this.read(STEP_MS);
    // News of mail may come before the server's "+ idling".
    while (go.line.startsWith("* ")) {
      if (/^\* \d+ EXISTS\b/i.test(go.line)) this.arrived = true;
      go = await this.read(STEP_MS);
    }
    if (!go.line.startsWith("+")) throw new ImapRefused(go.line.slice(0, 200));
    const end = this.arrived ? Date.now() : Date.now() + ms;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0 || signal.aborted) break;
      try {
        const r = await this.read(left);
        if (/^\* \d+ (EXISTS|RECENT)\b/i.test(r.line)) break;
      } catch (err) {
        if (err instanceof MailTimeout) break;
        throw err;
      }
    }
    if (signal.aborted) return;
    await this.sock.write("DONE\r\n");
    await this.finish(tag, STEP_MS);
  }

  async logout(): Promise<void> {
    await this.command("LOGOUT", 5000).catch(() => {});
    this.sock.close();
  }

  close(): void {
    this.sock.close();
  }
}
