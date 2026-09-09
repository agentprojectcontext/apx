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
import { findStickerByMeaning, stickerFile } from "#core/channels/whatsapp/stickers.js";

export default {
  name: "send_whatsapp",
  schema: {
    type: "function",
    function: {
      name: "send_whatsapp",
      description:
        "Send a WhatsApp message to one person. `to` is a phone number (any format) or a JID. " +
        "Plain text only — WhatsApp renders no markdown, so asterisks and backticks arrive literally. " +
        "Keep it to what a person would type. There is no undo: it is delivered the moment you call this.",
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
          react_to: {
            type: "string",
            description:
              "message id to REACT to instead of sending a message. With this set, `text` must be a single emoji " +
              "(an empty string removes an existing reaction). Use it when a reply would be more than the moment deserves.",
          },
        },
        required: ["to", "text"],
      },
    },
  },
  makeHandler: (ctx) => async (args = {}) => {
    const { plugins, requirePermission, globalConfig } = ctx;
    const { to, text, confirmed = false } = args;

    const jid = normalizeJid(to);
    if (!jid) throw new Error(`send_whatsapp: "${to}" is not a usable phone number or JID`);
    const reactTo = String(args.react_to || "").trim();
    const wantSticker = String(args.sticker || "").trim();
    const body = String(text || "").trim();
    // An empty body is a refusal for a message and a legitimate "remove the
    // reaction" for a reaction, so the check only applies to the former.
    if (!body && !reactTo && !wantSticker) throw new Error("send_whatsapp: refusing to send an empty message");

    // The confirmation names the recipient, not just the text: the failure mode
    // worth catching here is the right message to the wrong person.
    const known = findWhatsAppContact(globalConfig, jid);
    await requirePermission("send_whatsapp", {
      dangerous: true,
      confirmed,
      args: { to: known?.name ? `${known.name} <${jid}>` : jid, text: body },
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
      await whatsapp.sendSticker(jid, file);
      return { ok: true, sent: true, sticker: hit.meaning, to: jid, name: known?.name || null };
    }

    if (reactTo) {
      await whatsapp.react(jid, { id: reactTo, remoteJid: jid, fromMe: false }, body);
      return { ok: true, reacted: body || "(removed)", to: jid, name: known?.name || null };
    }

    await whatsapp.send(jid, body);
    return { ok: true, sent: true, to: jid, name: known?.name || null, chars: body.length };
  },
};
