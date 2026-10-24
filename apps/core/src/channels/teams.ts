// Microsoft Teams as a bot through the Bot Framework (an Azure Bot on a single-tenant app registration). Teams only
// delivers to a webhook: each activity comes to the channel's public address with a JWT the Bot Framework signed,
// checked here against its published keys before anything is read. Answers go to the connector at the activity's
// serviceUrl, kept per conversation in the channel's folder so a restart can still answer. A personal chat is a
// contact; a team channel or a group chat is a room, read when the bot is @mentioned there and the owner listed it.
// Buttons are an Adaptive Card's Action.Submit. Files are not sent or read.
import { createPublicKey, type KeyObject, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, splitText } from "./net.ts";
import {
  type AdapterFactory,
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  type HookRequest,
  type HookResponse,
  SendError,
} from "./types.ts";

const CALL_MS = 20_000;
/** Teams takes about 28 KB a message; well under it. */
const MAX_CHARS = 4000;
const ISSUER = "https://api.botframework.com";
const SCOPE = "https://api.botframework.com/.default";
const SKEW_S = 300;
/** The signing keys are fetched again for an unknown key id, at most this often. */
const KEYS_MS = 5 * 60_000;
const CHECK_MS = 30_000;
/** A delivery this recent shows the address works, even when the core does not know it. */
const HEARD_MS = 10 * 60_000;
const MAX_KEPT = 500;
const NO_ADDRESS = "Turn on a public address in Settings › Channels: Teams delivers only to a webhook";

type Account = { id?: string; name?: string; role?: string };
type Activity = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  serviceUrl?: string;
  channelId?: string;
  replyToId?: string;
  from?: Account;
  recipient?: Account;
  conversation?: { id?: string; name?: string; conversationType?: string };
  entities?: Array<{ type?: string; text?: string; mentioned?: Account }>;
  value?: { apx?: unknown; action?: { data?: { apx?: unknown } } };
  membersAdded?: Account[];
  membersRemoved?: Account[];
  channelData?: { team?: { name?: string }; channel?: { name?: string } };
};
type Jwk = { kid?: string; kty?: string; n?: string; e?: string; endorsements?: string[] };
/** Where each conversation's connector is, and the bot's name once an activity told it. */
type State = { services: Record<string, string>; bot?: string };

