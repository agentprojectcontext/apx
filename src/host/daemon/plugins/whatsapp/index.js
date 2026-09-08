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
import { handleWhatsAppMessage } from "#core/channels/whatsapp/dispatch.js";
import { readWhatsAppConfig, patchWhatsAppConfig } from "#core/channels/whatsapp/config.js";
import { normalizeJid } from "#core/identity/whatsapp.js";

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
      async send(jid, text) {
        if (!session) throw new Error("whatsapp is not connected");
        return session.sendText(jid, text);
      },
      async sendSticker(jid, filePath) {
        if (!session) throw new Error("whatsapp is not connected");
        return session.sendSticker(jid, filePath);
      },
      async react(jid, key, emoji) {
        if (!session) throw new Error("whatsapp is not connected");
        return session.sendReaction(jid, key, emoji);
      },
      notifyOwner,
    };
  },
};
