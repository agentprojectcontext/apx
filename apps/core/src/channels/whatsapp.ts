// WhatsApp on the owner's own account, as a linked device (Baileys). The owner talks to their agent in "Message
// yourself"; anyone else is a contact the owner approved, and nobody else ever gets an answer from the owner's number.
// The library loads with the first WhatsApp channel; the credentials folder IS the account (kept at 0700).
// See DECISIONS.md#d-025
import fs from "node:fs";
import path from "node:path";
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { chunks } from "./telegram-format.ts";
import { type AdapterIO, type ChannelAdapter, ChannelRefused, type OutFile, SendError } from "./types.ts";

/** The part of the library APX uses, so a test can hand in its own. */
export type WaLib = {
  makeWASocket(opts: Record<string, unknown>): WaSocket;
  useMultiFileAuthState(dir: string): Promise<{ state: unknown; saveCreds: () => Promise<void> | void }>;
  downloadMediaMessage(msg: WaMessage, type: "buffer", opts: Record<string, unknown>): Promise<Buffer>;
  fetchLatestBaileysVersion?(): Promise<{ version: number[] }>;
  Browsers?: { macOS(name: string): [string, string, string] };
  DisconnectReason: { loggedOut: number; restartRequired: number; timedOut: number };
};
export type WaSocket = {
  ev: { on(event: string, listener: (arg: never) => void): void };
  user?: { id: string; lid?: string } | undefined;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string | null } } | undefined>;
  sendPresenceUpdate(type: "composing" | "paused", jid?: string): Promise<void>;
  logout(): Promise<void>;
  end(err?: Error): void;
  /** Where someone's profile picture is (none when they hide it). */
  profilePictureUrl?(jid: string, type: "image" | "preview"): Promise<string | undefined>;
};
export type WaKey = {
  id?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
};
export type WaContent = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: { caption?: string | null } | null;
  videoMessage?: { caption?: string | null } | null;
  documentMessage?: { caption?: string | null; fileName?: string | null } | null;
  audioMessage?: { ptt?: boolean | null; mimetype?: string | null } | null;
  stickerMessage?: unknown;
  ephemeralMessage?: { message?: WaContent | null } | null;
  viewOnceMessage?: { message?: WaContent | null } | null;
  viewOnceMessageV2?: { message?: WaContent | null } | null;
};
export type WaMessage = { key: WaKey; pushName?: string | null; message?: WaContent | null };
type ConnectionUpdate = {
  connection?: "open" | "close" | "connecting";
  qr?: string;
  lastDisconnect?: { error?: { message?: string; output?: { statusCode?: number } } };
};

const loadBaileys = async () => (await import("@whiskeysockets/baileys")) as unknown as WaLib;

/** Voice notes up to this size are downloaded for transcription. */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Rounds of QR codes (about a minute each) before linking waits for the owner to press Link again. */
const QR_ROUNDS = 4;
/** Our own sends come back as echoes within seconds; this only has to outlive that, bounded. */
const ECHOES = 500;
// WhatsApp's own service numbers (verification codes, product tips): never someone writing.
const SERVICE = new Set(["16505361212", "16508638904"]);

/** `5491100000000:12@s.whatsapp.net` → `5491100000000@s.whatsapp.net` (the device suffix is not the person). */
export const normalJid = (jid: string | null | undefined): string => {
  const s = String(jid ?? "").toLowerCase();
  const at = s.indexOf("@");
  if (at < 1) return "";
  return `${s.slice(0, at).split(":")[0]}@${s.slice(at + 1)}`;
};
const isPhone = (jid: string) => jid.endsWith("@s.whatsapp.net");
const digitsOf = (jid: string) => jid.split("@")[0] ?? "";
const ignorable = (jid: string) =>
  !jid ||
  jid.endsWith("@broadcast") ||
  jid.endsWith("@newsletter") ||
  digitsOf(jid) === "0" ||
  SERVICE.has(digitsOf(jid));

