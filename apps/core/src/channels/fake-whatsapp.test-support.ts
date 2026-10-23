// A WhatsApp account in memory, with the library's shape (see WaLib): a QR until it is "scanned", the restart WhatsApp
// asks for after a scan, people writing, the owner typing on their phone, the echo of every send, a logout, and the
// phone's copy of each message (sent again on request while the phone is online).
import fs from "node:fs";
import path from "node:path";
import type { WaContent, WaKey, WaLib, WaMessage, WaSocket } from "./whatsapp.ts";

const OWNER_PN = "5491100000001@s.whatsapp.net";
const OWNER_LID = "100000000000001@lid";
const REASON = { loggedOut: 401, restartRequired: 515, timedOut: 408 };
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
  const sent: Array<{ id: string; jid: string; content: Record<string, unknown> }> = [];
  /** Who this device asked to hear coming online. */
  const watched = new Set<string>();
  const loggedOut = { value: false };
  /** What the owner's phone keeps of every chat, in order; it sends a message again only while online. */
  const phone = { online: true, history: [] as WaMessage[] };
  const resendAsked: WaKey[] = [];
  /** Private ids WhatsApp told this device, by phone address. */
  const lids = new Map<string, string>();
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
      async sendMessage(jid: string, content: Record<string, unknown>) {
        const id = `OUT-${++seq}`;
        sent.push({ id, jid, content });
        // Every send comes back as an echo, as on a linked device.
        setTimeout(() => s.emit("messages.upsert", { type: "notify", messages: [echo(id, jid, content)] }), 5);
        return { key: { id } };
      },
      async sendPresenceUpdate() {},
      signalRepository: { lidMapping: { getLIDForPN: async (pn: string) => lids.get(pn) } },
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
    sock.user = { id: owner.replace("@", ":7@"), lid: OWNER_LID };
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
    /** Someone writes; `lid` makes it arrive under their private id with the phone as the alternative. */
    message(from: Person, text: string, opts: { group?: string; voice?: Buffer; content?: object } = {}) {
      const jid = opts.group ?? (from.lid ? from.lid : from.phone);
      if (from.lid) lids.set(from.phone, from.lid);
      const id = `IN-${++seq}`;
      deliver({
        key: { id, remoteJid: jid, ...(from.lid && !opts.group ? { remoteJidAlt: from.phone } : {}), fromMe: false },
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
    /** The owner writes in "Message yourself" (under their private id, as a linked phone often sends it). */
    fromOwner(text: string) {
      deliver({ key: { id: `ME-${++seq}`, remoteJid: OWNER_LID, fromMe: true }, message: { conversation: text } });
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
    textsTo: (jid: string) => sent.filter((s) => s.jid === jid).map((s) => String(s.content.text ?? "")),
    loggedOut,
  };
}
