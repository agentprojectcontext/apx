// Google Chat as a Workspace Chat app with the Cloud Pub/Sub connection: Chat publishes each event to a topic and the
// core pulls them from a subscription, so no public URL is needed; answers go out through the Chat REST API. Both sign
// in as the app's service account. Direct messages are contacts; a space is read only when the owner listed it (Chat
// hands the app only messages that @mention it there). Buttons are card buttons, whose clicks come back through
// Pub/Sub too. Files are not sent or read: Chat's media upload needs a user's sign-in, not the app's.
import { createSign } from "node:crypto";
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, sleep, splitText } from "./net.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, ChannelRefused, SendError } from "./types.ts";

const CALL_MS = 20_000;
/** A pull waits a while for messages before it answers empty. */
const PULL_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
/** Chat takes 4096 characters a message. */
const MAX_CHARS = 4000;
const SCOPES = "https://www.googleapis.com/auth/chat.bot https://www.googleapis.com/auth/pubsub";
const MAX_THREADS = 500;

type ServiceKey = { client_email: string; private_key: string; token_uri?: string };
type ChatUser = { name?: string; displayName?: string; type?: string };
type ChatEvent = {
  type?: string;
  space?: { name?: string; type?: string; spaceType?: string; displayName?: string; singleUserBotDm?: boolean };
  message?: {
    name?: string;
    text?: string;
    argumentText?: string;
    sender?: ChatUser;
    thread?: { name?: string };
    annotations?: Array<{ type?: string; userMention?: { user?: ChatUser } }>;
  };
  user?: ChatUser;
  action?: { actionMethodName?: string; parameters?: Array<{ key?: string; value?: string }> };
  common?: { invokedFunction?: string; parameters?: Record<string, string> };
};
type Pulled = { receivedMessages?: Array<{ ackId?: string; message?: { data?: string } }> };

