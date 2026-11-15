// A WhatsApp account in memory, with the library's shape (see WaLib): a QR until it is "scanned", the restart WhatsApp
// asks for after a scan, people writing, the owner typing on their phone, the echo of every send, a logout, and the
// phone's copy of each message (sent again on request while the phone is online), and the groups the account is in.
import fs from "node:fs";
import path from "node:path";
import type { WaGroup, WaLib, WaMessage, WaSocket } from "./whatsapp.ts";
import type { WaContent, WaKey } from "./whatsapp-content.ts";

const OWNER_PN = "5491100000001@s.whatsapp.net";
const OWNER_LID = "100000000000001@lid";
const REASON = { loggedOut: 401, restartRequired: 515, timedOut: 408, connectionClosed: 428 };
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export type Person = { phone: string; name: string; lid?: string };

export function fakeWhatsApp(owner = OWNER_PN) {
  let dir = "";
  /** The platform the device presents itself as (the second field of `browser`). */
  let platform = "";
  let sock: (WaSocket & { emit(event: string, arg: unknown): void }) | undefined;
  let seq = 0;
  let qrs = 0;
  let sockets = 0;
  const sent: Array<{ id: string; jid: string; content: Record<string, unknown>; quoted?: string }> = [];
  /** The groups the account is in, by address. */
  const groups = new Map<string, WaGroup>();
  /** Who this device asked to hear coming online. */
  const watched = new Set<string>();
  const loggedOut = { value: false };
  /** What the owner's phone keeps of every chat, in order; it sends a message again only while online. */
  const phone = { online: true, history: [] as WaMessage[] };
  const resendAsked: WaKey[] = [];
  /** Private ids WhatsApp told this device, by phone address. */
  const lids = new Map<string, string>();
  /** The device's id store stopped answering: a lookup never ends. */
  let stalled = false;
  let closeNext = false;
  const never = () => new Promise<undefined>(() => {});
  /** Numbers nobody has WhatsApp on (anyone else has it); and every number this device asked about. */
  const absent = new Set<string>();
  const checked: string[] = [];
  const creds = () => path.join(dir, "creds.json");

  const makeSocket = (): WaSocket & { emit(event: string, arg: unknown): void } => {
    const listeners = new Map<string, Array<(arg: unknown) => void>>();
    const s = {
      ev: {
        on(event: string, fn: (arg: never) => void) {
          listeners.set(event, [...(listeners.get(event) ?? []), fn as (arg: unknown) => void]);
        },
      },
      user: undefined as WaSocket["user"],
      emit(event: string, arg: unknown) {
        for (const fn of listeners.get(event) ?? []) fn(arg);
      },
      async sendMessage(jid: string, content: Record<string, unknown>, opts?: { quoted?: WaMessage }) {
        if (closeNext) {
          closeNext = false;
          throw Object.assign(new Error("Connection Closed"), { output: { statusCode: REASON.connectionClosed } });
        }
        const id = `OUT-${++seq}`;
        const quoted = opts?.quoted?.key.id;
        sent.push({ id, jid, content, ...(quoted ? { quoted } : {}) });
        // Every send comes back as an echo, as on a linked device.
        setTimeout(() => s.emit("messages.upsert", { type: "notify", messages: [echo(id, jid, content)] }), 5);
        return { key: { id } };
      },
      async sendPresenceUpdate() {},
      async groupFetchAllParticipating() {
        return Object.fromEntries(groups);
      },
      async onWhatsApp(...numbers: string[]) {
        checked.push(...numbers);
        const digits = numbers.map((n) => n.split("@")[0] ?? "");
        return digits.filter((d) => !absent.has(d)).map((d) => ({ jid: `${d}@s.whatsapp.net`, exists: true }));
      },
      signalRepository: {
        lidMapping: {
          getLIDForPN: (pn: string) => (stalled ? never() : Promise.resolve(lids.get(pn))),
          getPNForLID: (lid: string) =>
            stalled ? never() : Promise.resolve([...lids].find(([, l]) => l === lid)?.[0]),
        },
      },
      // The phone sends one message again, found by its id under the address it came on.
      async requestPlaceholderResend(key: WaKey) {
        resendAsked.push(key);
        const m = phone.history.find((x) => x.key.id === key.id && x.key.remoteJid === key.remoteJid);
        if (phone.online && m) setTimeout(() => s.emit("messages.upsert", { type: "notify", messages: [m] }), 5);
        return `PDO-${++seq}`;
      },
      async presenceSubscribe(jid: string) {
        watched.add(jid);
      },
      // Only the line itself shows a picture here: a 1×1 PNG.
      async profilePictureUrl(jid: string) {
        return jid === owner ? `data:image/png;base64,${PIXEL}` : undefined;
      },
      async logout() {
        loggedOut.value = true;
      },
      end() {
        listeners.clear();
      },
    };
    return s;
  };
  const echo = (id: string, jid: string, content: Record<string, unknown>): WaMessage => ({
    key: { id, remoteJid: jid, fromMe: true },
    message: { conversation: typeof content.text === "string" ? content.text : undefined },
  });
  const open = () => {
    if (!sock) return;
    sock.user = { id: owner.replace("@", ":7@"), lid: OWNER_LID, name: "Acme line" };
    sock.emit("connection.update", { connection: "open" });
  };
  const deliver = (m: WaMessage) => {
    phone.history.push(m);
    sock?.emit("messages.upsert", { type: "notify", messages: [m] });
  };

  const lib: WaLib = {
    makeWASocket(opts) {
      platform = String((opts.browser as string[] | undefined)?.[1] ?? "");
      sockets++;
      sock = makeSocket();
      setTimeout(() => (fs.existsSync(creds()) ? open() : sock?.emit("connection.update", { qr: `QR-${++qrs}` })), 5);
      return sock;
    },
    async useMultiFileAuthState(d) {
      dir = d;
      // Writing the credentials takes a moment, as on a real disk: a reconnect that does not wait finds none.
      const saveCreds = () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(creds(), "{}");
            resolve();
          }, 30),
        );
      return { state: {}, saveCreds };
    },
    async downloadMediaMessage(m) {
      return Buffer.from((m.message as WaContent & { bytes?: string })?.bytes ?? "", "base64");
    },
    async fetchLatestBaileysVersion() {
      return { version: [2, 3000, 0] };
    },
    DisconnectReason: REASON,
  };

  return {
    lib,
    owner,
    get dir() {
      return dir;
    },
    /** How many times the channel connected (a restart connects again). */
    get sockets() {
      return sockets;
    },
    /**
     * The owner scans the QR: the new credentials are handed over to be saved and WhatsApp at once asks for the restart
     * that comes up linked. A device that presents itself as the native desktop app is refused, as the phone does.
     */
    scan() {
      if (/^desktop$/i.test(platform)) {
        sock?.emit("connection.update", {
          connection: "close",
          lastDisconnect: { error: { message: "pairing refused", output: { statusCode: REASON.loggedOut } } },
        });
        return;
      }
      sock?.emit("creds.update", {});
      sock?.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { message: "restart required", output: { statusCode: REASON.restartRequired } } },
      });
    },
    /** The connection drops as the next message is about to go: Baileys throws before writing it. */
    closeOnNextSend() {
      closeNext = true;
    },
    /** The QR expires with nobody scanning it. */
    expire() {
      sock?.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { message: "QR refs attempts ended", output: { statusCode: REASON.timedOut } } },
      });
    },
    /** The phone unlinks this device. */
    logOut() {
      sock?.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { message: "logged out", output: { statusCode: REASON.loggedOut } } },
      });
    },
    /**
     * Someone writes; `lid` makes it arrive under their private id with the phone as the alternative, or without it
     * (`noAlt`, as WhatsApp often sends a reply), leaving only what this device learned to tell who it is.
     */
    message(
      from: Person,
      text: string,
      opts: { group?: string; voice?: Buffer; content?: object; noAlt?: boolean } = {},
    ) {
      const jid = opts.group ?? (from.lid ? from.lid : from.phone);
      if (from.lid) lids.set(from.phone, from.lid);
      const id = `IN-${++seq}`;
      const alt = from.lid && !opts.group && !opts.noAlt;
      // In a group the chat is the group's and the writer is the participant (their private id, the phone beside it).
      const author = opts.group
        ? {
            participant: from.lid ?? from.phone,
            ...(from.lid && !opts.noAlt ? { participantAlt: from.phone } : {}),
          }
        : {};
      deliver({
        key: { id, remoteJid: jid, ...(alt ? { remoteJidAlt: from.phone } : {}), ...author, fromMe: false },
        pushName: from.name,
        message: opts.voice
          ? ({
              audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" },
              bytes: opts.voice.toString("base64"),
            } as WaContent)
          : ((opts.content as WaContent | undefined) ?? { conversation: text }),
      });
      return id;
    },
    /** This device learns which private id stands for someone's number (as sending to them first does). */
    knows(from: Person) {
      if (from.lid) lids.set(from.phone, from.lid);
    },
    /** From now on, asking which number a private id stands for (or the other way) never gets an answer. */
    stallLookups() {
      stalled = true;
    },
    /** The owner writes in "Message yourself" (under their private id, as a linked phone often sends it). */
    fromOwner(text: string) {
      deliver({ key: { id: `ME-${++seq}`, remoteJid: OWNER_LID, fromMe: true }, message: { conversation: text } });
    },
    /** The account is added to a group (`admins`: who of its people may write when only admins can). */
    joinGroup(id: string, subject: string, o: { announce?: boolean; admin?: boolean; community?: boolean } = {}) {
      groups.set(id, {
        id,
        subject,
        announce: o.announce ?? false,
        isCommunity: o.community ?? false,
        participants: [{ id: owner, admin: o.admin ? "admin" : null }],
      });
    },
    /**
     * Someone writes in a group: `mention` @mentions the line (as WhatsApp writes it, "@<its number>"), `replyTo`
     * answers one of the line's messages.
     */
    inGroup(from: Person, group: string, text: string, o: { mention?: boolean; replyTo?: string } = {}) {
      const digits = owner.split("@")[0] ?? "";
      const words = o.mention ? `@${digits} ${text}` : text;
      const contextInfo = {
        ...(o.mention ? { mentionedJid: [owner] } : {}),
        ...(o.replyTo ? { stanzaId: o.replyTo, participant: owner } : {}),
      };
      return this.message(from, words, {
        group,
        content:
          o.mention || o.replyTo ? { extendedTextMessage: { text: words, contextInfo } } : { conversation: words },
      });
    },
    /** The owner types in a group on their phone. */
    ownerInGroup(group: string, text: string) {
      const id = `ME-${++seq}`;
      deliver({ key: { id, remoteJid: group, participant: owner, fromMe: true }, message: { conversation: text } });
      return id;
    },
    /** The owner types to someone else on their phone. */
    ownerTo(to: Person, text: string) {
      deliver({ key: { id: `ME-${++seq}`, remoteJid: to.phone, fromMe: true }, message: { conversation: text } });
    },
    /** Someone puts an emoji on a message (empty: takes theirs off). */
    react(from: Person, id: string, emoji: string) {
      deliver({
        key: { id: `IN-${++seq}`, remoteJid: from.phone, fromMe: false },
        pushName: from.name,
        message: { reactionMessage: { key: { id, remoteJid: from.phone, fromMe: true }, text: emoji } },
      });
    },
    /** Their phone tells how far one of our sends got: 3 on their device, 4 read. */
    receipt(id: string, status: number) {
      const to = sent.find((x) => x.id === id)?.jid;
      sock?.emit("messages.update", [{ key: { id, remoteJid: to, fromMe: true }, update: { status } }]);
    },
    /** Someone comes online or leaves (`last` in seconds), as WhatsApp tells a device that asked. */
    presence(jid: string, type: "available" | "unavailable", last?: number) {
      sock?.emit("presence.update", {
        id: jid,
        presences: { [jid]: { lastKnownPresence: type, ...(last ? { lastSeen: last } : {}) } },
      });
    },
    watched,
    sent,
    phone,
    resendAsked,
    /** The phone holds a message's real content (APX had kept only a placeholder for it). */
    phoneKeeps(id: string, content: object) {
      const m = phone.history.find((x) => x.key.id === id);
      if (m) m.message = content as WaContent;
    },
    /** Numbers (digits) nobody is on WhatsApp with. */
    absent,
    checked,
    textsTo: (jid: string) => sent.filter((s) => s.jid === jid).map((s) => String(s.content.text ?? "")),
    loggedOut,
  };
}
