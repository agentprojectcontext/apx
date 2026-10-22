// WhatsApp on the owner's own account, as a linked device (Baileys). The owner talks to their agent in "Message
// yourself"; anyone else is a contact the owner approved, and nobody else ever gets an answer from the owner's number.
// The library loads with the first WhatsApp channel; the credentials folder IS the account (kept at 0700).
// See DECISIONS.md#d-025
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_LIMITS } from "@apx/protocol";
import type { Inbound, Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { chunks } from "./telegram-format.ts";
import {
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  type OutFile,
  type Recovered,
  SendError,
} from "./types.ts";
import { type Menu, menuText, optionNamed, readMenu, tapFor, WA_CONTAINERS } from "./whatsapp-menus.ts";

/** The part of the library APX uses, so a test can hand in its own. */
export type WaLib = {
  makeWASocket(opts: Record<string, unknown>): WaSocket;
  useMultiFileAuthState(dir: string): Promise<{ state: unknown; saveCreds: () => Promise<void> | void }>;
  downloadMediaMessage(
    msg: WaMessage,
    type: "buffer",
    opts: Record<string, unknown>,
    ctx?: { logger: unknown; reuploadRequest: (m: WaMessage) => Promise<WaMessage> },
  ): Promise<Buffer>;
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
  /** Asks to hear when someone comes online or leaves (until the connection closes). */
  presenceSubscribe?(jid: string): Promise<void>;
  /** Asks the sender's phone to upload an expired file again (its download link is old). */
  updateMediaMessage?(m: WaMessage): Promise<WaMessage>;
  /** Asks the owner's phone to send one message again; it comes back through `messages.upsert`. */
  requestPlaceholderResend?(key: WaKey): Promise<string | undefined>;
  /** A private id's phone number (and the other way round), when WhatsApp told it. */
  signalRepository?: {
    lidMapping?: {
      getPNForLID?(lid: string): Promise<string | null | undefined>;
      getLIDForPN?(pn: string): Promise<string | null | undefined>;
    };
  };
};
export type WaKey = {
  id?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
};
/** A file's size as the library hands it: a number, or a protobuf Long. */
type WaLength = number | { toNumber(): number } | null | undefined;
type WaFile = { mimetype?: string | null; fileLength?: WaLength };
export type WaContent = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: (WaFile & { caption?: string | null }) | null;
  videoMessage?: (WaFile & { caption?: string | null }) | null;
  /** A round video note. */
  ptvMessage?: WaFile | null;
  documentMessage?: (WaFile & { caption?: string | null; fileName?: string | null }) | null;
  audioMessage?: { ptt?: boolean | null; mimetype?: string | null } | null;
  stickerMessage?: WaFile | null;
  /** An emoji on a message (`key.id`); empty text when it was taken off. */
  reactionMessage?: { key?: WaKey | null; text?: string | null } | null;
  ephemeralMessage?: { message?: WaContent | null } | null;
  viewOnceMessage?: { message?: WaContent | null } | null;
  viewOnceMessageV2?: { message?: WaContent | null } | null;
};
export type WaMessage = {
  key: WaKey;
  pushName?: string | null;
  /** A verified business's name: such accounts send it instead of `pushName`. */
  verifiedBizName?: string | null;
  /** Set when the message arrived without content (it could not be decrypted). */
  messageStubType?: number | null;
  message?: WaContent | null;
};
/** A send of ours moving on: 3 on their device, 4 read, 5 a voice note played. */
type WaUpdate = { key: WaKey; update: { status?: number | null } };
type WaPresence = { id: string; presences: Record<string, { lastKnownPresence?: string; lastSeen?: number }> };
type ConnectionUpdate = {
  connection?: "open" | "close" | "connecting";
  qr?: string;
  lastDisconnect?: { error?: { message?: string; output?: { statusCode?: number } } };
};

const loadBaileys = async () => (await import("@whiskeysockets/baileys")) as unknown as WaLib;

