// Send a WhatsApp message, deliberately, to one person.
//
// This tool is how the OWNER's agent reaches somebody on WhatsApp — from
// Telegram, from the web, from a routine. It is not how the WhatsApp channel
// answers a contact: a turn for a non-owner runs with no tools at all
// (`audience: "third_party"` forces it), so this schema is never even on the
// wire there. That separation is the point. The receptionist writes words; the
// agent with tools is a different turn, in a different context, for the owner.
//
// `dangerous: true` because there is no undo. A WhatsApp arrives on someone's
// phone, is read, and cannot be recalled — unlike a task or a file, the mistake
// is instantly in another person's hands.
import { normalizeJid, findWhatsAppContact } from "#core/identity/whatsapp.js";
import { CHANNELS } from "#core/constants/channels.js";
import { threadFor } from "#core/channels/whatsapp/thread.js";
import fs from "node:fs";
import { findStickerByMeaning, stickerFile } from "#core/channels/whatsapp/stickers.js";

/** The last few turns of a chat, as plain `who: what` lines. Best-effort: the
 *  ledger is a record, and a send must not fail because it could not be read. */
function recentThread(jid, limit = 6) {
  try {
    return threadFor(jid, { limit })
      .map((m) => `${m.role === "user" ? "ellos" : "vos"}: ${String(m.content).slice(0, 200)}`);
  } catch {
    return [];
  }
}

