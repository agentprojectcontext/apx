// A WhatsApp account in memory, with the library's shape (see WaLib): a QR until it is "scanned", the restart WhatsApp
// asks for after a scan, people writing, the owner typing on their phone, the echo of every send, and a logout.
import fs from "node:fs";
import path from "node:path";
import type { WaContent, WaLib, WaMessage, WaSocket } from "./whatsapp.ts";

const OWNER_PN = "5491100000001@s.whatsapp.net";
const OWNER_LID = "100000000000001@lid";
const REASON = { loggedOut: 401, restartRequired: 515, timedOut: 408 };

export type Person = { phone: string; name: string; lid?: string };

export function fakeWhatsApp() {
  let dir = "";
  let sock: (WaSocket & { emit(event: string, arg: unknown): void }) | undefined;
  let seq = 0;
  let qrs = 0;
  const sent: Array<{ jid: string; content: Record<string, unknown> }> = [];
  const loggedOut = { value: false };
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
        sent.push({ jid, content });
        // Every send comes back as an echo, as on a linked device.
        setTimeout(() => s.emit("messages.upsert", { type: "notify", messages: [echo(id, jid, content)] }), 5);
        return { key: { id } };
      },
      async sendPresenceUpdate() {},
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
    sock.user = { id: OWNER_PN.replace("@", ":7@"), lid: OWNER_LID };
    sock.emit("connection.update", { connection: "open" });
  };
  const deliver = (m: WaMessage) => sock?.emit("messages.upsert", { type: "notify", messages: [m] });

  const lib: WaLib = {
    makeWASocket() {
      sock = makeSocket();
      setTimeout(() => (fs.existsSync(creds()) ? open() : sock?.emit("connection.update", { qr: `QR-${++qrs}` })), 5);
      return sock;
    },
    async useMultiFileAuthState(d) {
      dir = d;
      return { state: {}, saveCreds: () => {} };
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
    owner: OWNER_PN,
    get dir() {
      return dir;
    },
    /** The owner scans the QR: credentials are written and WhatsApp asks for the restart that comes up linked. */
    scan() {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(creds(), "{}");
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
    message(from: Person, text: string, opts: { group?: string; voice?: Buffer } = {}) {
      const jid = opts.group ?? (from.lid ? from.lid : from.phone);
      const id = `IN-${++seq}`;
      deliver({
        key: { id, remoteJid: jid, ...(from.lid && !opts.group ? { remoteJidAlt: from.phone } : {}), fromMe: false },
        pushName: from.name,
        message: opts.voice
          ? ({
              audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" },
              bytes: opts.voice.toString("base64"),
            } as WaContent)
          : { conversation: text },
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
    sent,
    textsTo: (jid: string) => sent.filter((s) => s.jid === jid).map((s) => String(s.content.text ?? "")),
    loggedOut,
  };
}
