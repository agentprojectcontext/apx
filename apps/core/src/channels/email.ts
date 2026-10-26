// Email: a mailbox read over IMAP (new mail by UID, waiting with IDLE) and answered over SMTP, with Node's own
// sockets. Each sender is one conversation; answers go back in the same mail thread (Re:, In-Reply-To, References).
// Automatic mail (auto-replies, lists, bounces, our own) is never read, so two robots never answer each other.
// What it remembers (the mailbox's UIDVALIDITY, the last UID read, each sender's thread) lives in the channel's folder.
import fs from "node:fs";
import path from "node:path";
import type { ChannelEmail } from "@apx/protocol";
import { type EmailSignature, renderEmailDraft, withEmailSignature } from "../domain/email-signature.ts";
import { errorMessage } from "../errors.ts";
import { Imap, ImapRefused } from "./email-imap.ts";
import { decodeWords, header, messageIds, parseAddress, parseMail, stripQuoted } from "./email-mime.ts";
import { composeMail, isAuthRefusal, smtpCheck, smtpSend } from "./email-smtp.ts";
import { type Endpoint, isLoopback } from "./email-socket.ts";
import { numberedOptions, sleep } from "./net.ts";
import {
  type AdapterFactory,
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  SendError,
} from "./types.ts";

/** A message is read up to this size; the rest (big attachments) is cut. */
const MAX_FETCH = 4 * 1024 * 1024;
/** Words the agent reads from one mail. */
const MAX_TEXT = 12_000;
/** Attachments kept per mail, and the size of each; others are only named. */
const MAX_FILES = 4;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** New messages handled per round (a flood waits for the next one). */
const PER_ROUND = 50;
/** IDLE is renewed before servers drop it (RFC 2177: at most 29 minutes). */
const WAIT_MS = 10 * 60_000;
const POLL_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Senders whose threads are remembered, the most recent ones. */
const MAX_THREADS = 500;
const SEND_MS = 3 * 60_000;

/** Kept so their names and small size can travel; anything else is only listed. */
const KEEP = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv|calendar))$/;

type Thread = { subject: string; ids: string[]; at: number };
type State = {
  uidvalidity?: number;
  last_uid?: number;
  /** When the channel first read this mailbox: older mail is never answered. */
  started?: string;
  checked?: string;
  threads: Record<string, Thread>;
};

/** Mail no person wrote, or that must not be answered: auto-replies, lists, bounces, robots. */
export function isAutomatic(h: ReturnType<typeof parseMail>["headers"], from: string): boolean {
  const auto = header(h, "auto-submitted")?.trim().toLowerCase();
  if (auto && !auto.startsWith("no")) return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(h, "precedence")?.trim() ?? "")) return true;
  if (["x-autoreply", "x-autorespond", "list-id", "list-unsubscribe", "feedback-id"].some((k) => h.has(k))) return true;
  if (/^multipart\/report/i.test(header(h, "content-type") ?? "")) return true;
  const local = from.split("@")[0] ?? "";
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?)([+._-]|$)/i.test(local);
}

/**
 * Whether the receiving server vouched that the mail comes from its From domain: DMARC passed, or DKIM or SPF passed
 * for that domain. Only the topmost Authentication-Results counts: it is the one the owner's own server added (the
 * sender can forge any below it).
 */
