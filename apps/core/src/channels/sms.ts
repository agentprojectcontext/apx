// SMS through Twilio, by polling: the core lists the messages sent to the number every few seconds (no public URL
// for a webhook) and answers with the Messages API. The newest message seen is kept in the channel's folder, so a
// restart never replays them, and a new channel starts from now. Buttons become numbered options. Pictures (MMS)
// are neither read nor sent: only a message's text goes through.
import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, numberedOptions, sleep, splitText } from "./net.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, ChannelRefused, SendError } from "./types.ts";

const CALL_MS = 20_000;
const POLL_MS = 5000;
const MAX_BACKOFF_MS = 60_000;
/** Twilio takes 1600 characters a message and splits them into SMS segments itself. */
const MAX_CHARS = 1600;
/** Twilio's error for a number that answered STOP: it never gets another message. */
const UNSUBSCRIBED = 21610;

type TwilioMessage = { sid?: string; from?: string; body?: string; direction?: string; date_created?: string };
/** The newest message seen (its creation time, to the second) and the ones at that second already handed over. */
type State = { since: number; seen: string[] };

class TwilioError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(status: number, message: string, code?: number) {
    super(`Twilio: ${message}`);
    this.status = status;
    this.code = code;
  }
}

/** The account, its auth token and the number it sends from, stored as one secret: "AC… token +15550001111". */
export function smsSecret(raw: string | undefined): { sid: string; token: string; from: string } | undefined {
  const words = (raw ?? "").split(/\s+/).filter(Boolean);
  const sid = words.find((w) => /^AC[0-9a-f]{32}$/i.test(w));
  const from = words.find((w) => /^\+[1-9]\d{6,14}$/.test(w));
  const token = words.find((w) => w !== sid && w !== from && /^[A-Za-z0-9]{16,}$/.test(w));
  return sid && token && from ? { sid, token, from } : undefined;
}

export function smsAdapter(
  _config: Parameters<AdapterFactory>[0],
  secret: string | undefined,
  opts: { dir: string; api?: string; pollMs?: number },
): ChannelAdapter {
  const ac = new AbortController();
  const creds = smsSecret(secret);
  const api = opts.api ?? "https://api.twilio.com";
  const stateFile = path.join(opts.dir, "sms-state.json");
  const options = numberedOptions();
  let state = readState(stateFile);
  let loop: Promise<void> | undefined;

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  async function call<T>(method: string, route: string, form?: URLSearchParams): Promise<T> {
    if (!creds) throw new TwilioError(401, "no account");
    const res = await fetch(`${api}/2010-04-01/Accounts/${creds.sid}${route}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(form ? { body: form } : {}),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    const j = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
    if (!res.ok) throw new TwilioError(res.status, j.message ?? `HTTP ${res.status}`, j.code);
    return j as T;
  }

  /** The messages sent to the number since the day of the newest one seen, oldest first. */
  async function inbound(): Promise<Array<TwilioMessage & { sid: string; at: number }>> {
    if (!creds) return [];
    const q = new URLSearchParams({
      To: creds.from,
      "DateSent>": new Date(state.since || Date.now()).toISOString().slice(0, 10),
      PageSize: "50",
    });
    const r = await call<{ messages?: TwilioMessage[] }>("GET", `/Messages.json?${q}`);
    return (r.messages ?? [])
      .filter((m): m is TwilioMessage & { sid: string } => !!m.sid && m.direction === "inbound")
      .map((m) => ({ ...m, at: Date.parse(m.date_created ?? "") || 0 }))
      .sort((a, b) => a.at - b.at);
  }

  /** On a channel's first start, what is already there is history: it is marked seen and never answered. */
  async function begin(): Promise<void> {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const old = await inbound();
    const since = Math.max(now, ...old.map((m) => m.at));
    state = { since, seen: old.filter((m) => m.at === since).map((m) => m.sid) };
    save();
  }

  async function pollOnce(io: AdapterIO): Promise<void> {
    const fresh = (await inbound()).filter(
      (m) => m.at > state.since || (m.at === state.since && !state.seen.includes(m.sid)),
    );
    io.status("running");
    for (const m of fresh) {
      const from = m.from ?? "";
      if (from && m.body?.trim()) {
        const sender = { id: from, name: from };
        const picked = options.pick(from, m.body);
        if (picked) io.action({ conversation: from, sender, data: picked });
        else io.receive({ external_id: m.sid, conversation: from, sender, text: m.body, private: true });
      }
      state = m.at > state.since ? { since: m.at, seen: [m.sid] } : { ...state, seen: [...state.seen, m.sid] };
    }
    if (fresh.length) save();
  }

  async function run(io: AdapterIO): Promise<void> {
    const stop = AbortSignal.any([ac.signal, io.signal]);
    let backoff = 1000;
    while (!stop.aborted) {
      try {
        await pollOnce(io);
        backoff = 1000;
        await sleep(opts.pollMs ?? POLL_MS, stop);
      } catch (err) {
        if (stop.aborted) return;
        io.status("error", `cannot reach Twilio: ${errorMessage(err)}`.slice(0, 200));
        await sleep(backoff, stop);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  async function sendText(to: string, text: string): Promise<string> {
    if (!creds) throw new TwilioError(401, "no account");
    const form = new URLSearchParams({ To: to, From: creds.from, Body: text });
    return (await call<{ sid: string }>("POST", "/Messages.json", form)).sid;
  }

  return {
    caps: { typing: false, buttons: false },
    async start(io) {
      if (!creds)
        throw new ChannelRefused("SMS needs the Twilio account SID (AC…), its auth token and the number (+…)");
      await call("GET", ".json").catch((err: unknown) => {
        throw err instanceof TwilioError && [401, 403, 404].includes(err.status)
          ? new ChannelRefused("Twilio refused the account SID or auth token: copy them again from the console")
          : err;
      });
      if (!state.since) await begin();
      loop = run(io);
      return { account: creds.from, waiting: true };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    // Files are left out: Twilio fetches MMS media from a public URL, which the core does not have.
    async send(conversation, p) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < texts.length; i++) {
        try {
          last = await sendText(conversation, texts[i] as string);
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
  };
}

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof TwilioError) {
    if (err.code === UNSUBSCRIBED) return new SendError(sent ? "uncertain" : "fatal", msg);
    if (err.status === 429) return new SendError("retry", msg, 5000, sent);
    // A server error may come after the message was queued: never resent blindly.
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}

function readState(file: string): State {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { since: typeof s.since === "number" ? s.since : 0, seen: Array.isArray(s.seen) ? s.seen : [] };
  } catch {
    return { since: 0, seen: [] };
  }
}