/** The words of a message, its wrappers (disappearing, view once) opened. */
function unwrap(c: WaContent | null | undefined): WaContent | undefined {
  let cur = c ?? undefined;
  for (let i = 0; i < 3 && cur; i++) {
    const inner = cur.ephemeralMessage?.message ?? cur.viewOnceMessage?.message ?? cur.viewOnceMessageV2?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur;
}
function textOf(c: WaContent): string | undefined {
  const t =
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption;
  if (t) return t;
  const kind = c.imageMessage
    ? "photo"
    : c.videoMessage
      ? "video"
      : c.documentMessage
        ? "file"
        : c.stickerMessage
          ? "sticker"
          : undefined;
  return kind ? `[${kind} — APX cannot read this kind of message yet]` : undefined;
}

/** Markdown as WhatsApp writes it: *bold*, _italic_, ~strike~, links as "text (url)". */
export function toWhatsApp(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
}

/** What the library logs, as one line: its message and the fields that say why (errors, codes). */
const line = (a: unknown[]) =>
  a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, (_k, v) => (v instanceof Error ? v.message : v))))
    .join(" ")
    .slice(0, 400);
/** Linking and connection steps the library reports at info level: worth keeping, the rest of its info is noise. */
const LINKING = /pair|qr|login|connect|stream|logout|restart|regist/i;

/** A pino-shaped logger: warnings and errors, plus the library's linking steps (they explain a failed link). */
function quiet(log: Log | undefined) {
  const noop = () => {};
  const warn = (...a: unknown[]) => log?.warn({ wa: line(a) }, "whatsapp");
  const info = (...a: unknown[]) => {
    const text = line(a);
    if (LINKING.test(text)) log?.info({ wa: text }, "whatsapp");
  };
  const self: Record<string, unknown> = { level: "info", trace: noop, debug: noop, info, warn, error: warn };
  self.fatal = warn;
  self.child = () => self;
  return self;
}

