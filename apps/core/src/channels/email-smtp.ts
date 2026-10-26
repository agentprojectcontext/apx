// Sending mail over SMTP submission (RFC 5321/6409) with Node's own sockets: implicit TLS (465) or STARTTLS (587),
// AUTH PLAIN or LOGIN, one message per connection. Failures say whether the message may have been delivered: until
// the final "." nothing was accepted (retry); a lost answer after it may mean it went out (uncertain).
import { randomUUID } from "node:crypto";
import { emailMimeBody } from "../domain/email-body.ts";
import { errorMessage } from "../errors.ts";
import { type Endpoint, MailSocket, MailTimeout } from "./email-socket.ts";
import { neverSent } from "./net.ts";
import { SendError } from "./types.ts";

const STEP_MS = 30_000;
/** A server may scan the message before it answers the final ".": longer than any other step. */
const DATA_MS = 120_000;

export type SmtpAuth = { user: string; pass: string };

class SmtpReply extends Error {
  readonly code: number;
  constructor(code: number, text: string) {
    super(`SMTP ${code} ${text}`.slice(0, 300));
    this.code = code;
  }
}

type Session = { sock: MailSocket; ext: Map<string, string> };

async function reply(sock: MailSocket, ms = STEP_MS): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  for (;;) {
    const line = await sock.line(ms, "the mail server");
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) throw new Error(`SMTP: unexpected answer "${line.slice(0, 80)}"`);
    lines.push(m[3] ?? "");
    if (m[2] === " ") return { code: Number(m[1]), lines };
  }
}

async function expect(sock: MailSocket, ok: number, ms = STEP_MS): Promise<string[]> {
  const r = await reply(sock, ms);
  if (Math.floor(r.code / 100) !== Math.floor(ok / 100)) throw new SmtpReply(r.code, r.lines.join(" "));
  return r.lines;
}

async function ehlo(sock: MailSocket, name: string): Promise<Map<string, string>> {
  await sock.write(`EHLO ${name}\r\n`);
  const lines = await expect(sock, 250);
  const ext = new Map<string, string>();
  for (const l of lines.slice(1)) {
    const [k = "", ...rest] = l.trim().split(/\s+/);
    ext.set(k.toUpperCase(), rest.join(" ").toUpperCase());
  }
  return ext;
}

/** Connects, greets, encrypts and logs in. `name` is what EHLO says: the sender's domain, never this machine's name. */
async function open(ep: Endpoint, auth: SmtpAuth, name: string, signal: AbortSignal): Promise<Session> {
  const sock = await MailSocket.open(ep, STEP_MS, signal);
  try {
    await expect(sock, 220);
    let ext = await ehlo(sock, name);
    if (ep.tls === "starttls") {
      // Never fall back to plain text: the password would cross the network readable.
      if (!ext.has("STARTTLS")) throw new SmtpReply(530, "the server does not offer STARTTLS");
      await sock.write("STARTTLS\r\n");
      await expect(sock, 220);
      await sock.upgrade(STEP_MS);
      ext = await ehlo(sock, name);
    }
    const mechs = (ext.get("AUTH") ?? "").split(/\s+/);
    if (ext.has("AUTH")) {
      if (mechs.includes("PLAIN")) {
        await sock.write(`AUTH PLAIN ${Buffer.from(`\0${auth.user}\0${auth.pass}`).toString("base64")}\r\n`);
        await expect(sock, 235);
      } else if (mechs.includes("LOGIN")) {
        await sock.write("AUTH LOGIN\r\n");
        await expect(sock, 334);
        await sock.write(`${Buffer.from(auth.user).toString("base64")}\r\n`);
        await expect(sock, 334);
        await sock.write(`${Buffer.from(auth.pass).toString("base64")}\r\n`);
        await expect(sock, 235);
      } else throw new SmtpReply(504, "the server offers no PLAIN or LOGIN sign-in");
    }
    return { sock, ext };
  } catch (err) {
    sock.close();
    throw err;
  }
}

/** Signs in and out: the settings work. Throws what the server said. */
export async function smtpCheck(ep: Endpoint, auth: SmtpAuth, name: string, signal: AbortSignal): Promise<void> {
  const s = await open(ep, auth, name, signal);
  await s.sock.write("QUIT\r\n").catch(() => {});
  s.sock.close();
}

/** Whether the server refused the sign-in (wrong password, an app password needed). */
export const isAuthRefusal = (err: unknown) => err instanceof SmtpReply && [530, 534, 535, 538].includes(err.code);

