// The WhatsApp socket: pairing, staying up, and getting bytes in and out.
//
// Everything here is about a connection that must survive unattended for weeks.
// The rules that shape it:
//
//   - Baileys is an OPTIONAL dependency. Not installed must mean "this feature
//     is off", never "the daemon won't boot". Every entry point checks.
//   - A dropped connection is normal (phone offline, WhatsApp restarts, laptop
//     sleeps). Reconnect with backoff. The ONE case that must not reconnect is
//     `loggedOut`: the credentials are dead, and retrying with dead credentials
//     in a loop is how an account gets flagged.
//   - The QR is a live secret with a ~20s life. It is held in memory, handed
//     out on request, and dropped the moment the pairing succeeds. It never
//     touches disk or the log.
//   - Credentials live in ~/.apx/whatsapp/<session>/ at 0700. Anyone holding
//     that folder IS the account.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/paths.js";
import { isIgnorableJid } from "#core/identity/whatsapp.js";
import { claimOwnSend } from "./echo.js";

export const SESSION_STATES = Object.freeze({
  OFF: "off",                 // disabled in config, or the library is missing
  CONNECTING: "connecting",
  PAIRING: "pairing",         // a QR is waiting to be scanned
  CONNECTED: "connected",
  LOGGED_OUT: "logged_out",   // needs a fresh pairing, will not retry on its own
});

const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;

/**
 * Are there credentials on disk for this session?
 *
 * This is what decides whether the daemon connects on boot. "Enabled" is the
 * wrong question on a fresh install: nobody has said anything about WhatsApp
 * yet, and opening a socket to produce a QR that nobody asked for is both
 * surprising and a live credential sitting in memory for no reason. Once the
 * owner HAS paired, the opposite is true — the session must come back by itself
 * after every restart, without anyone scanning anything again.
 */
export function hasWhatsAppCredentials(session = "default") {
  try {
    return fs.existsSync(path.join(whatsappAuthDir(session), "creds.json"));
  } catch {
    return false;
  }
}