class ChatError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Google Chat: ${message}`);
    this.status = status;
  }
}

/**
 * The Pub/Sub subscription and the service account's key, stored as one secret: "projects/p/subscriptions/s" then
 * the key's JSON as Google gives it (either order, line breaks allowed).
 */
export function googlechatSecret(raw: string | undefined): { key: ServiceKey; subscription: string } | undefined {
  const text = (raw ?? "").trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open < 0 || close < open) return undefined;
  const subscription = `${text.slice(0, open)} ${text.slice(close + 1)}`.trim();
  if (!/^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/.test(subscription)) return undefined;
  let key: Partial<ServiceKey>;
  try {
    key = JSON.parse(text.slice(open, close + 1)) as Partial<ServiceKey>;
  } catch {
    return undefined;
  }
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string") return undefined;
  return {
    key: {
      client_email: key.client_email,
      private_key: key.private_key,
      ...(typeof key.token_uri === "string" ? { token_uri: key.token_uri } : {}),
    },
    subscription,
  };
}

export type GooglechatOptions = {
  /** Overrides the key's token_uri (tests). */
  oauth?: string;
  pubsub?: string;
  chat?: string;
  /** The wait after an empty pull. */
  idleMs?: number;
};

export const googlechatAdapter = (
  config: Parameters<AdapterFactory>[0],
  secret: string | undefined,
  opts: GooglechatOptions = {},
): ChannelAdapter => {
  const ac = new AbortController();
  const parsed = googlechatSecret(secret);
  const pubsub = opts.pubsub ?? "https://pubsub.googleapis.com";
  const chat = opts.chat ?? "https://chat.googleapis.com";
  const listed = new Set((config.rooms?.rooms ?? []).map((r) => r.id));
  // The thread each room message is in, so the answer joins it.
  const threads = new Map<string, string>();
  let token: { value: string; until: number } | undefined;
  let loop: Promise<void> | undefined;

  /** An access token for the service account (a signed JWT exchanged), kept until a minute before it expires. */
  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.until) return token.value;
    if (!parsed) throw new ChatError(401, "no service account key");
    const { key } = parsed;
    const aud = opts.oauth ?? key.token_uri ?? "https://oauth2.googleapis.com/token";
    const iat = Math.floor(Date.now() / 1000);
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: key.client_email, scope: SCOPES, aud, iat, exp: iat + 3600 })}`;
    let signature: string;
    try {
      signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
    } catch {
      throw new ChatError(401, "the service account's private key cannot be read");
    }
    const res = await fetch(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    const j = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    // A refused key is a 400 (invalid_grant) as often as a 401.
    if (!res.ok || !j.access_token)
      throw new ChatError(res.status === 400 ? 401 : res.status, j.error_description ?? `token: HTTP ${res.status}`);
    token = { value: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  }

  async function call<T>(method: string, url: string, body?: unknown, timeoutMs = CALL_MS): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.status === 401) token = undefined;
    if (!res.ok) throw new ChatError(res.status, j.error?.message ?? `HTTP ${res.status}`);
    return j as T;
  }

  const clean = (s: string | undefined) =>
    (s ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, 60);

  function handle(e: ChatEvent, io: AdapterIO): void {
    const space = e.space?.name;
    if (!space) return;
    const direct = e.space?.type === "DM" || e.space?.spaceType === "DIRECT_MESSAGE" || !!e.space?.singleUserBotDm;
    const roomName = clean(e.space?.displayName) || space;
    if (!direct && (e.type === "ADDED_TO_SPACE" || e.type === "REMOVED_FROM_SPACE")) {
      io.room?.({ id: space, name: roomName, ...(e.type === "REMOVED_FROM_SPACE" ? { left: true } : {}) });
      return;
    }
    const who = e.user ?? e.message?.sender;
    if (!who?.name || who.type === "BOT") return;
    const sender = { id: who.name, name: clean(who.displayName) || who.name };
    if (e.type === "CARD_CLICKED") {
      const data = e.common?.parameters?.id ?? e.action?.parameters?.find((p) => p.key === "id")?.value;
      // Buttons only go to direct messages (the owner's confirmations), so a click counts only there.
      if (data && direct)
        io.action({ conversation: space, sender, data, ...(e.message?.name ? { ref: e.message.name } : {}) });
      return;
    }
    const m = e.message;
    if (e.type !== "MESSAGE" || !m?.name) return;
    if (direct) {
      if (m.text?.trim()) io.receive({ external_id: m.name, conversation: space, sender, text: m.text, private: true });
      return;
    }
    io.room?.({ id: space, name: roomName });
    // The @mention of the app itself says nothing: it is how it was called (argumentText leaves it out).
    const text = (m.argumentText ?? m.text ?? "").trim();
    if (!listed.has(space) || !text) return;
    if (m.thread?.name) {
      threads.set(m.name, m.thread.name);
      if (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value as string);
    }
    const called = !!m.annotations?.some((a) => a.type === "USER_MENTION" && a.userMention?.user?.type === "BOT");
    io.receive({ external_id: m.name, conversation: space, sender, text, private: false, room: { called } });
  }

  /** One pull: each event handed over, then acknowledged; how many came. */
  async function pullOnce(io: AdapterIO): Promise<number> {
    if (!parsed) return 0;
    const r = await call<Pulled>("POST", `${pubsub}/v1/${parsed.subscription}:pull`, { maxMessages: 10 }, PULL_MS);
    io.status("running");
    const got = r.receivedMessages ?? [];
    const ackIds: string[] = [];
    for (const g of got) {
      if (!g.ackId) continue;
      let e: ChatEvent | undefined;
      try {
        e = JSON.parse(Buffer.from(g.message?.data ?? "", "base64").toString("utf8")) as ChatEvent;
      } catch {
        // An event that cannot be read is acknowledged and skipped, never pulled again forever.
      }
      if (e) handle(e, io);
      ackIds.push(g.ackId);
    }
    if (ackIds.length) await call("POST", `${pubsub}/v1/${parsed.subscription}:acknowledge`, { ackIds });
    return got.length;
  }

  async function run(io: AdapterIO): Promise<void> {
    const stop = AbortSignal.any([ac.signal, io.signal]);
    let backoff = 1000;
    while (!stop.aborted) {
      try {
        const n = await pullOnce(io);
        backoff = 1000;
        if (!n) await sleep(opts.idleMs ?? 1000, stop);
      } catch (err) {
        if (stop.aborted) return;
        io.status("error", `cannot pull from Pub/Sub: ${errorMessage(err)}`.slice(0, 200));
        await sleep(backoff, stop);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  function cards(buttons: Presentation["buttons"]) {
    if (!buttons?.length) return [];
    const widgets = [
      {
        buttonList: {
          buttons: buttons.map((b) => ({
            text: b.label,
            onClick: { action: { function: "apx", parameters: [{ key: "id", value: b.id }] } },
          })),
        },
      },
    ];
    return [{ cardId: "apx", card: { sections: [{ widgets }] } }];
  }

  async function post(space: string, text: string, buttons: Presentation["buttons"], thread?: string) {
    const q = thread ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
    const cardsV2 = cards(buttons);
    const body = {
      ...(text ? { text } : {}),
      ...(cardsV2.length ? { cardsV2 } : {}),
      ...(thread ? { thread: { name: thread } } : {}),
    };
    return (await call<{ name: string }>("POST", `${chat}/v1/${space}/messages${q}`, body)).name;
  }

  return {
    caps: { typing: false, buttons: true },
    async start(io) {
      if (!parsed)
        throw new ChannelRefused(
          "Google Chat needs the Pub/Sub subscription (projects/…/subscriptions/…) and the service account's JSON key",
        );
      await call("GET", `${pubsub}/v1/${parsed.subscription}`).catch((err: unknown) => {
        if (!(err instanceof ChatError)) throw err;
        if (err.status === 401) throw new ChannelRefused("Google refused the service account key: create a new one");
        if (err.status === 403 || err.status === 404)
          throw new ChannelRefused(
            "the service account cannot read that Pub/Sub subscription: check its name and give the account the Pub/Sub Subscriber role",
          );
        throw err;
      });
      loop = run(io);
      return { account: parsed.key.client_email, waiting: true };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p) {
      const texts = p.text.trim() ? splitText(p.text, MAX_CHARS) : p.buttons?.length ? [""] : [];
      const thread = p.reply_to ? threads.get(p.reply_to) : undefined;
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < texts.length; i++) {
        try {
          const lastPart = i === texts.length - 1;
          last = await post(conversation, texts[i] as string, lastPart ? p.buttons : undefined, thread);
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
    async setButtons(_conversation, ref, buttons) {
      await call("PATCH", `${chat}/v1/${ref}?updateMask=cardsV2`, { cardsV2: cards(buttons) });
    },
  };
};

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof ChatError) {
    if (err.status === 429) return new SendError("retry", msg, 5000, sent);
    // A server error may come after the message was stored: never resent blindly.
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