/**
 * Sends one message. Throws a SendError: `retry` when it surely did not go out, `uncertain` when the answer to the
 * final "." never came, `fatal` when the server refused it for good.
 */
export async function smtpSend(
  ep: Endpoint,
  auth: SmtpAuth,
  mail: { from: string; to: string[]; data: Buffer },
  signal: AbortSignal,
): Promise<void> {
  let s: Session | undefined;
  let committed = false;
  try {
    s = await open(ep, auth, domainOf(mail.from), signal);
    await s.sock.write(`MAIL FROM:<${mail.from}>\r\n`);
    await expect(s.sock, 250);
    for (const to of mail.to) {
      await s.sock.write(`RCPT TO:<${to}>\r\n`);
      await expect(s.sock, 250);
    }
    await s.sock.write("DATA\r\n");
    await expect(s.sock, 354);
    await s.sock.write(dotStuff(mail.data));
    committed = true;
    await expect(s.sock, 250, DATA_MS);
    await s.sock.write("QUIT\r\n").catch(() => {});
  } catch (err) {
    throw classify(err, committed);
  } finally {
    s?.sock.close();
  }
}

function classify(err: unknown, committed: boolean): SendError {
  const msg = errorMessage(err, 300);
  // A reply is the server's decision: 4xx is "not now" (nothing kept), 5xx is "never" (nothing kept either).
  if (err instanceof SmtpReply) return new SendError(err.code < 500 ? "retry" : "fatal", msg, 60_000);
  if (!committed || neverSent(err)) return new SendError("retry", msg);
  // The message was handed over and its answer lost: it may be in their inbox already.
  return new SendError("uncertain", err instanceof MailTimeout ? `${msg} after the message was sent` : msg);
}

/** CRLF line ends, a "." doubled at the start of a line, and the closing "." line. */
export function dotStuff(data: Buffer): Buffer {
  const text = data.toString("latin1").replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return Buffer.from(`${text}${text.endsWith("\r\n") ? "" : "\r\n"}.\r\n`, "latin1");
}

export const domainOf = (address: string) => address.split("@")[1]?.replace(/[^a-z0-9.-]/gi, "") || "localhost";

// ── composing ──────────────────────────────────────────────────────────

/** A header value: as is when it is plain ASCII, else RFC 2047 encoded words (folded to stay under 78 columns). */
export function encodeWords(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const ch of clean) {
    if (Buffer.byteLength(chunk + ch) > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}

const mailbox = (address: string, name?: string) =>
  name ? `${/^[\w .-]*$/.test(name) ? `"${name}"` : encodeWords(name)} <${address}>` : `<${address}>`;

const base64Lines = (b: Buffer) => (b.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

export type OutMail = {
  from: { address: string; name?: string | undefined };
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
  /** RFC 3834: answers written by a machine say so, so other robots do not answer them back. */
  autoSubmitted: "auto-replied" | "auto-generated";
  files?: Array<{ name: string; mime: string; data: Buffer }> | undefined;
};

/** The message as bytes, and its Message-ID (the next reply's In-Reply-To). */
export function composeMail(m: OutMail): { id: string; data: Buffer } {
  const id = `<${randomUUID()}@${domainOf(m.from.address)}>`;
  const head = [
    `From: ${mailbox(m.from.address, m.from.name)}`,
    `To: <${m.to}>`,
    `Subject: ${encodeWords(m.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${id}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.join("\r\n ")}`] : []),
    `Auto-Submitted: ${m.autoSubmitted}`,
    // Exchange and Outlook: no out-of-office or read receipts back to this address.
    "X-Auto-Response-Suppress: All",
    "MIME-Version: 1.0",
  ];
  const textPart = emailMimeBody({ text: m.text, html: m.html });
  if (!m.files?.length) return { id, data: Buffer.from(`${head.join("\r\n")}\r\n${textPart}\r\n`) };
  const boundary = `apx-${randomUUID()}`;
  const parts = [
    textPart,
    ...m.files.map((f) => {
      const name = f.name.replace(/["\\\r\n]/g, "_");
      const ascii = /^[\x20-\x7e]*$/.test(name);
      const param = ascii ? `filename="${name}"` : `filename*=UTF-8''${encodeURIComponent(name)}`;
      return [
        `Content-Type: ${f.mime}${ascii ? `; name="${name}"` : ""}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${param}`,
        "",
        base64Lines(f.data),
      ].join("\r\n");
    }),
  ];
  const body = `${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--\r\n`;
  return {
    id,
    data: Buffer.from(`${head.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${body}`),
  };
}