export default {
  name: "send_whatsapp",
  schema: {
    type: "function",
    function: {
      name: "send_whatsapp",
      description:
        "Send a WhatsApp message to one person. `to` is a phone number (any format) or a JID. " +
        "Plain text only — WhatsApp renders no markdown, so asterisks and backticks arrive literally. " +
        "Keep it to what a person would type. There is no undo: it is delivered the moment you call this. " +
        "Called from ANOTHER channel, the result hands you `thread_tail`: the last few turns you and that " +
        "person exchanged on WhatsApp. Read it before you report back — a conversation was already going, " +
        "and answering as if it were not is how a thread loses its thread.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "phone number (+54 9 11 5555-5555, 5491155555555) or a full JID (…@s.whatsapp.net, …@g.us for a group)",
          },
          text: { type: "string", description: "plain-text body; no markdown" },
          sticker: {
            type: "string",
            description:
              "send a STICKER instead of text: describe the one you want in words (\"pulgar arriba\", \"oso saludando\") " +
              "and it is matched against the stickers this account has learned. Only stickers somebody has already " +
              "sent here exist — you cannot invent one. `text` is ignored when this is set.",
          },
          option: {
            type: "string",
            description:
              "answer a MENU somebody sent (buttons, a list, a template) instead of typing: give the option's " +
              "NUMBER as it was shown (\"2\"), its exact title (\"Autos\") or its id. APX looks up the last menu in " +
              "that chat and sends the real button/list selection, so the bot sees the button pressed rather than a " +
              "sentence. `text` is ignored when this is set.",
          },
          as_text: {
            type: "boolean",
            description:
              "with `option`: type the option's label instead of sending a real button press. Use it when a tap " +
              "went unanswered — some menus only accept a typed answer.",
          },
          file: {
            type: "string",
            description:
              "absolute path of a FILE to send — a PDF, a photo, a spreadsheet. It goes as a real attachment " +
              "(a document keeps its name; an image arrives as a picture), and `text` rides along as the caption. " +
              "Only files already on this machine: you cannot invent a path, and a file somebody sent you is " +
              "under its `local_path` in the thread.",
          },
          react_to: {
            type: "string",
            description:
              "message id to REACT to instead of sending a message. With this set, `text` must be a single emoji " +
              "(an empty string removes an existing reaction). Use it when a reply would be more than the moment deserves.",
          },
        },
        required: ["to"],
      },
    },
  },
  makeHandler: (ctx) => async (args = {}) => {
    const { plugins, requirePermission, globalConfig, channel, channelMeta } = ctx;
    const { to, text, confirmed = false } = args;

    const jid = normalizeJid(to);
    if (!jid) throw new Error(`send_whatsapp: "${to}" is not a usable phone number or JID`);
    const reactTo = String(args.react_to || "").trim();
    const wantSticker = String(args.sticker || "").trim();
    const wantFile = String(args.file || "").trim();
    const wantOption = String(args.option ?? "").trim();
    const body = String(text || "").trim();
    // An empty body is a refusal for a message and a legitimate "remove the
    // reaction" for a reaction, so the check only applies to the former.
    if (!body && !reactTo && !wantSticker && !wantOption && !wantFile) {
      throw new Error("send_whatsapp: refusing to send an empty message");
    }

    // The confirmation names the recipient, not just the text: the failure mode
    // worth catching here is the right message to the wrong person.
    const known = findWhatsAppContact(globalConfig, jid);
    /**
     * Answering the thread you are standing in is not a dangerous action.
     *
     * The gate exists for the failure worth catching — the right message to the
     * WRONG person — and it earns its keep everywhere else. Inside a WhatsApp
     * turn, replying to the very chat that just wrote to you is not that: it is
     * the only thing the channel does.
     *
     * And it could not ask. `permission_mode` defaults to `automatico`, the
     * WhatsApp turn wires no confirmation dialog, so the guard THREW — the
     * model read "Action requires user confirmation" as one more failed tool
     * and went on to tell the owner it had answered. Manu, 2026-09-20: "vos
     * estuviste hablando con ella re tranquila, de repente te dejó un mensaje,
     * se te trabó todo, y ahora no le puedes responder".
     *
     * Any OTHER recipient still goes through the gate, unchanged.
     */
    const replyingToThisThread =
      channel === CHANNELS.WHATSAPP &&
      !!channelMeta?.chatJid &&
      normalizeJid(channelMeta.chatJid) === jid;

    await requirePermission("send_whatsapp", {
      dangerous: !replyingToThisThread,
      confirmed,
      // What the human approving this will actually see happen on the other
      // phone. For an option that is the tap, not the (ignored) `text`.
      args: {
        to: known?.name ? `${known.name} <${jid}>` : jid,
        text: wantOption ? `elegir la opción "${wantOption}"` : body,
      },
    });

    if (!plugins) throw new Error("plugins unavailable");
    const whatsapp = plugins.get("whatsapp");
    if (!whatsapp) throw new Error("whatsapp plugin not loaded");

    const status = whatsapp.status?.();
    if (status && status.state !== "connected") {
      // A clear state beats a socket error: the model can tell the owner what
      // to do about it instead of retrying into a dead connection.
      return {
        ok: false,
        sent: false,
        state: status.state,
        error:
          status.state === "logged_out"
            ? "WhatsApp is logged out — the owner has to pair it again from Settings → WhatsApp."
            : `WhatsApp is not connected (${status.state}).`,
      };
    }

    if (wantFile) {
      // Refused here rather than deeper: "that path does not exist" is
      // something to tell the owner in words, and a model that invented a
      // filename must not have that turn into a socket error three layers down.
      if (!fs.existsSync(wantFile)) {
        return { ok: false, sent: false, error: `no such file: ${wantFile}` };
      }
      return whatsapp.sendFile(jid, wantFile, { caption: body });
    }

    if (wantSticker) {
      const hit = findStickerByMeaning(wantSticker);
      const file = hit && stickerFile(hit.key);
      if (!file) {
        // Returned rather than thrown: "we don't have that one" is information
        // the model should act on — say it in words instead — not a failure.
        return {
          ok: false,
          sent: false,
          error: `no learned sticker matches "${wantSticker}"`,
          // Blocked ones are left out: offering one as an alternative would be
          // suggesting the exact sticker the owner said never to send.
          available: (await import("#core/channels/whatsapp/stickers.js"))
            .listStickers().filter((x) => !x.blocked).slice(0, 12).map((x) => x.meaning),
        };
      }
      await whatsapp.sendSticker(jid, file, hit.meaning);
      return { ok: true, sent: true, sticker: hit.meaning, to: jid, name: known?.name || null };
    }

    if (wantOption) {
      // Resolution lives in core (which menu, which option, can it be tapped at
      // all) — this handler only says who and what. A miss comes back as data
      // rather than an exception on purpose: "that chat has no menu" is
      // something to tell the owner, not something to retry.
      return whatsapp.chooseOption(jid, wantOption, { asText: args.as_text === true });
    }

    if (reactTo) {
      await whatsapp.react(jid, { id: reactTo, remoteJid: jid, fromMe: false }, body);
      return { ok: true, reacted: body || "(removed)", to: jid, name: known?.name || null };
    }

    // `send` writes the ledger row itself, so the message the agent just sent is
    // readable in the thread, the panel and `tail_messages` the moment this
    // returns. It did not always: a peer agent once read the log, found no
    // outgoing row for a message that HAD been delivered, called the send a lie
    // and had a duplicate sent to the same person. Anything that reports
    // `sent: true` must have left a record saying so.
    const res = await whatsapp.send(jid, body);
    return {
      ok: true,
      sent: true,
      to: jid,
      name: known?.name || null,
      chars: body.length,
      // The id WhatsApp gave it. Proof the send happened that outlives this
      // turn — it is on the ledger row too, so a later reader can match them.
      ...(res?.id ? { message_id: res.id } : {}),
      logged: true,
      // The conversation this message just joined — only when the turn is NOT a
      // WhatsApp one, because a WhatsApp turn already has this thread as its
      // history (dispatch.js `threadFor`) and repeating it is context spent
      // twice.
      //
      // Manu, 2026-09-20: "sería bueno que en tu skill misma sepas o recuerdes
      // revisar los últimos mensajes para tener contexto, porque a veces le
      // contestás cualquiera cuando podrías saber que venías hablando". From
      // Telegram, the agent had no cheap way to know what had been said, so it
      // answered into the void and then described the void to the owner.
      ...(channel === CHANNELS.WHATSAPP ? {} : { thread_tail: recentThread(jid) }),
    };
  },

  /**
   * The watchdog's ceiling for one send — well under the TURN's.
   *
   * These two were inverted. `session.js` calls Baileys' `sendMessage` with no
   * timeout of its own, and with no `deadlineMs` here the watchdog fell back to
   * its 15-minute default, while the WhatsApp owner turn dies at 6 (see
   * `OWNER_DEADLINE_MS`). So the TURN was aborted first and the send outlived
   * it: the owner got the canned "se me colgó ese pedido" while the message was
   * still on its way, and if it landed afterwards nothing logged it, because the
   * context that would have written the ledger row was gone. Message delivered,
   * ledger empty — the 2026-09-09 incident `outbox.js` documents in its header.
   *
   * 90s is long for a socket that is healthy and short enough that the turn is
   * still alive to hear the answer and say something true about it.
   */
  deadlineMs: 90_000,
};