/** Voice notes up to this size are downloaded for transcription. */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
/** Recent incoming messages whose chat is remembered for a reaction. */
const CHATS_KEPT = 500;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Rounds of QR codes (about a minute each) before linking waits for the owner to press Link again. */
const QR_ROUNDS = 4;
/** Our own sends come back as echoes within seconds; this only has to outlive that, bounded. */
const ECHOES = 500;
// WhatsApp's own service numbers (verification codes, product tips): never someone writing.
const SERVICE = new Set(["16505361212", "16508638904"]);
/** How long the phone has to send messages again under one address before the next one is tried. */
const RESEND_WAIT_MS = 12_000;

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
  for (let i = 0; i < 6 && cur; i++) {
    const wrappers = cur as Record<string, { message?: WaContent | null } | null | undefined>;
    const inner = WA_CONTAINERS.map((k) => wrappers[k]?.message).find(Boolean);
    if (!inner) break;
    cur = inner;
  }
  return cur;
}
function textOf(c: WaContent): string | undefined {
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    menuText(c)
  );
}

/** A message's picture, video, sticker or document: what it is, the name it is kept under and its declared size. */
type WaMedia = { kind: "photo" | "video" | "sticker" | "file"; name: string; mime: string; size: number };
const sizeOf = (n: WaLength) => (typeof n === "number" ? n : n ? n.toNumber() : 0);
const extOf = (mime: string, fallback: string) =>
  ({ "video/quicktime": "mov", "video/3gpp": "3gp", "image/jpeg": "jpg" })[mime] ??
  (/^[a-z]+\/([a-z0-9]{2,5})$/.exec(mime)?.[1] || fallback);
