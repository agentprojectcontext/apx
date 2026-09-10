// WhatsApp plugin: owns the socket's lifecycle inside the daemon.
//
// Thin on purpose, like the Telegram poller next door. Everything about what a
// message MEANS lives in core/channels/whatsapp/; this file keeps only what the
// running process needs — start/stop, the session handle, and the one thing
// core cannot do for itself: reaching a sibling plugin to tell the owner.
//
// The reporting path is worth stating plainly. A WhatsApp turn for a non-owner
// has no tools, by construction, so it CANNOT message the owner. That is not a
// gap being worked around here — it is the reason this function exists. The
// report is emitted by the daemon, from code, after the turn, so it happens
// whether or not the model thought of it.
import { createWhatsAppSession, SESSION_STATES, hasWhatsAppCredentials } from "#core/channels/whatsapp/session.js";
import { handleWhatsAppMessage, handleOwnWhatsAppMessage } from "#core/channels/whatsapp/dispatch.js";
import { readWhatsAppConfig, patchWhatsAppConfig } from "#core/channels/whatsapp/config.js";
import { learnWhatsAppNames, normalizeJid } from "#core/identity/whatsapp.js";
import { sendWhatsApp, chooseWhatsAppOption } from "#core/channels/whatsapp/outbox.js";
import { inspectWhatsAppChats, repairWhatsAppChats } from "#core/channels/whatsapp/repair.js";