export function whatsappAdapter(opts: {
  dir: string;
  /** The linked number is the owner's own phone: "Message yourself" is the owner talking. */
  selfOwner?: boolean;
  log?: Log;
  lib?: () => Promise<WaLib>;
}): ChannelAdapter {
  const { dir, log } = opts;
  let lib: WaLib | undefined;
  let sock: WaSocket | undefined;
  let io: AdapterIO | undefined;
  let me: { pn: string; lid: string } | undefined;
  let stopped = false;
  let attempts = 0;
  let qrRounds = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Credentials being written: a reconnect reads them back, so it waits for the last write. */
  let saving: Promise<unknown> = Promise.resolve();
  /** Ids of what we sent: their echoes are not the owner typing. */
  const ownSends = new Set<string>();
  /** The numbered options last offered in each conversation (WhatsApp has no buttons). */
  const offered = new Map<string, Array<{ id: string; label: string }>>();

  const hasCreds = () => fs.existsSync(path.join(dir, "creds.json"));
  const remember = (id: string | null | undefined) => {
    if (!id) return;
    ownSends.add(id);
    while (ownSends.size > ECHOES) ownSends.delete(ownSends.values().next().value as string);
  };
  const isSelf = (jid: string) => Boolean(me && (jid === me.pn || jid === me.lid));

  async function connect(): Promise<void> {
    if (!lib || stopped) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await lib.useMultiFileAuthState(dir);
    let version: number[] | undefined;
    try {
      // An old protocol version is a reliable way to be disconnected: ask what WhatsApp speaks today.
      version = (await lib.fetchLatestBaileysVersion?.())?.version;
    } catch {}
    const s = lib.makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: quiet(log),
      // A web companion on macOS, as WhatsApp Web is. The second field picks the platform the phone links: anything
      // but a browser name (e.g. "Desktop", the native app) makes the phone start linking and then refuse it.
      browser: lib.Browsers?.macOS("APX") ?? ["Mac OS", "APX", "14.4.1"],
      // The phone stays the one that is online: announcing ourselves would mute its notifications.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = s;
    s.ev.on("creds.update", (() => {
      saving = saving.then(saveCreds, saveCreds);
    }) as (arg: never) => void);
    s.ev.on("connection.update", ((u: ConnectionUpdate) => onConnection(s, u)) as (arg: never) => void);
    s.ev.on("messages.upsert", ((up: { type: string; messages: WaMessage[] }) => {
      if (up.type !== "notify" || s !== sock) return;
      for (const m of up.messages) void onMessage(m).catch(() => {});
    }) as (arg: never) => void);
  }

  function onConnection(s: WaSocket, u: ConnectionUpdate): void {
    if (s !== sock || stopped || !lib || !io) return;
    if (u.qr) io.qr?.(u.qr);
    if (u.connection === "open") {
      io.qr?.(undefined);
      attempts = 0;
      qrRounds = 0;
      me = { pn: normalJid(s.user?.id), lid: normalJid(s.user?.lid) };
      io.status("running");
      io.identified?.({ account: `+${digitsOf(me.pn)}`, owner: me.pn });
      return;
    }
    if (u.connection !== "close") return;
    const code = u.lastDisconnect?.error?.output?.statusCode;
    const why = u.lastDisconnect?.error?.message ?? `closed (${code ?? "?"})`;
    if (code === lib.DisconnectReason.loggedOut) {
      // Dead credentials: retrying them in a loop is how an account gets flagged. A human links it again.
      fs.rmSync(dir, { recursive: true, force: true });
      me = undefined;
      io.qr?.(undefined);
      io.status("error", "WhatsApp logged this device out: link it again with the QR");
      return;
    }
    // After a scan WhatsApp asks for a restart: the linked session comes up on the next connection.
    if (code === lib.DisconnectReason.restartRequired) {
      log?.info({ channel: "whatsapp" }, "whatsapp linked: reconnecting with the new credentials");
      void saving.then(connect, connect);
      return;
    }
    log?.warn({ code, why: why.slice(0, 200) }, "whatsapp connection closed");
    // Nobody scanned yet: a fresh round of codes, a few times, then wait for the owner.
    if (!hasCreds() && code === lib.DisconnectReason.timedOut && ++qrRounds < QR_ROUNDS) {
      void connect();
      return;
    }
    if (!hasCreds()) {
      io.qr?.(undefined);
      io.status("error", "The QR was not scanned in time: press Link to get a new one");
      return;
    }
    io.status("error", `WhatsApp disconnected: ${why}`.slice(0, 200));
    const wait = BACKOFF_MS[Math.min(attempts++, BACKOFF_MS.length - 1)] ?? 60_000;
    retry = setTimeout(() => void connect(), wait);
    retry.unref?.();
  }

  async function onMessage(m: WaMessage): Promise<void> {
    if (!io || !me) return;
    const content = unwrap(m.message);
    const jid = normalJid(m.key.remoteJid);
    if (!content || ignorable(jid) || !m.key.id) return;
    const group = jid.endsWith("@g.us");
    if (m.key.fromMe) {
      // Our own send coming back, or someone typing on the linked phone to another chat: neither is for the agent.
      // "Message yourself" is the owner only when the line is the owner's own phone.
      if (ownSends.delete(m.key.id) || !isSelf(jid) || !opts.selfOwner) return;
    }
    const alt = normalJid(m.key.remoteJidAlt);
    // One person, one address: their phone number when WhatsApp tells it, their private id otherwise.
    const who = m.key.fromMe ? me.pn : isPhone(jid) ? jid : alt && isPhone(alt) ? alt : jid;
    const name = m.key.fromMe ? "Owner" : m.pushName?.trim() || `+${digitsOf(who)}`;
    const audio = content.audioMessage;
    let text = textOf(content) ?? "";
    let voice: { mime: string; data: string } | undefined;
    if (audio && !group && lib) {
      try {
        const bytes = await lib.downloadMediaMessage(m, "buffer", {});
        if (bytes.length <= MAX_VOICE_BYTES)
          voice = {
            mime: (audio.mimetype ?? "audio/ogg").split(";")[0] ?? "audio/ogg",
            data: bytes.toString("base64"),
          };
      } catch (err) {
        log?.warn({ err: errorMessage(err, 200) }, "whatsapp voice note not downloaded");
      }
      if (!voice) text = "[voice note: it could not be downloaded]";
    }
    if (!text && !voice) return;
    // A number answering the options offered here is that option, pressed.
    const choice = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
    const options = offered.get(who);
    if (choice && options?.[Number(choice) - 1]) {
      offered.delete(who);
      io.action({ conversation: who, sender: { id: who, name }, data: options[Number(choice) - 1]?.id ?? "" });
      return;
    }
    io.receive({
      external_id: m.key.id,
      conversation: who,
      sender: { id: who, name: name.slice(0, 80) },
      text,
      private: !group,
      ...(voice ? { voice } : {}),
    });
  }

  async function sendOne(jid: string, content: Record<string, unknown>): Promise<string | undefined> {
    if (!sock || !me) throw new SendError("retry", "WhatsApp is not connected");
    try {
      const r = await sock.sendMessage(jid, content);
      const id = r?.key?.id ?? undefined;
      remember(id);
      return id;
    } catch (err) {
      throw new SendError("uncertain", errorMessage(err));
    }
  }

  const fileContent = (f: OutFile): Record<string, unknown> =>
    f.kind === "image"
      ? { image: f.data, mimetype: f.mime }
      : f.mime === "audio/ogg"
        ? { audio: f.data, mimetype: "audio/ogg; codecs=opus", ptt: true }
        : { audio: f.data, mimetype: f.mime };

  return {
    caps: { typing: true, buttons: false, ownAccount: Boolean(opts.selfOwner) },
    async start(adapterIO) {
      io = adapterIO;
      stopped = false;
      qrRounds = 0;
      try {
        lib = await (opts.lib ?? loadBaileys)();
      } catch (err) {
        throw new ChannelRefused(`WhatsApp support could not load: ${errorMessage(err, 200)}`);
      }
      await connect();
      return { waiting: true };
    },
    async stop() {
      stopped = true;
      clearTimeout(retry);
      try {
        sock?.end(undefined);
      } catch {}
      sock = undefined;
    },
    async forget() {
      try {
        await sock?.logout();
      } catch {}
      await this.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async send(conversation, p: Presentation, files = []) {
      const options = p.buttons?.length ? p.buttons : undefined;
      const body = [
        p.text.trim() ? toWhatsApp(p.text) : "",
        options ? options.map((b, i) => `*${i + 1}* — ${b.label}`).join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const steps: Array<() => Promise<string | undefined>> = [
        ...(body ? chunks(body, 4000) : []).map((t) => () => sendOne(conversation, { text: t })),
        ...files.map((f) => () => sendOne(conversation, fileContent(f))),
      ];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<string | undefined>)();
        } catch (err) {
          const e = err instanceof SendError ? err : new SendError("uncertain", errorMessage(err));
          throw new SendError(e.kind, e.message, undefined, i - (p.skip ?? 0));
        }
      }
      if (options) offered.set(conversation, options);
      return last ? { external_id: last } : {};
    },
    async avatar(jid) {
      if (!sock?.profilePictureUrl) return undefined;
      const url = await sock.profilePictureUrl(jid, "image").catch(() => undefined);
      if (!url) return undefined;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return undefined;
      return {
        mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
        data: Buffer.from(await res.arrayBuffer()),
      };
    },
    async typing(conversation) {
      await sock?.sendPresenceUpdate("composing", conversation);
    },
  };
}