function mediaOf(c: WaContent): WaMedia | undefined {
  const typed = (f: WaFile, fallback: string) => (f.mimetype ?? fallback).split(";")[0]?.trim() || fallback;
  const made = (kind: WaMedia["kind"], f: WaFile, fallback: string, base: string): WaMedia => {
    const mime = typed(f, fallback);
    return { kind, mime, name: `${base}.${extOf(mime, fallback.split("/")[1] ?? "bin")}`, size: sizeOf(f.fileLength) };
  };
  if (c.imageMessage) return made("photo", c.imageMessage, "image/jpeg", "photo");
  if (c.videoMessage) return made("video", c.videoMessage, "video/mp4", "video");
  if (c.ptvMessage) return made("video", c.ptvMessage, "video/mp4", "video");
  if (c.stickerMessage) return made("sticker", c.stickerMessage, "image/webp", "sticker");
  const d = c.documentMessage;
  if (!d) return undefined;
  const name = path.basename(String(d.fileName ?? "").replaceAll("\\", "/")).slice(0, 200) || "document";
  return { kind: "file", name, mime: typed(d, "application/octet-stream"), size: sizeOf(d.fileLength) };
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
  /** How long the phone has to send a message again (tests shorten it). */
  resendWaitMs?: number;
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
  /** Who is online, by phone address; and the addresses asked about on this connection. */
  const seen = new Map<string, { online: boolean; last_seen?: string }>();
  const watching = new Set<string>();
  /** The chat each recent message came in on (WhatsApp's own id for it), to react to it exactly there. */
  const chats = new Map<string, string>();
  /** Messages asked of the phone again (recover), waiting for it to send them. */
  const resending = new Map<string, (m: WaMessage) => void>();
  /** The menu each chat's other side offered last (a business's buttons), so an answer naming an option taps it. */
  const menus = new Map<string, Menu>();

  const hasCreds = () => fs.existsSync(path.join(dir, "creds.json"));
  const remember = (id: string | null | undefined) => {
    if (!id) return;
    ownSends.add(id);
    while (ownSends.size > ECHOES) ownSends.delete(ownSends.values().next().value as string);
  };
  const isSelf = (jid: string) => Boolean(me && (jid === me.pn || jid === me.lid));

  let connecting: Promise<void> = Promise.resolve();
  function connect(): Promise<void> {
    connecting = openSocket();
    return connecting;
  }

  async function openSocket(): Promise<void> {
    if (!lib || stopped) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await lib.useMultiFileAuthState(dir);
    let version: number[] | undefined;
    try {
      // An old protocol version is a reliable way to be disconnected: ask what WhatsApp speaks today.
      version = (await lib.fetchLatestBaileysVersion?.())?.version;
    } catch {}
    if (stopped) return;
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
      if (s !== sock || stopped) return;
      saving = saving.then(saveCreds, saveCreds);
    }) as (arg: never) => void);
    s.ev.on("connection.update", ((u: ConnectionUpdate) => onConnection(s, u)) as (arg: never) => void);
    s.ev.on("messages.upsert", ((up: { type: string; messages: WaMessage[] }) => {
      if (s !== sock) return;
      for (const m of up.messages) {
        // A message the phone sent again on request is that request's answer, not news.
        const asked = m.key.id ? resending.get(m.key.id) : undefined;
        if (asked) asked(m);
        else if (up.type === "notify")
          void onMessage(m).catch((err) => log?.warn({ err: errorMessage(err, 200) }, "whatsapp message not handled"));
      }
    }) as (arg: never) => void);
    s.ev.on("messages.update", ((ups: WaUpdate[]) => {
      if (s !== sock) return;
      for (const u of ups) {
        const state = u.update.status === 3 ? "delivered" : (u.update.status ?? 0) >= 4 ? "read" : undefined;
        if (u.key.fromMe && u.key.id && state) io?.receipt?.(u.key.id, state);
      }
    }) as (arg: never) => void);
    s.ev.on("presence.update", ((p: WaPresence) => {
      if (s === sock) void onPresence(s, p).catch(() => {});
    }) as (arg: never) => void);
  }

  async function onPresence(s: WaSocket, p: WaPresence): Promise<void> {
    for (const [jid, v] of Object.entries(p.presences)) {
      let who = normalJid(jid);
      if (who.endsWith("@lid")) who = normalJid(await s.signalRepository?.lidMapping?.getPNForLID?.(who)) || who;
      if (!v.lastKnownPresence) continue;
      // Typing or recording is being there too.
      const online = v.lastKnownPresence !== "unavailable";
      const was = seen.get(who);
      const last = v.lastSeen ? new Date(v.lastSeen * 1000).toISOString() : online ? undefined : was?.last_seen;
      seen.set(who, { online, ...(last ? { last_seen: last } : {}) });
    }
  }

  function onConnection(s: WaSocket, u: ConnectionUpdate): void {
    if (s !== sock || stopped || !lib || !io) return;
    if (u.qr) io.qr?.(u.qr);
    if (u.connection === "open") {
      io.qr?.(undefined);
      // A new connection hears nobody until asked again.
      watching.clear();
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
      void stop().then(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        me = undefined;
        io?.qr?.(undefined);
        io?.status("error", "WhatsApp logged this device out: link it again with the QR");
      });
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
    if (ignorable(jid) || !m.key.id) return;
    // What is dropped unread is logged by its shape (never its words), so a message that never showed can be traced.
    const server = jid.split("@")[1] ?? "";
    if (!content) {
      if (m.messageStubType) log?.warn({ server, stub: m.messageStubType }, "whatsapp message could not be decrypted");
      return;
    }
    const group = jid.endsWith("@g.us");
    if (m.key.fromMe) {
      // Our own send coming back, or someone typing on the linked phone to another chat: neither is for the agent.
      // "Message yourself" is the owner only when the line is the owner's own phone.
      if (ownSends.delete(m.key.id) || !isSelf(jid) || !opts.selfOwner) return;
    }
    const alt = normalJid(m.key.remoteJidAlt);
    // One person, one address: their phone number when WhatsApp tells it, their private id otherwise.
    const who = m.key.fromMe ? me.pn : isPhone(jid) ? jid : alt && isPhone(alt) ? alt : jid;
    const name = m.key.fromMe ? "Owner" : m.verifiedBizName?.trim() || m.pushName?.trim() || `+${digitsOf(who)}`;
    const reacted = content.reactionMessage;
    if (reacted) {
      // Our own reactions come back as ours; only the other side's are news.
      if (!m.key.fromMe && reacted.key?.id)
        io.reaction?.({
          conversation: who,
          sender: { id: who, name: name.slice(0, 80) },
          target: reacted.key.id,
          emoji: reacted.text ?? "",
          private: !group,
        });
      return;
    }
    chats.set(m.key.id, jid);
    if (chats.size > CHATS_KEPT) chats.delete(chats.keys().next().value ?? "");
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
    const media = mediaOf(content);
    let files: Inbound["files"];
    if (media && group) text ||= `[${media.kind}]`;
    else if (media) {
      const got = await fileOf(m, media);
      if (got.file) files = [got.file];
      else text = `${text}\n[attachment could not be downloaded: ${got.failure}]`.trim();
    }
    if (!text && !voice && !files) {
      if (!m.key.fromMe) log?.warn({ server, kinds: Object.keys(content).slice(0, 8) }, "whatsapp message not read");
      return;
    }
    if (!group) {
      const menu = readMenu(content);
      menus.delete(who);
      if (menu?.options.length) menus.set(who, menu);
      if (menus.size > CHATS_KEPT) menus.delete(menus.keys().next().value ?? "");
    }
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
      ref: m.key.id,
      conversation: who,
      sender: { id: who, name: name.slice(0, 80) },
      text,
      private: !group,
      ...(voice ? { voice } : {}),
      ...(files ? { files } : {}),
    });
  }

  /** A message's file, downloaded whole before it is stored (an expired link is asked of the sender's phone again). */
  async function fileOf(
    m: WaMessage,
    media: WaMedia,
  ): Promise<
    { file: { name: string; mime: string; data: string }; failure?: undefined } | { file?: undefined; failure: string }
  > {
    const limit = media.mime.startsWith("image/") ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.channelBytes;
    const over = `${media.name} is over ${Math.round(limit / 1024 / 1024)} MB`;
    if (media.size > limit) return { failure: over };
    const s = sock;
    try {
      const bytes = await lib?.downloadMediaMessage(
        m,
        "buffer",
        {},
        s?.updateMediaMessage ? { logger: quiet(log), reuploadRequest: s.updateMediaMessage } : undefined,
      );
      if (!bytes?.length) return { failure: "WhatsApp sent no file" };
      if (bytes.length > limit) return { failure: over };
      return { file: { name: media.name, mime: media.mime, data: bytes.toString("base64") } };
    } catch (err) {
      log?.warn({ err: errorMessage(err, 200), kind: media.kind }, "whatsapp file not downloaded");
      return { failure: "WhatsApp did not hand over the file" };
    }
  }

  /**
   * The owner's phone sends these messages again (WhatsApp's request for a message a device could not read). Its key
   * names the chat as the message came, which may be the number or the private id: each is tried in turn while some
   * are missing. Nothing comes while the phone is offline.
   */
  async function resent(
    s: WaSocket,
    ask: NonNullable<WaSocket["requestPlaceholderResend"]>,
    conversation: string,
    wanted: Array<{ id: string; fromMe: boolean }>,
  ): Promise<Map<string, WaMessage>> {
    const lid = isPhone(conversation)
      ? normalJid(await s.signalRepository?.lidMapping?.getLIDForPN?.(conversation)?.catch(() => undefined))
      : "";
    const jidsOf = (id: string) => [
      ...new Set([chats.get(id), lid, conversation].filter((j): j is string => Boolean(j))),
    ];
    const got = new Map<string, WaMessage>();
    for (let round = 0; round < 3; round++) {
      const asking = wanted.flatMap((w) => {
        const remoteJid = jidsOf(w.id)[round];
        return !got.has(w.id) && remoteJid ? [{ ...w, remoteJid }] : [];
      });
      if (!asking.length) break;
      await new Promise<void>((resolve) => {
        let left = asking.length;
        const end = () => {
          clearTimeout(limit);
          for (const w of asking) resending.delete(w.id);
          resolve();
        };
        const limit = setTimeout(end, opts.resendWaitMs ?? RESEND_WAIT_MS);
        for (const w of asking) {
          resending.set(w.id, (m) => {
            got.set(w.id, m);
            resending.delete(w.id);
            if (--left === 0) end();
          });
          void ask({ remoteJid: w.remoteJid, id: w.id, fromMe: w.fromMe }).catch((err) =>
            log?.warn({ err: errorMessage(err, 200) }, "whatsapp message not asked again"),
          );
        }
      });
    }
    return got;
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
    f.kind === "file"
      ? { document: f.data, mimetype: f.mime, fileName: fileName(f) }
      : f.kind === "image"
        ? { image: f.data, mimetype: f.mime }
        : f.mime === "audio/ogg"
          ? { audio: f.data, mimetype: "audio/ogg; codecs=opus", ptt: true }
          : { audio: f.data, mimetype: f.mime };

  async function stop(): Promise<void> {
    stopped = true;
    clearTimeout(retry);
    const s = sock;
    sock = undefined;
    me = undefined;
    try {
      s?.end(undefined);
    } catch {}
    // Auth initialization and queued saves must finish before a caller removes the session folder.
    await connecting.catch(() => {});
    await saving.catch(() => {});
  }

  return {
    caps: { typing: true, buttons: false, reactions: true, ownAccount: Boolean(opts.selfOwner) },
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
    stop,
    async forget() {
      stopped = true;
      me = undefined;
      clearTimeout(retry);
      try {
        await sock?.logout();
      } catch {}
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async send(conversation, p: Presentation, files = []) {
      const options = p.buttons?.length ? p.buttons : undefined;
      // Answering a business's menu with one of its options: that button, pressed.
      const menu = menus.get(conversation);
      const picked = menu && !options && !files.length && !p.skip ? optionNamed(menu, p.text) : undefined;
      if (menu && picked) {
        const id = await sendOne(conversation, tapFor(menu, picked));
        menus.delete(conversation);
        return id ? { external_id: id } : {};
      }
      const body = [
        p.text.trim() ? toWhatsApp(p.text) : "",
        options ? options.map((b, i) => `*${i + 1}* — ${b.label}`).join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const texts = (body ? chunks(body, 4000) : []).map((t) => () => sendOne(conversation, { text: t }));
      const media = files.map((f) => () => sendOne(conversation, fileContent(f)));
      // A voice note goes before the words it says.
      const steps: Array<() => Promise<string | undefined>> = p.mediaFirst
        ? [...media, ...texts]
        : [...texts, ...media];
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
    async react(conversation, ref, emoji) {
      if (!sock || !me) throw new SendError("retry", "WhatsApp is not connected");
      const remoteJid = chats.get(ref) ?? conversation;
      const r = await sock.sendMessage(conversation, {
        react: { text: emoji, key: { remoteJid, id: ref, fromMe: false } },
      });
      if (r?.key?.id) ownSends.add(r.key.id);
    },
    async recover(conversation, wanted): Promise<Recovered> {
      const s = sock;
      const ask = s?.requestPlaceholderResend?.bind(s);
      if (!s || !ask || !me) throw new Error("WhatsApp is not connected");
      const got = await resent(s, ask, conversation, wanted);
      const found: Recovered["found"] = [];
      for (const [id, m] of got) {
        const content = unwrap(m.message);
        const media = content ? mediaOf(content) : undefined;
        if (!media) {
          found.push({ id, failure: "WhatsApp sent the message without its file" });
          continue;
        }
        const r = await fileOf(m, media);
        found.push(r.file ? { id, file: r.file } : { id, failure: r.failure });
      }
      return { found };
    },
    presence(ids) {
      const s = sock;
      if (s?.presenceSubscribe && me)
        for (const id of ids)
          if (!watching.has(id)) {
            watching.add(id);
            void s.presenceSubscribe(id).catch(() => watching.delete(id));
          }
      return Object.fromEntries(
        ids.flatMap((id) => {
          const p = seen.get(id);
          return p ? [[id, p]] : [];
        }),
      );
    },
  };
}