export default {
  id: "whatsapp",

  init({ projects, config, log, plugins, registries }) {
    let session = null;
    let lastStatus = { state: SESSION_STATES.OFF };

    // Tell the owner something happened on WhatsApp. Telegram is where they
    // actually are; if it is not configured we still leave it in the log rather
    // than dropping it silently.
    async function notifyOwner(text, meta = {}) {
      const telegram = plugins?.get?.("telegram");
      if (typeof telegram?.send !== "function") {
        log(`whatsapp → owner (telegram unavailable): ${text}`);
        return;
      }
      try {
        // Plain `send`, not the nudge path. This report is REACTIVE — somebody
        // wrote to the owner and the owner is being told — so it must not spend
        // the interruption budget or be suppressed by it. That is the same rule
        // the Telegram side already applies to a send from another channel to
        // the default chat.
        await telegram.send({ text, meta: { kind: meta.kind || "whatsapp", ...meta } });
      } catch (e) {
        log(`whatsapp → owner failed: ${e.message}`);
      }
    }

    function ensureSession() {
      if (session) return session;
      session = createWhatsAppSession({
        log,
        onStatus: (s) => { lastStatus = s; },
        // Record WHICH LINE this is — not who owns it.
        //
        // Those are different things, and conflating them was a real bug. This
        // deployment pairs a DEDICATED number that the assistant answers on,
        // and the human writes to it from their own, different phone. Setting
        // "owner = whoever paired" made the line the owner of itself and left
        // the actual human a stranger on it.
        //
        // The simple topology — pair your own phone — is not a counterexample:
        // there you never message yourself, so the owner turn arrives through
        // Telegram or the web instead. Either way the software cannot deduce
        // which human is behind a line, so `owner_jid` is asked for, in the
        // panel, and never guessed here.
        onIdentified: (jid) => {
          try {
            const before = readWhatsAppConfig().self_jid;
            if (normalizeJid(before) === normalizeJid(jid)) return;
            patchWhatsAppConfig({ self_jid: jid });
            log(`whatsapp: this line is ${jid}`);
          } catch (e) {
            log(`whatsapp: could not record the line: ${e.message}`);
          }
        },
        // Names from the account itself: the owner's address book and any
        // verified business that writes. Best-effort and quiet — a name is a
        // nicety, and a failure here must never touch the message path.
        onContacts: (rows) => {
          const learned = learnWhatsAppNames(config, rows);
          if (learned) log(`whatsapp: learned ${learned} name${learned === 1 ? "" : "s"} from the account`);
        },
        // The owner writing from their own phone. Logged, never answered.
        onOwnMessage: (m) =>
          handleOwnWhatsAppMessage(m, { session, globalConfig: config, log }),
        onMessage: (m) =>
          handleWhatsAppMessage(m, {
            session,
            globalConfig: config,
            projects,
            plugins,
            registries,
            log,
            notifyOwner,
          }),
      });
      return session;
    }

    return {
      async start() {
        const wa = readWhatsAppConfig(config);
        if (wa.enabled === false) {
          log("whatsapp: disabled in config — not starting");
          return;
        }
        // Paired → always come back. Never paired → stay quiet until somebody
        // asks for a QR from the panel. A daemon that opens a socket on a
        // machine whose owner has never mentioned WhatsApp is doing something
        // they did not ask for.
        if (!hasWhatsAppCredentials()) {
          log("whatsapp: no session paired yet — idle until you link a phone from Settings → WhatsApp");
          return;
        }
        await ensureSession().start();
      },

      stop() {
        try { session?.stop(); } catch { /* already down */ }
      },

      status() {
        const wa = readWhatsAppConfig();
        return {
          running: !!session,
          enabled: wa.enabled,
          auto_reply: wa.auto_reply,
          reply_to_groups: wa.reply_to_groups,
          owner_jid: wa.owner_jid || null,
          owner_alts: wa.owner_alts || [],
          self_jid: wa.self_jid || null,
          self_is_owner: wa.self_is_owner === true,
          contacts: wa.contacts.length,
          ...lastStatus,
        };
      },

      // ---- used by the API layer -------------------------------------
      /** Start (or restart) a pairing attempt and return the live QR string. */
      async pair() {
        const s = ensureSession();
        // session.pair() resolves once the code is actually in hand (or the
        // wait times out), so the HTTP response carries a QR the panel can
        // render instead of a null the user reads as a broken button.
        const { status, qr } = await s.pair();
        return { status, qr: qr || s.currentQr() };
      },
      /** The live QR, or null when there is nothing to scan. */
      qr() {
        return session?.currentQr?.() || null;
      },
      async logout() {
        await session?.logout?.();
        return session?.status?.() || { state: SESSION_STATES.OFF };
      },
      // Sending goes through core's outbox, which sends AND records in one
      // call. Both adapters above this — the `send_whatsapp` tool and
      // POST /api/whatsapp/send — used to reach `session.sendText` directly and
      // so wrote nothing to the ledger; a message somebody deliberately asked
      // for was the only kind that left no trace. See core/channels/whatsapp/outbox.js.
      async send(jid, text, meta = {}) {
        if (!session) throw new Error("whatsapp is not connected");
        return sendWhatsApp({ session, globalConfig: config, to: jid, text, meta });
      },
      /** Send a file — a document, a photo, whatever they asked for. */
      async sendFile(jid, filePath, { caption = "", fileName = "", meta = {} } = {}) {
        if (!session) throw new Error("whatsapp is not connected");
        return sendWhatsApp({ session, globalConfig: config, to: jid, file: filePath, fileName, text: caption, meta });
      },
      async sendSticker(jid, filePath, label = "", meta = {}) {
        if (!session) throw new Error("whatsapp is not connected");
        return sendWhatsApp({
          session, globalConfig: config, to: jid, stickerFile: filePath, stickerLabel: label, meta,
        });
      },
      /** Tap an option on the last menu that chat offered. */
      async chooseOption(jid, option, { asText = false, meta = {} } = {}) {
        if (!session) throw new Error("whatsapp is not connected");
        return chooseWhatsAppOption({ session, globalConfig: config, to: jid, option, asText, meta });
      },
      /** What is wrong with the roster and the chats. Reads, changes nothing. */
      inspect() {
        return inspectWhatsAppChats({ cfg: config });
      },
      /**
       * Fix it. The socket is passed in when there is one: names and roles are
       * settled from disk either way, but a message that was never readable
       * can only come back from the phone.
       */
      async repair({ dryRun = false, force = false } = {}) {
        return repairWhatsAppChats({ cfg: config, session, dryRun, force, log });
      },
      async react(jid, key, emoji) {
        if (!session) throw new Error("whatsapp is not connected");
        return sendWhatsApp({ session, globalConfig: config, to: jid, reactTo: key, text: emoji });
      },
      notifyOwner,
    };
  },
};