class TeamsError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(`Teams: ${message}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The app registration's id, a client secret and the tenant, stored as one secret: "<app id> <secret> <tenant id>".
 * The app id comes first, the tenant after the secret (both are GUIDs).
 */
export function teamsSecret(raw: string | undefined): { appId: string; password: string; tenant: string } | undefined {
  const words = (raw ?? "").split(/\s+/).filter(Boolean);
  if (words.length !== 3) return undefined;
  const [appId, password, tenant] = words as [string, string, string];
  if (!GUID.test(appId) || !GUID.test(tenant) || password.length < 8) return undefined;
  return { appId, password, tenant };
}

export type TeamsOptions = {
  dir: string;
  /** The Bot Framework's OpenID configuration (tests). */
  openid?: string;
  /** Microsoft's sign-in base, before `/<tenant>/oauth2/v2.0/token` (tests). */
  login?: string;
  /** How often a missing public address is looked at again. */
  checkMs?: number;
};

export function teamsAdapter(
  config: Parameters<AdapterFactory>[0],
  secret: string | undefined,
  opts: TeamsOptions,
): ChannelAdapter {
  const ac = new AbortController();
  const creds = teamsSecret(secret);
  const openid = opts.openid ?? "https://login.botframework.com/v1/.well-known/openidconfiguration";
  const login = opts.login ?? "https://login.microsoftonline.com";
  const listed = new Set((config.rooms?.rooms ?? []).map((r) => r.id));
  const stateFile = path.join(opts.dir, "teams-state.json");
  const state = readState(stateFile);
  // The thread each room message is in, so the answer joins it.
  const threads = new Map<string, string>();
  // The words of each message sent with buttons, since replacing its buttons rewrites the whole message.
  const carded = new Map<string, string>();
  let keys: { byKid: Map<string, { key: KeyObject; endorsements?: string[] }>; at: number } | undefined;
  let token: { value: string; until: number } | undefined;
  let io: AdapterIO | undefined;
  let addressless = false;
  /** When a verified activity last came: proof enough that an address reaches the core. */
  let heardAt = 0;
  let keysFailed = false;
  let check: ReturnType<typeof setInterval> | undefined;

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  const keep = <V>(m: Map<string, V>, k: string, v: V) => {
    m.set(k, v);
    if (m.size > MAX_KEPT) m.delete(m.keys().next().value as string);
  };

  /** Running once a public address exists; an error the owner can act on while none does. */
  function lookAtAddress(): void {
    if (!io) return;
    const missing = !io.hookUrl?.() && Date.now() - heardAt > HEARD_MS;
    if (missing === addressless) return;
    addressless = missing;
    if (missing) io.status("error", NO_ADDRESS);
    else io.status("running");
  }

  /** An access token for the bot (client credentials), kept until a minute before it expires. */
  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.until) return token.value;
    if (!creds) throw new TeamsError(401, "no app id, secret or tenant");
    const res = await fetch(`${login}/${creds.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.appId,
        client_secret: creds.password,
        scope: SCOPE,
      }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    const j = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    // A wrong secret or app id is a 400 or 401, a wrong tenant a 400.
    if (!res.ok || !j.access_token)
      throw new TeamsError(
        res.status === 400 ? 401 : res.status,
        (j.error_description ?? `token: HTTP ${res.status}`).split("\n")[0] as string,
      );
    token = { value: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  }

  async function connector<T>(method: string, conversation: string, route: string, body: unknown): Promise<T> {
    const service = state.services[baseOf(conversation)];
    if (!service) throw new TeamsError(404, "no address known for this conversation yet: it must write first");
    const res = await fetch(
      `${service.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(conversation)}/activities${route}`,
      {
        method,
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
      },
    );
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.status === 401) token = undefined;
    if (!res.ok) {
      const after = Number(res.headers.get("retry-after"));
      throw new TeamsError(res.status, j.error?.message ?? `HTTP ${res.status}`, after > 0 ? after * 1000 : undefined);
    }
    return j as T;
  }

  /** The Bot Framework's signing keys by id, fetched again when one is unknown (not more than every few minutes). */
  async function signingKey(kid: string) {
    if (!keys?.byKid.has(kid) && (!keys || Date.now() - keys.at > KEYS_MS)) {
      const get = async <T>(url: string) => {
        const res = await fetch(url, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]) });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
        return (await res.json()) as T;
      };
      const { jwks_uri } = await get<{ jwks_uri?: string }>(openid);
      if (!jwks_uri) throw new Error("no jwks_uri in the Bot Framework's OpenID configuration");
      const byKid = new Map<string, { key: KeyObject; endorsements?: string[] }>();
      for (const k of (await get<{ keys?: Jwk[] }>(jwks_uri)).keys ?? []) {
        if (!k.kid || k.kty !== "RSA" || !k.n || !k.e) continue;
        try {
          const key = createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" });
          byKid.set(k.kid, { key, ...(Array.isArray(k.endorsements) ? { endorsements: k.endorsements } : {}) });
        } catch {
          // A key that cannot be read signs nothing we accept.
        }
      }
      keys = { byKid, at: Date.now() };
    }
    return keys?.byKid.get(kid);
  }

  /**
   * The token's claims, and the platforms its key may sign for, when the Bot Framework signed it for this bot and it
   * is current; none otherwise.
   */
  async function verified(
    authorization: string | undefined,
  ): Promise<{ claims: Record<string, unknown>; endorsements?: string[] } | undefined> {
    const jwt = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    const [h, p, s] = jwt?.split(".") ?? [];
    if (!creds || !h || !p || !s) return undefined;
    let head: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      head = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as typeof head;
      claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as typeof claims;
    } catch {
      return undefined;
    }
    if (head.alg !== "RS256" || !head.kid) return undefined;
    const k = await signingKey(head.kid);
    if (!k || !verify("RSA-SHA256", Buffer.from(`${h}.${p}`), k.key, Buffer.from(s, "base64url"))) return undefined;
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !aud.includes(creds.appId)) return undefined;
    if (typeof claims.exp !== "number" || claims.exp + SKEW_S < now) return undefined;
    if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > now) return undefined;
    return { claims, ...(k.endorsements ? { endorsements: k.endorsements } : {}) };
  }

  const clean = (s: string | undefined) =>
    (s ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, 60);

  /** The words of a message: the bot's own @mention dropped (it is how it was called), others' kept as @name. */
  function textOf(a: Activity): { text: string; called: boolean } {
    let text = a.text ?? "";
    let called = false;
    for (const e of a.entities ?? []) {
      if (e.type !== "mention" || !e.text) continue;
      if (e.mentioned?.id && e.mentioned.id === a.recipient?.id) {
        called = true;
        text = text.split(e.text).join("");
      }
    }
    text = text
      .replace(/<at>([^<]*)<\/at>/g, "@$1")
      .replace(/&nbsp;/g, " ")
      .trim();
    return { text, called };
  }

  function handle(a: Activity, io: AdapterIO): HookResponse {
    const full = a.conversation?.id;
    if (!full || !a.serviceUrl) return { status: 200 };
    const conversation = baseOf(full);
    const direct = (a.conversation?.conversationType ?? "personal") === "personal";
    const bot = clean(a.recipient?.name);
    if (state.services[conversation] !== a.serviceUrl || (bot && state.bot !== bot)) {
      state.services[conversation] = a.serviceUrl;
      const all = Object.keys(state.services);
      if (all.length > MAX_KEPT * 4) delete state.services[all[0] as string];
      if (bot && state.bot !== bot) {
        state.bot = bot;
        io.identified?.({ account: bot });
      }
      save();
    }
    const roomName =
      clean(a.conversation?.name) ||
      clean([a.channelData?.team?.name, a.channelData?.channel?.name].filter(Boolean).join(" › ")) ||
      conversation;
    const me = a.recipient?.id;
    if (a.type === "conversationUpdate") {
      if (direct || !me) return { status: 200 };
      if (a.membersAdded?.some((m) => m.id === me)) io.room?.({ id: conversation, name: roomName });
      if (a.membersRemoved?.some((m) => m.id === me)) io.room?.({ id: conversation, name: roomName, left: true });
      return { status: 200 };
    }
    const who = a.from;
    if (!who?.id || who.role === "bot") return { status: 200 };
    const sender = { id: who.id, name: clean(who.name) || who.id };
    const data = a.type === "invoke" ? a.value?.action?.data?.apx : a.type === "message" ? a.value?.apx : undefined;
    if (typeof data === "string" && data) {
      // Buttons only go to personal chats (the owner's confirmations), so a click counts only there.
      if (direct) io.action({ conversation, sender, data, ...(a.replyToId ? { ref: a.replyToId } : {}) });
      return a.type === "invoke"
        ? { status: 200, body: { statusCode: 200, type: "application/vnd.microsoft.activity.message", value: "" } }
        : { status: 200 };
    }
    if (a.type !== "message" || !a.id) return { status: 200 };
    if (direct) {
      const text = (a.text ?? "").trim();
      if (text) io.receive({ external_id: a.id, conversation, sender, text, private: true });
      return { status: 200 };
    }
    io.room?.({ id: conversation, name: roomName });
    const { text, called } = textOf(a);
    if (!listed.has(conversation) || !text) return { status: 200 };
    keep(threads, a.id, full);
    io.receive({ external_id: a.id, conversation, sender, text, private: false, room: { called } });
    return { status: 200 };
  }

  function card(buttons: Presentation["buttons"]) {
    if (!buttons?.length) return [];
    const content = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.4",
      body: [],
      actions: buttons.map((b) => ({ type: "Action.Submit", title: b.label, data: { apx: b.id } })),
    };
    return [{ contentType: "application/vnd.microsoft.card.adaptive", content }];
  }

  async function post(conversation: string, text: string, buttons: Presentation["buttons"], replyTo?: string) {
    const attachments = card(buttons);
    const thread = replyTo ? threads.get(replyTo) : undefined;
    const body = {
      type: "message",
      ...(text ? { text, textFormat: "markdown" } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(thread && replyTo ? { replyToId: replyTo } : {}),
    };
    const r =
      thread && replyTo
        ? await connector<{ id?: string }>("POST", thread, `/${encodeURIComponent(replyTo)}`, body)
        : await connector<{ id?: string }>("POST", conversation, "", body);
    if (r.id && attachments.length) keep(carded, r.id, text);
    return r.id;
  }

  return {
    caps: { typing: true, buttons: true },
    async start(given) {
      if (!creds)
        throw new ChannelRefused("Teams needs the app id, a client secret and the tenant id, separated by spaces");
      io = given;
      await accessToken().catch((err: unknown) => {
        if (err instanceof TeamsError && [400, 401, 403].includes(err.status))
          throw new ChannelRefused(`Microsoft refused the bot: check the app id, secret and tenant (${err.message})`);
        throw err;
      });
      lookAtAddress();
      check = setInterval(lookAtAddress, opts.checkMs ?? CHECK_MS);
      check.unref?.();
      return { account: state.bot ?? creds.appId };
    },
    async stop() {
      ac.abort();
      clearInterval(check);
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async webhook(req: HookRequest): Promise<HookResponse> {
      if (!io || ac.signal.aborted) return { status: 503 };
      if (req.method !== "POST" || req.path !== "") return { status: 404 };
      let v: Awaited<ReturnType<typeof verified>>;
      try {
        v = await verified(req.headers.authorization);
      } catch (err) {
        // The keys could not be fetched: Bot Framework tries again later.
        keysFailed = true;
        io.status("error", `cannot read the Bot Framework's signing keys: ${errorMessage(err)}`.slice(0, 200));
        return { status: 503 };
      }
      if (!v) return { status: 401 };
      let a: Activity;
      try {
        a = JSON.parse(req.body.toString("utf8")) as Activity;
      } catch {
        return { status: 400 };
      }
      // The connector answers go to is the one the token names, never one only the body claims.
      if (typeof a !== "object" || !a || v.claims.serviceurl !== a.serviceUrl) return { status: 401 };
      // A key endorsed for some channels signs only activities that name one of them, never one that names none.
      if (v.endorsements && (typeof a.channelId !== "string" || !v.endorsements.includes(a.channelId)))
        return { status: 401 };
      heardAt = Date.now();
      lookAtAddress();
      if (keysFailed) {
        keysFailed = false;
        io.status("running");
      }
      return handle(a, io);
    },
    async send(conversation, p) {
      const texts = p.text.trim() ? splitText(p.text, MAX_CHARS) : p.buttons?.length ? [""] : [];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < texts.length; i++) {
        try {
          const lastPart = i === texts.length - 1;
          last = await post(conversation, texts[i] as string, lastPart ? p.buttons : undefined, p.reply_to);
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
    async typing(conversation) {
      await connector("POST", conversation, "", { type: "typing" });
    },
    async setButtons(conversation, ref, buttons) {
      // Without the message's words the rewrite would blank it: buttons of an unknown message stay.
      const text = carded.get(ref);
      if (text === undefined) return;
      const attachments = card(buttons);
      await connector("PUT", conversation, `/${encodeURIComponent(ref)}`, {
        type: "message",
        id: ref,
        ...(text ? { text, textFormat: "markdown" } : {}),
        attachments,
      });
    },
  };
}

/** A channel's conversation without the thread a message sits in (";messageid=…"): the room, stable across threads. */
const baseOf = (conversation: string) => conversation.split(";messageid=")[0] as string;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof TeamsError) {
    if (err.status === 429) return new SendError("retry", msg, err.retryAfterMs ?? 5000, sent);
    // A server error may come after the message was stored: never resent blindly.
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
    const services = s.services && typeof s.services === "object" ? s.services : {};
    return { services, ...(typeof s.bot === "string" ? { bot: s.bot } : {}) };
  } catch {
    return { services: {} };
  }
}