export function whatsappAuthDir(session = "default") {
  const dir = path.join(APX_HOME, "whatsapp", "auth", session);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Is the optional dependency actually installed? */
export async function loadBaileys() {
  try {
    const mod = await import("@whiskeysockets/baileys");
    return mod.default && mod.makeWASocket ? mod : (mod.default ?? mod);
  } catch {
    return null;
  }
}

// Baileys wants a pino-shaped logger. Its own default is chatty enough to bury
// the daemon log, and the parts worth seeing are surfaced through onStatus
// instead, so this one swallows everything below a warning.
function quietLogger(log) {
  const noop = () => {};
  const self = {
    level: "silent",
    trace: noop, debug: noop, info: noop,
    warn: (...a) => log(`whatsapp[warn] ${flat(a)}`),
    error: (...a) => log(`whatsapp[error] ${flat(a)}`),
    fatal: (...a) => log(`whatsapp[fatal] ${flat(a)}`),
    child: () => self,
  };
  return self;
}
const flat = (args) =>
  args.map((a) => (typeof a === "string" ? a : a?.message || safeJson(a))).join(" ").slice(0, 300);
const safeJson = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

/**
 * Create the session controller. Nothing connects until start().
 *
 * @param {object} opts
 *   session   name of the credential folder (default "default")
 *   onMessage(m)   called per inbound message (already filtered to real ones)
 *   onOwnMessage(m) called per message WhatsApp reports as ours that we did NOT
 *                  send — i.e. the owner typing on their own phone. See echo.js
 *   onStatus(s)    called whenever the state changes
 *   onIdentified(jid) called on every successful connection with the account's
 *                  own JID — see the 515 note below for why it is not
 *                  "after pairing"
 *   log(msg)
 */
export function createWhatsAppSession({
  session = "default",
  onMessage = () => {},
  onOwnMessage = () => {},
  onStatus = () => {},
  onIdentified = () => {},
  onContacts = () => {},
  log = () => {},
} = {}) {
  let sock = null;
  let state = SESSION_STATES.OFF;
  let qr = null;
  let me = null;
  let lastError = null;
  let attempts = 0;
  let retryTimer = null;
  let stopped = true;
  let connectedAt = null;
  // Messages we have ASKED THE PHONE TO SEND AGAIN, by message id.
  //
  // A resend arrives through the ordinary `messages.upsert` door, flagged
  // `notify` like any live message — so without this map the repair that asked
  // for it would re-deliver a week-old message to the owner and, worse, answer
  // it. See recoverMessage().
  const pendingRecoveries = new Map();
  // Everyone currently waiting for a QR (or for the socket to come up without
  // one, which is what happens when the stored credentials are still good).
  let qrWaiters = [];

  const settleQrWaiters = (value) => {
    const waiting = qrWaiters;
    qrWaiters = [];
    for (const resolve of waiting) resolve(value);
  };

  const setState = (next, extra = {}) => {
    state = next;
    if (extra.error !== undefined) lastError = extra.error;
    onStatus(status());
  };

  function status() {
    return {
      state,
      // The QR itself is NOT included — a status poll is not a pairing request,
      // and a live QR in a log or a cached response is a handed-over account.
      qr_waiting: !!qr,
      me,
      connected_at: connectedAt,
      last_error: lastError,
      session,
    };
  }

  /** The live QR string, or null. Read once, deliberately. */
  const currentQr = () => qr;

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    // Exponential with a ceiling: a WhatsApp outage should not become a
    // tight loop against their servers, and a phone that comes back after an
    // hour should still be picked up within the minute.
    const wait = Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, 5), MAX_BACKOFF_MS);
    attempts += 1;
    log(`whatsapp reconnecting in ${Math.round(wait / 1000)}s (attempt ${attempts})`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect().catch((e) => log(`whatsapp reconnect failed: ${e.message}`));
    }, wait);
  }

  async function connect() {
    const baileys = await loadBaileys();
    if (!baileys) {
      setState(SESSION_STATES.OFF, { error: "@whiskeysockets/baileys is not installed" });
      return;
    }
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

    const authDir = whatsappAuthDir(session);
    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

    // Pinning an old protocol version is a reliable way to get disconnected;
    // ask WhatsApp what it speaks today, and carry on with the bundled default
    // if that lookup fails (offline boot must still try).
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined;
    }

    setState(SESSION_STATES.CONNECTING);
    sock = makeWASocket({
      auth: authState,
      version,
      browser: Browsers?.macOS?.("APX") || undefined,
      logger: quietLogger(log),
      // The account's own phone is the source of truth for read receipts and
      // presence. Announcing ourselves online would silence the phone's own
      // notifications, which is the opposite of what a relay wants.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (u) => {
      if (u.qr) {
        qr = u.qr;
        setState(SESSION_STATES.PAIRING);
        log("whatsapp: QR ready — scan it from Settings → WhatsApp");
        settleQrWaiters(qr);
      }
      if (u.connection === "open") {
        qr = null;                       // dropped the instant it is spent
        attempts = 0;
        connectedAt = new Date().toISOString();
        me = sock?.user?.id || null;
        setState(SESSION_STATES.CONNECTED, { error: null });
        log(`whatsapp connected as ${me}`);
        settleQrWaiters(null);   // came up on stored credentials; nothing to scan

        // Announced on EVERY successful connection, not just the one that
        // followed a QR.
        //
        // A fresh pairing does not end with the socket opening. WhatsApp ends
        // it with `stream:error 515` — restart-required — and the credentials
        // only come up on the RECONNECT that follows. So the connection that
        // actually succeeds is never the one that was in `pairing` state, and
        // gating this on "were we pairing?" meant the owner was never recorded
        // at all. Observed live on 2026-09-08: QR at 20:26:39, 515 at 20:26:51,
        // connected at 20:26:56, owner_jid still null.
        //
        // The right rule was never about timing: the owner is whoever these
        // CREDENTIALS belong to. The listener only records when there is no
        // owner yet, so repeating this on every reconnect is a no-op.
        if (me) onIdentified(me);
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut;
        connectedAt = null;
        if (loggedOut) {
          // Dead credentials. Retrying them in a loop is exactly the behaviour
          // that gets an account flagged, so we stop and wait for a human.
          me = null;
          setState(SESSION_STATES.LOGGED_OUT, { error: "logged out — pair again" });
          log("whatsapp: logged out. Credentials are dead; pair again to reconnect.");
          return;
        }
        setState(SESSION_STATES.CONNECTING, {
          error: u.lastDisconnect?.error?.message || `closed (${code ?? "?"})`,
        });
        scheduleReconnect();
      }
    });

    // Who these people ARE, as WhatsApp knows them.
    //
    // The address book the owner has on their phone, and the registered name of
    // any verified business that writes — pushed by WhatsApp on connect and
    // whenever one changes. Nothing listened to them, so a company that sends
    // no `pushName` (all of them do not) stayed on the roster as an address
    // with a photo. Names only ever FILL an empty field; see learnWhatsAppNames.
    for (const ev of ["contacts.upsert", "contacts.update"]) {
      sock.ev.on(ev, (rows) => {
        try { onContacts(rows || []); } catch (e) { log(`whatsapp: contact update failed: ${e.message}`); }
      });
    }

    sock.ev.on("messages.upsert", async (up) => {
      // "append" is history backfill — messages we have already lived through.
      // Answering those on reconnect would replay days of conversation at
      // whoever is on the other end.
      if (up.type !== "notify") return;
      for (const m of up.messages || []) {
        try {
          // A message we asked for again (repair.js). It is old news by
          // definition: hand it to whoever is waiting and stop — dispatching it
          // would report a past message as if it had just arrived, and answer
          // it a second time.
          const waiter = m.key?.id ? pendingRecoveries.get(m.key.id) : null;
          if (waiter) {
            pendingRecoveries.delete(m.key.id);
            waiter(m);
            continue;
          }
          if (!m.message) continue;          // receipts, reactions, protocol noise
          if (isIgnorableJid(m.key?.remoteJid)) continue;  // status stories, Channels, service numbers
          // `fromMe` is two different events wearing one flag: the echo of a
          // message WE just sent (already in the ledger — outbox wrote it) and
          // a message the OWNER typed on their own phone, mirrored to us
          // because WhatsApp Web is a companion device. Dropping both, which
          // is what this used to do, meant the owner's own half of every
          // conversation was missing from their own record. See echo.js.
          if (m.key?.fromMe) {
            if (!claimOwnSend(m.key?.id)) await onOwnMessage(m);
            continue;
          }
          await onMessage(m);
        } catch (e) {
          log(`whatsapp inbound handler failed: ${e.message}`);
        }
      }
    });
  }

  return {
    status,
    currentQr,

    async start() {
      stopped = false;
      await connect();
    },

    stop() {
      stopped = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      try { sock?.end?.(undefined); } catch { /* already gone */ }
      sock = null;
      qr = null;
      setState(SESSION_STATES.OFF);
    },

    /** Drop the credentials and come back with a fresh QR. */
    async logout() {
      try { await sock?.logout?.(); } catch { /* the socket may already be dead */ }
      try { sock?.end?.(undefined); } catch { /* idem */ }
      sock = null;
      me = null;
      qr = null;
      try {
        fs.rmSync(whatsappAuthDir(session), { recursive: true, force: true });
      } catch (e) {
        log(`whatsapp: could not clear credentials: ${e.message}`);
      }
      setState(SESSION_STATES.OFF, { error: null });
    },

    /**
     * Force a fresh pairing attempt and WAIT for the code.
     *
     * connect() returns as soon as the socket object exists; the QR arrives a
     * second or two later on `connection.update`. Returning at connect() meant
     * the panel got `qr: null` every time and the button looked dead — so the
     * wait belongs here, where the event actually is, rather than in a caller
     * polling and guessing how long to poll for.
     *
     * Bounded, because "no QR is coming" is a real outcome (no network, a
     * session that is already connected) and hanging the request is not an
     * answer. Resolves early with null when the socket comes up on stored
     * credentials — there is nothing to scan in that case.
     */
    async pair({ waitMs = 20_000 } = {}) {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      attempts = 0;
      stopped = false;
      if (qr) return { status: status(), qr };
      const waited = new Promise((resolve) => {
        qrWaiters.push(resolve);
        setTimeout(() => resolve(qr), waitMs).unref?.();
      });
      await connect();
      const code = await waited;
      return { status: status(), qr: code || qr };
    },

    async sendText(jid, text) {
      if (!sock) throw new Error("whatsapp is not connected");
      const body = String(text ?? "").trim();
      if (!body) throw new Error("refusing to send an empty message");
      return sock.sendMessage(jid, { text: body });
    },

    /**
     * Send a sticker back.
     *
     * WhatsApp stickers are WebP and go on their own field — sent as an image
     * they arrive as a picture in a bubble, which is not the same gesture at
     * all. Baileys reads the file itself, so the path is enough.
     */
    async sendSticker(jid, filePath) {
      if (!sock) throw new Error("whatsapp is not connected");
      if (!filePath || !fs.existsSync(filePath)) throw new Error("sendSticker: no such sticker file");
      return sock.sendMessage(jid, { sticker: { url: filePath } });
    },

    /**
     * Tap a button somebody offered.
     *
     * Three of WhatsApp's four menu generations have a real reply proto, and
     * Baileys builds all three — a `buttonsResponseMessage` for quick-reply
     * buttons, a `templateButtonReplyMessage` for a hydrated template, a
     * `listResponseMessage` for a list. Sending the right one is what makes the
     * bot on the other side see a TAP rather than a person typing, which for a
     * menu-driven flow is frequently the difference between advancing and being
     * asked the same question again.
     *
     * The fourth generation — nativeFlow's `interactiveResponseMessage` — has
     * no builder here, so it is not attempted: the caller answers those in
     * words instead (see replyModeFor in ./interactive.js). Guessing a proto
     * Baileys cannot encode would send a malformed node to somebody's server.
     */
    async sendButtonReply(jid, { id, title, index = 0, kind = "buttons" } = {}) {
      if (!sock) throw new Error("whatsapp is not connected");
      const displayText = String(title ?? "").trim();
      const rowId = String(id ?? "").trim() || displayText;
      if (!displayText && !rowId) throw new Error("sendButtonReply: the option needs an id or a title");
      if (kind === "list") {
        return sock.sendMessage(jid, {
          listReply: {
            title: displayText,
            // 1 = SINGLE_SELECT. A list reply with no listType is read as
            // UNKNOWN by the receiving client and quietly ignored.
            listType: 1,
            singleSelectReply: { selectedRowId: rowId },
          },
        });
      }
      return sock.sendMessage(jid, {
        buttonReply: { displayText, id: rowId, index: Number(index) || 0 },
        type: kind === "template" ? "template" : "plain",
      });
    },

    /**
     * React to a message with a single emoji.
     *
     * Cheaper than a reply and often the honest one: a "gracias!" deserves a 👍,
     * not a sentence. Passing an empty string REMOVES a reaction, which is the
     * same call — WhatsApp models "unreact" as reacting with nothing.
     *
     * `key` is the key of the message being reacted to, exactly as it arrived.
     */
    async sendReaction(jid, key, emoji) {
      if (!sock) throw new Error("whatsapp is not connected");
      if (!key?.id) throw new Error("sendReaction: the target message key is required");
      return sock.sendMessage(jid, { react: { text: String(emoji ?? ""), key } });
    },

    /** Mark a chat read, so the sender stops seeing an unanswered blue tick. */
    async markRead(key) {
      try { await sock?.readMessages?.([key]); } catch { /* best effort */ }
    },

    async setTyping(jid, on = true) {
      try { await sock?.sendPresenceUpdate?.(on ? "composing" : "paused", jid); } catch { /* best effort */ }
    },

    /**
     * That person's WhatsApp profile picture, as a URL.
     *
     * Returns null freely: not everyone has one, and privacy settings hide it
     * from people who are not in their contacts. A face is a nicety, so every
     * failure here is a shrug rather than an error — the caller falls back to
     * initials.
     */
    async profilePicture(jid) {
      try {
        return (await sock?.profilePictureUrl?.(jid, "image")) || null;
      } catch {
        return null;
      }
    },

    /**
     * Ask the phone to send ONE message again, by its key.
     *
     * WhatsApp keeps a message on the sender's phone long after we have taken
     * delivery of it, and the protocol has a way to ask for it back: a peer
     * data operation of type PLACEHOLDER_MESSAGE_RESEND, which Baileys exposes
     * as `requestPlaceholderResend`. It exists for messages that failed to
     * decrypt; a message that decrypted fine and was then MISREAD by a decoder
     * that did not know the shape is the same hole from the ledger's side, and
     * this is how it gets filled — see repair.js, and the button menus that
     * were written down as "[empty message]" on 2026-09-10.
     *
     * Two things the caller must know:
     *   - the phone has to be reachable. It is the source, not WhatsApp's
     *     servers, so a phone that is off means null and no error.
     *   - the answer comes back through the ordinary inbound door, which is why
     *     `pendingRecoveries` exists: the socket hands it here instead of
     *     treating a week-old message as news.
     *
     * Resolves with the Baileys message, or null on a timeout.
     */
    async recoverMessage(key, { timeoutMs = 20_000 } = {}) {
      if (!sock) throw new Error("whatsapp is not connected");
      const id = key?.id;
      if (!id) throw new Error("recoverMessage: the message key is required");
      if (pendingRecoveries.has(id)) return null;   // already asked; one waiter per id

      return new Promise((resolve) => {
        let timer = null;
        const settle = (m) => {
          if (timer) { clearTimeout(timer); timer = null; }
          pendingRecoveries.delete(id);
          resolve(m || null);
        };
        pendingRecoveries.set(id, settle);
        timer = setTimeout(() => settle(null), timeoutMs);
        // Baileys waits 2s of its own before sending the request (a message
        // that arrives meanwhile makes it unnecessary), so a rejection here is
        // the request never leaving — not the phone declining.
        Promise.resolve()
          .then(() => sock.requestPlaceholderResend(key))
          .catch((e) => {
            log(`whatsapp: could not ask for ${id} again: ${e.message}`);
            settle(null);
          });
      });
    },

    /** Pull the bytes of one media node to a local file. */
    async download(message, kind, { fileName = "" } = {}) {
      const baileys = await loadBaileys();
      if (!baileys) throw new Error("baileys is not installed");
      const { downloadMediaMessage } = baileys;
      const buf = await downloadMediaMessage(
        message,
        "buffer",
        {},
        { logger: quietLogger(log), reuploadRequest: sock?.updateMediaMessage }
      );
      const dir = path.join(APX_HOME, "media");
      fs.mkdirSync(dir, { recursive: true });
      // A document keeps ITS OWN name (already sanitised by the caller — see
      // documents.js `safeFileName`), prefixed to stay unique. The extension is
      // not cosmetic: it is what makes the panel offer the right thing and what
      // a text extractor keys off, and the default for a document was a
      // nameless `.bin`.
      const stamp = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const file = path.join(dir, fileName ? `${stamp}-${fileName}` : `${stamp}${extFor(kind)}`);
      fs.writeFileSync(file, buf);
      return file;
    },
  };
}

function extFor(kind) {
  if (kind === "image") return ".jpg";
  if (kind === "audio") return ".ogg";
  if (kind === "sticker") return ".webp";
  if (kind === "gif" || kind === "video") return ".mp4";
  return ".bin";
}