export function verifiedSender(h: ReturnType<typeof parseMail>["headers"], from: string): boolean {
  const ar = h.get("authentication-results")?.[0]?.toLowerCase();
  if (!ar) return false;
  const domain = from.split("@")[1] ?? "";
  const aligned = (d: string | undefined): boolean =>
    d !== undefined && d !== "" && (d === domain || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`));
  return ar
    .split(";")
    .slice(1)
    .some((r) => {
      const m = /^\s*(dmarc|dkim|spf)\s*=\s*pass\b/.exec(r);
      if (!m) return false;
      if (m[1] === "dmarc") {
        const hf = /header\.from=([a-z0-9.-]+)/.exec(r)?.[1];
        return hf === undefined || aligned(hf);
      }
      if (m[1] === "dkim") return aligned(/header\.(?:d|i)=(?:[^@\s]*@)?([a-z0-9.-]+)/.exec(r)?.[1]);
      return aligned(/smtp\.mailfrom=(?:[^@\s]*@)?([a-z0-9.-]+)/.exec(r)?.[1]);
    });
}

/** Whether `address` is on the allow list (an exact address, or "@domain"). An empty list allows anyone. */
export function allowedSender(allowed: readonly string[], address: string): boolean {
  if (!allowed.length) return true;
  const a = address.toLowerCase();
  return allowed.some((x) => {
    const e = x.trim().toLowerCase();
    return e.startsWith("@") ? a.endsWith(e) : e === a;
  });
}

const reSubject = (s: string) => (/^\s*re\s*:/i.test(s) ? s : `Re: ${s || "(no subject)"}`.slice(0, 250));
const baseSubject = (s: string) =>
  s
    .replace(/^\s*((re|aw|sv|fwd?|rv|tr|enc)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
const isAddress = (s: string) => /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(s);

export function emailAdapter(
  config: Parameters<AdapterFactory>[0],
  secret: string | undefined,
  opts: {
    dir: string;
    signature?: (() => EmailSignature | undefined) | undefined;
  },
) {
  const mail: ChannelEmail | undefined = config.email;
  const ac = new AbortController();
  const options = numberedOptions();
  const stateFile = path.join(opts.dir, "email-state.json");
  const state: State = readState(stateFile);
  let imap: Imap | undefined;
  let loop: Promise<void> | undefined;
  const user = mail?.username || mail?.address || "";
  const auth = { user, pass: secret ?? "" };

  function save(): void {
    const names = Object.keys(state.threads);
    if (names.length > MAX_THREADS) {
      const keep = names
        .sort((a, b) => (state.threads[b]?.at ?? 0) - (state.threads[a]?.at ?? 0))
        .slice(0, MAX_THREADS);
      state.threads = Object.fromEntries(keep.map((k) => [k, state.threads[k] as Thread]));
    }
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  /** One message: who, which thread, the new words; then handed over as received (or as a numbered option picked). */
  function handle(raw: Buffer, uid: number, truncated: boolean, io: AdapterIO): void {
    if (!mail) return;
    let m: ReturnType<typeof parseMail>;
    try {
      m = parseMail(raw, truncated);
    } catch {
      return; // A message that cannot be read is skipped, never retried forever.
    }
    const from = parseAddress(header(m.headers, "from"));
    if (!from || from.address === mail.address.toLowerCase()) return;
    if (isAutomatic(m.headers, from.address) || !allowedSender(mail.allowed, from.address)) return;
    // A From line is easy to forge: mail its server did not verify could pass for the owner. Dropped, unanswered.
    if (!mail.trust_unverified && !verifiedSender(m.headers, from.address)) return;
    const id = messageIds(header(m.headers, "message-id"))[0];
    const subject = decodeWords(header(m.headers, "subject") ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .slice(0, 250);
    const before = state.threads[from.address];
    const refs = messageIds(header(m.headers, "references"));
    const chain = [...(refs.length ? refs : messageIds(header(m.headers, "in-reply-to"))), ...(id ? [id] : [])];
    const fresh = !before || baseSubject(before.subject) !== baseSubject(subject);
    // Remembered before it is handed over: the pairing code or the answer replies to this very message.
    state.threads[from.address] = {
      subject: fresh ? subject : (before?.subject ?? subject),
      ids: chain.slice(-10),
      at: Date.now(),
    };

    let text = stripQuoted(m.text).slice(0, MAX_TEXT);
    const files: Array<{ name: string; mime: string; data: string }> = [];
    const listed: string[] = [];
    for (const a of m.attachments) {
      if (files.length < MAX_FILES && KEEP.test(a.mime) && a.data.length > 0 && a.data.length <= MAX_FILE_BYTES)
        files.push({ name: a.name.slice(0, 120), mime: a.mime, data: a.data.toString("base64") });
      else listed.push(`${a.name.slice(0, 120)} (${a.mime}, ${Math.ceil(a.data.length / 1024)} KB)`);
    }
    if (listed.length) text += `\n[attachments not kept: ${listed.join("; ")}]`;
    if (m.truncated) text += "\n[the message was too big: its end was cut]";
    if (fresh && subject) text = `[subject: ${subject}]\n${text}`;

    const sender = { id: from.address, name: from.name ? `${from.name} (${from.address})` : from.address };
    const picked = options.pick(from.address, stripQuoted(m.text));
    io.receive({
      // The Message-ID dedupes a mail read again (another UID, the mailbox rebuilt); the UID when it has none.
      external_id: id ? `mid:${id.toLowerCase()}` : `uid:${state.uidvalidity ?? 0}:${uid}`,
      conversation: from.address,
      sender,
      text: text.trim(),
      private: true,
      ...(picked ? { action: picked } : {}),
      ...(files.length ? { files } : {}),
    });
  }

  /** The messages after the last UID read, oldest first; each one is stored before the next UID is remembered. */
  async function round(box: Imap, io: AdapterIO): Promise<void> {
    const last = state.last_uid ?? 0;
    const uids = (await box.search(`UID ${last + 1}:*`)).filter((u) => u > last).slice(0, PER_ROUND);
    for (const uid of uids) {
      const got = await box.fetch(uid, MAX_FETCH);
      // Mail the server received before the channel first started is history, also when it is read again.
      const old = got?.arrived !== undefined && state.started !== undefined && got.arrived < Date.parse(state.started);
      if (got && !old) handle(got.raw, uid, got.size > got.raw.length, io);
      state.last_uid = uid;
      save();
    }
    state.checked = new Date().toISOString();
  }

  /** Opens the mailbox; a new UIDVALIDITY (or the first start) decides where reading begins. */
  async function open(box: Imap): Promise<void> {
    if (!mail) return;
    const info = await box.examine(mail.mailbox);
    if (state.uidvalidity === info.uidvalidity) return;
    if (state.uidvalidity === undefined) {
      // First start: only mail that arrives from now on, never the mailbox's history.
      state.started = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000).toISOString();
      state.last_uid = info.uidnext ? info.uidnext - 1 : ((await box.search("UID *")).at(-1) ?? 0);
    } else {
      // The server renumbered the mailbox: read again since the last check; Message-IDs keep it from repeating.
      const since = new Date(state.checked ?? Date.now());
      const day = `${since.getUTCDate()}-${since.toLocaleString("en", { month: "short", timeZone: "UTC" })}-${since.getUTCFullYear()}`;
      const uids = await box.search(`SINCE ${day}`);
      state.last_uid = Math.max(0, (uids[0] ?? info.uidnext ?? 1) - 1);
    }
    state.uidvalidity = info.uidvalidity;
    save();
  }

  async function run(io: AdapterIO, first: Imap): Promise<void> {
    let backoff = 5000;
    let box: Imap | undefined = first;
    while (!ac.signal.aborted && !io.signal.aborted) {
      try {
        box ??= await connect();
        imap = box;
        await open(box);
        io.status("running");
        backoff = 5000;
        while (!ac.signal.aborted) {
          await round(box, io);
          await box.wait(box.caps.has("IDLE") ? WAIT_MS : POLL_MS, ac.signal);
        }
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        io.status("error", `cannot read the mailbox: ${errorMessage(err)}`.slice(0, 200));
      }
      box?.close();
      box = undefined;
      if (ac.signal.aborted || io.signal.aborted) return;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  const connect = () => Imap.connect(mail?.imap as Endpoint, auth.user, auth.pass, ac.signal);

  return {
    caps: { typing: false, buttons: false },
    async start(io) {
      if (!mail) throw new ChannelRefused("Email needs the mailbox's address and its IMAP and SMTP servers");
      if (!secret) throw new ChannelRefused("Email needs the mailbox's password (an app password for Gmail)");
      for (const s of [mail.imap, mail.smtp])
        if (s.tls === "none" && !isLoopback(s.host))
          throw new ChannelRefused(`${s.host} without TLS would send the password readable: use TLS or STARTTLS`);
      const [box, smtp] = await Promise.allSettled([
        connect(),
        smtpCheck(mail.smtp, auth, mail.address.split("@")[1] ?? "localhost", ac.signal),
      ]);
      if (box.status === "fulfilled" && smtp.status === "rejected") box.value.close();
      if (box.status === "rejected") {
        const err = box.reason;
        throw err instanceof ImapRefused && err.auth
          ? new ChannelRefused(
              `the IMAP server refused the sign-in (${err.message}); Gmail and iCloud need an app password`,
            )
          : err;
      }
      if (smtp.status === "rejected") {
        const err = smtp.reason;
        throw isAuthRefusal(err)
          ? new ChannelRefused(`the SMTP server refused the sign-in (${errorMessage(err, 120)})`)
          : err;
      }
      loop = run(io, box.value);
      return { account: mail.address };
    },
    async stop() {
      ac.abort();
      imap?.close();
      await loop?.catch(() => {});
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async send(conversation, p, files = []) {
      if (!mail) throw new SendError("fatal", "the email channel has no mailbox");
      // One mail carries the text and the files: a later attempt has nothing left to send.
      if (p.skip) return {};
      const to = conversation.toLowerCase();
      if (!isAddress(to)) throw new SendError("fatal", `"${conversation.slice(0, 80)}" is not an email address`);
      const thread = state.threads[to];
      const body = renderEmailDraft(
        withEmailSignature({ content: { text: options.text(to, p.text, p.buttons) } }, opts.signature?.(), {
          omit: p.omit_signature,
        }),
      );
      const out = composeMail({
        from: { address: mail.address, name: mail.name },
        to,
        subject: thread ? reSubject(thread.subject) : mail.name || "APX",
        ...body,
        inReplyTo: thread?.ids.at(-1),
        references: thread?.ids,
        autoSubmitted: thread ? "auto-replied" : "auto-generated",
        files: files.map((f) => ({ name: fileName(f), mime: f.mime, data: f.data })),
      });
      await smtpSend(
        mail.smtp,
        auth,
        { from: mail.address, to: [to], data: out.data },
        AbortSignal.any([ac.signal, AbortSignal.timeout(SEND_MS)]),
      );
      // The next mail in this conversation answers this one, so the thread stays one in their mail app.
      state.threads[to] = {
        subject: thread?.subject ?? (mail.name || "APX"),
        ids: [...(thread?.ids ?? []), out.id].slice(-10),
        at: Date.now(),
      };
      save();
      return { external_id: out.id };
    },
  } satisfies ChannelAdapter;
}

function readState(file: string): State {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { ...s, threads: s.threads && typeof s.threads === "object" ? s.threads : {} };
  } catch {
    return { threads: {} };
  }
}
