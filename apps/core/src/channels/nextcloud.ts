// Nextcloud Talk through a Nextcloud user of the bot's own and an app password: the OCS API, no webhook, no library.
// The bot's conversations are listed every 30 s and each one it reads is long-polled (one request held open per
// conversation, at most 20). One-to-one conversations are contacts; group and public ones are rooms the owner lists.
// Buttons become numbered options; Talk has no typing indicator for a bot.
import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, numberedOptions, sleep, splitText } from "./net.ts";
import { type AdapterIO, type ChannelAdapter, type ChannelConfig, ChannelRefused, SendError } from "./types.ts";

const CALL_MS = 20_000;
const POLL_S = 30;
const ROOMS_EVERY_MS = 30_000;
const MAX_ROOMS = 20;
const MAX_CHARS = 32_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_REACTED = 500;
const ONE_TO_ONE = 1;
const ROOM_TYPES = new Set([2, 3]);
const CHAT = "/ocs/v2.php/apps/spreed/api/v1/chat";

type TalkRoom = {
  token: string;
  type: number;
  displayName?: string;
  name?: string;
  lastActivity?: number;
  lastMessage?: { id?: number } | unknown[];
};
type Param = { type?: string; id?: string; name?: string };
type TalkMessage = {
  id: number;
  actorType?: string;
  actorId?: string;
  actorDisplayName?: string;
  message?: string;
  messageType?: string;
  systemMessage?: string;
  timestamp?: number;
  messageParameters?: Record<string, Param> | unknown[];
  parent?: { actorType?: string; actorId?: string };
};
type State = { rooms: Record<string, number> };

class TalkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Nextcloud: ${message}`);
    this.status = status;
  }
}

/** The server, the bot's user and its app password, stored as one secret: "https://cloud.example.org apxbot xxxxx-…". */
export function nextcloudSecret(secret: string | undefined): { server?: string; user?: string; password?: string } {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const server = words.find((w) => /^https?:\/\//.test(w));
  const [user, password] = words.filter((w) => w !== server);
  return {
    ...(server ? { server: server.replace(/\/+$/, "") } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}

const readState = (file: string): State => {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { rooms: s.rooms && typeof s.rooms === "object" ? s.rooms : {} };
  } catch {
    return { rooms: {} };
  }
};
const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
const lastIdOf = (r: TalkRoom) => (Array.isArray(r.lastMessage) ? 0 : (r.lastMessage?.id ?? 0));

export function nextcloudAdapter(
  config: ChannelConfig,
  secret: string | undefined,
  opts: { dir: string; roomsEveryMs?: number },
): ChannelAdapter {
  const ac = new AbortController();
  const { server, user, password } = nextcloudSecret(secret);
  const listed = new Set((config.rooms?.rooms ?? []).map((r) => r.id));
  const options = numberedOptions();
  const stateFile = path.join(opts.dir, "nextcloud-state.json");
  const state = readState(stateFile);
  /** One long-poll per conversation read, and how to stop it. */
  const polls = new Map<string, { ac: AbortController; done: Promise<void> }>();
  const groups = new Map<string, string>();
  /** The emoji the bot put on each message, to take it off again. */
  const reacted = new Map<string, string>();
  let me = "";
  let startedAt = 0;
  let loop: Promise<void> | undefined;

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  async function api<T>(
    method: string,
    route: string,
    body?: unknown,
    timeoutMs = CALL_MS,
    signal = ac.signal,
  ): Promise<{ status: number; data: T | undefined }> {
    if (!server || !user || !password) throw new TalkError(401, "no user or app password");
    const res = await fetch(`${server}${route}`, {
      method,
      headers: {
        "OCS-APIRequest": "true",
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (res.status === 304) return { status: 304, data: undefined };
    const j = (await res.json().catch(() => ({}))) as { ocs?: { meta?: { message?: string }; data?: T } };
    if (!res.ok) throw new TalkError(res.status, j.ocs?.meta?.message || `HTTP ${res.status}`);
    return { status: res.status, data: j.ocs?.data };
  }

  /** A message's words, with its placeholders ({mention-user1}, {file}) written out; the bot's own @mention dropped. */
  function textOf(m: TalkMessage): { text: string; called: boolean } {
    const params = Array.isArray(m.messageParameters) ? {} : (m.messageParameters ?? {});
    let called = m.parent?.actorType === "users" && m.parent.actorId === me;
    const text = (m.message ?? "").replace(/\{([\w-]+)\}/g, (raw, key: string) => {
      const p = params[key];
      if (!p) return raw;
      if (p.type === "user" && p.id === me) {
        called = true;
        return "";
      }
      return ["user", "guest", "user-group", "call"].includes(p.type ?? "") ? `@${p.name ?? p.id}` : (p.name ?? raw);
    });
    return { text: text.replace(/\s+/g, " ").trim(), called };
  }

  function handle(token: string, kind: "contact" | "room", since: number, m: TalkMessage, io: AdapterIO): void {
    // People's words only: no system messages, no bots or bridges, never the bot's own, no history.
    if (m.systemMessage || (m.messageType && m.messageType !== "comment")) return;
    if (!m.actorId || (m.actorType !== "users" && m.actorType !== "guests")) return;
    if (m.actorType === "users" && m.actorId === me) return;
    if ((m.timestamp ?? 0) < since) return;
    const { text, called } = textOf(m);
    if (!text) return;
    const name = clean(m.actorDisplayName ?? "").slice(0, 60) || m.actorId;
    const sender =
      m.actorType === "users"
        ? { id: m.actorId, name, handle: m.actorId }
        : { id: `guest:${m.actorId}`, name: `${name} (guest)` };
    if (kind === "room") {
      io.receive({ external_id: String(m.id), conversation: token, sender, text, private: false, room: { called } });
      return;
    }
    const picked = options.pick(token, text);
    if (picked) io.action({ conversation: token, sender, data: picked });
    else io.receive({ external_id: String(m.id), conversation: token, sender, text, private: true });
  }

  /** One conversation's long-poll: Talk holds the request until something is said there (304 after 30 s of quiet). */
  async function poll(token: string, kind: "contact" | "room", since: number, io: AdapterIO, signal: AbortSignal) {
    let backoff = 1000;
    while (!signal.aborted) {
      const asked = Date.now();
      try {
        const q = new URLSearchParams({
          lookIntoFuture: "1",
          timeout: String(POLL_S),
          lastKnownMessageId: String(state.rooms[token] ?? 0),
          setReadMarker: "1",
          limit: "100",
        });
        const r = await api<TalkMessage[]>(
          "GET",
          `${CHAT}/${encodeURIComponent(token)}?${q}`,
          undefined,
          (POLL_S + 15) * 1000,
          signal,
        );
        backoff = 1000;
        if (r.status === 304 || !Array.isArray(r.data)) {
          // A server that answers "nothing new" at once is not long-polling: never spin on it.
          if (Date.now() - asked < 1000) await sleep(1000, signal);
          continue;
        }
        for (const m of [...r.data].sort((a, b) => a.id - b.id)) {
          if (m.id <= (state.rooms[token] ?? 0)) continue;
          state.rooms[token] = m.id;
          handle(token, kind, since, m, io);
        }
        save();
      } catch (err) {
        if (signal.aborted) return;
        // The bot left the conversation, or it was deleted: the next listing drops it.
        if (err instanceof TalkError && err.status === 404) return;
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /** The bot's conversations: rooms offered in the picker, and the ones it reads polled (new ones, from now on). */
  async function refresh(io: AdapterIO, first: boolean): Promise<void> {
    const rooms = (await api<TalkRoom[]>("GET", "/ocs/v2.php/apps/spreed/api/v4/room")).data ?? [];
    const now = new Map<string, string>();
    for (const r of rooms)
      if (ROOM_TYPES.has(r.type)) {
        const name = clean(r.displayName || r.name || r.token).slice(0, 80);
        now.set(r.token, name);
        io.room?.({ id: r.token, name });
      }
    for (const [id, name] of groups) if (!now.has(id)) io.room?.({ id, name, left: true });
    groups.clear();
    for (const [id, name] of now) groups.set(id, name);

    const read = rooms
      .filter((r) => r.type === ONE_TO_ONE || (ROOM_TYPES.has(r.type) && listed.has(r.token)))
      .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
      .slice(0, MAX_ROOMS);
    const reading = new Set(read.map((r) => r.token));
    for (const [token, p] of polls)
      if (!reading.has(token)) {
        p.ac.abort();
        polls.delete(token);
      }
    for (const r of read) {
      if (polls.has(r.token)) continue;
      // Never answer what was said before: a conversation known at start begins at its newest message; one that
      // appears later is read from its start, skipping what is older than the channel.
      const known = state.rooms[r.token] !== undefined;
      if (!known) state.rooms[r.token] = first ? lastIdOf(r) : 0;
      const since = known || first ? 0 : Math.floor(startedAt / 1000);
      const stop = new AbortController();
      const signal = AbortSignal.any([ac.signal, io.signal, stop.signal]);
      const kind = r.type === ONE_TO_ONE ? "contact" : "room";
      const done = poll(r.token, kind, since, io, signal).finally(() => {
        if (polls.get(r.token)?.ac === stop) polls.delete(r.token);
      });
      polls.set(r.token, { ac: stop, done });
    }
    const all = new Set(rooms.map((r) => r.token));
    for (const token of Object.keys(state.rooms)) if (!all.has(token)) delete state.rooms[token];
    save();
  }

  async function run(io: AdapterIO): Promise<void> {
    let failing = false;
    const signal = AbortSignal.any([ac.signal, io.signal]);
    while (!signal.aborted) {
      await sleep(opts.roomsEveryMs ?? ROOMS_EVERY_MS, signal);
      if (signal.aborted) return;
      try {
        await refresh(io, false);
        if (failing) io.status("running");
        failing = false;
      } catch (err) {
        if (signal.aborted) return;
        failing = true;
        io.status("error", `cannot reach Nextcloud: ${errorMessage(err)}`.slice(0, 200));
      }
    }
  }

  async function post(token: string, message: string, replyTo?: string): Promise<string> {
    const reply = replyTo && /^\d+$/.test(replyTo) ? { replyTo: Number(replyTo) } : {};
    const r = await api<{ id?: number }>("POST", `${CHAT}/${encodeURIComponent(token)}`, { message, ...reply });
    return String(r.data?.id ?? "");
  }

  return {
    caps: { typing: false, buttons: false, reactions: true },
    async start(io) {
      if (!server || !user || !password)
        throw new ChannelRefused(
          "Nextcloud Talk needs the server's address (https://…), the bot's user and an app password",
        );
      const who = await api<{ id?: string }>("GET", "/ocs/v2.php/cloud/user").catch((err: unknown) => {
        throw err instanceof TalkError && (err.status === 401 || err.status === 403)
          ? new ChannelRefused("Nextcloud refused the user or app password: make a new app password for the bot's user")
          : err;
      });
      me = who.data?.id ?? user;
      startedAt = Date.now();
      await refresh(io, true);
      loop = run(io);
      return { account: me };
    },
    async stop() {
      ac.abort();
      await Promise.allSettled([loop, ...[...polls.values()].map((p) => p.done)]);
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async send(conversation, p) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < texts.length; i++) {
        try {
          last = await post(conversation, texts[i] ?? "", i === 0 ? p.reply_to : undefined);
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last ? { external_id: last } : {};
    },
    async react(conversation, ref, emoji) {
      const route = `/ocs/v2.php/apps/spreed/api/v1/reaction/${encodeURIComponent(conversation)}/${encodeURIComponent(ref)}`;
      const key = `${conversation}/${ref}`;
      const before = reacted.get(key);
      if (before && before !== emoji)
        await api("DELETE", `${route}?${new URLSearchParams({ reaction: before })}`).catch(() => {});
      reacted.delete(key);
      if (!emoji) return;
      await api("POST", route, { reaction: emoji });
      reacted.set(key, emoji);
      if (reacted.size > MAX_REACTED) reacted.delete(reacted.keys().next().value ?? "");
    },
  };
}

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof TalkError) {
    if (err.status === 429) return new SendError("retry", msg, 10_000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
