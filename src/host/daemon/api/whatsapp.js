// WhatsApp channel endpoints.
//
//   GET    /whatsapp/status                     — session + roster summary
//   POST   /whatsapp/pair                       — start pairing, returns a QR
//   POST   /whatsapp/logout                     — drop the credentials
//   PATCH  /whatsapp/settings                   — enabled / auto_reply / groups / project
//   POST   /whatsapp/send        { jid, text }  — explicit send
//   GET    /whatsapp/contacts                   — the roster
//   PATCH  /whatsapp/contacts/:jid { role, name, nickname, relationship, bio, rules, auto_reply }
//   DELETE /whatsapp/contacts/:jid
//   POST   /whatsapp/contacts/:jid/owner        — "this row is me"
//   DELETE /whatsapp/owner                      — forget who the owner is
//   GET    /whatsapp/roles       PUT/DELETE /whatsapp/roles/:name
//   GET    /whatsapp/suggestions                — what contacts have asked for
//   POST   /whatsapp/suggestions/:id/confirm    — accept it (books, when it is a date)
//   POST   /whatsapp/suggestions/:id/dismiss    — drop it
//   GET    /whatsapp/stickers                   — the learned lexicon
//   GET    /whatsapp/stickers/:key/image        — the WebP itself
//   PATCH  /whatsapp/stickers/:key { meaning }  — the owner's own words
//
// The QR is returned ONLY by POST /pair, never by GET /status. A QR is a live
// credential: anyone who scans it owns the account for as long as it lasts. It
// must be asked for deliberately, not swept up by a panel that polls status
// every few seconds and caches the response.
import { asyncRoute } from "./shared.js";
import {
  readWhatsAppConfig,
  patchWhatsAppConfig,
  listWhatsAppContacts,
  upsertWhatsAppContact,
  removeWhatsAppContact,
  setWhatsAppRole,
  removeWhatsAppRole,
} from "#core/channels/whatsapp/config.js";
import { listStickers, learnSticker, stickerFile } from "#core/channels/whatsapp/stickers.js";
import { listSuggestions, findSuggestion, setSuggestionStatus } from "#core/channels/whatsapp/capture.js";
import { CAPABILITIES } from "#core/channels/whatsapp/config.js";
import { readConfig } from "#core/config/index.js";
import { normalizeJid, promoteToOwner, clearOwner } from "#core/identity/whatsapp.js";
import { RELATIONSHIPS } from "#core/channels/whatsapp/relationships.js";

const unavailable = (res) =>
  res.status(503).json({ error: "whatsapp plugin not loaded" });

export function register(api, { plugins }) {
  const wa = () => plugins?.get?.("whatsapp") || null;

  api.get("/whatsapp/status", (_req, res) => {
    const p = wa();
    if (!p) return unavailable(res);
    res.json(p.status());
  });

  api.post("/whatsapp/pair", asyncRoute(async (_req, res) => {
    const p = wa();
    if (!p) return unavailable(res);
    const { status, qr } = await p.pair();
    if (!qr) {
      // Already connected, or the socket has not produced one yet. Saying so is
      // more useful than an empty string the panel would render as a broken QR.
      return res.json({ status, qr: null, qr_data_url: null, note: qrNote(status) });
    }
    res.json({ status, qr, qr_data_url: await qrDataUrl(qr) });
  }));

  api.post("/whatsapp/logout", asyncRoute(async (_req, res) => {
    const p = wa();
    if (!p) return unavailable(res);
    res.json(await p.logout());
  }));

  api.patch("/whatsapp/settings", (req, res) => {
    res.json(patchWhatsAppConfig(req.body || {}));
  });

  api.post("/whatsapp/send", asyncRoute(async (req, res) => {
    const p = wa();
    if (!p) return unavailable(res);
    const jid = normalizeJid(req.body?.jid);
    const text = String(req.body?.text || "").trim();
    if (!jid) return res.status(400).json({ error: "a valid jid or phone number is required" });
    if (!text) return res.status(400).json({ error: "text is required" });
    await p.send(jid, text);
    res.json({ ok: true, jid });
  }));

  // ---- roster --------------------------------------------------------
  api.get("/whatsapp/contacts", (_req, res) => {
    // `relationships` rides along so the panel renders the same closed list the
    // API validates against. The web is a separate build and cannot import
    // core, so one source of truth means hydrating it from here — the same way
    // the model catalog is served.
    res.json({
      contacts: listWhatsAppContacts(),
      roles: readWhatsAppConfig().roles,
      relationships: RELATIONSHIPS,
      capabilities: CAPABILITIES,
    });
  });

  api.patch("/whatsapp/contacts/:jid", (req, res) => {
    try {
      res.json(upsertWhatsAppContact(req.params.jid, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete("/whatsapp/contacts/:jid", (req, res) => {
    res.json({ removed: removeWhatsAppContact(req.params.jid) });
  });

  // Promote a contact to owner.
  //
  // The point of doing it from a ROW rather than a text field: WhatsApp may
  // address someone by a LID that appears nowhere in the app, so they cannot
  // type the address they arrive under. Writing to the line and clicking the
  // row that appears needs no such knowledge.
  api.post("/whatsapp/contacts/:jid/owner", (req, res) => {
    const result = promoteToOwner(readConfig(), req.params.jid);
    if (!result) return res.status(400).json({ error: "unknown contact" });
    res.json(result);
  });

  api.delete("/whatsapp/owner", (_req, res) => {
    clearOwner(readConfig());
    res.json({ ok: true, owner_jid: "" });
  });

  api.get("/whatsapp/roles", (_req, res) => res.json(readWhatsAppConfig().roles));

  api.put("/whatsapp/roles/:name", (req, res) => {
    try {
      res.json(setWhatsAppRole(req.params.name, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete("/whatsapp/roles/:name", (req, res) =>
    res.json({ removed: removeWhatsAppRole(req.params.name) })
  );

  // ---- what people asked for -----------------------------------------
  api.get("/whatsapp/suggestions", (req, res) => {
    res.json({ suggestions: listSuggestions({ status: req.query.status || "pending" }) });
  });

  api.post("/whatsapp/suggestions/:id/confirm", asyncRoute(async (req, res) => {
    const row = findSuggestion(req.params.id);
    if (!row) return res.status(404).json({ error: "unknown suggestion" });

    // An appointment can become a real calendar event, but only when the caller
    // supplies the actual start time. The capture deliberately kept the
    // contact's WORDS ("mañana a la tarde") and never resolved them — turning
    // those into a timestamp is the owner's call, made here with a real date
    // in front of them, not the model's guess made hours earlier.
    let booked = null;
    const start = String(req.body?.start || "").trim();
    if (row.kind === "appointment" && start) {
      try {
        booked = await bookAppointment(row, req.body);
      } catch (e) {
        return res.status(400).json({ error: `could not create the event: ${e.message}` });
      }
    }
    res.json({ suggestion: setSuggestionStatus(row.id, "confirmed", booked ? { event: booked } : {}), booked });
  }));

  api.post("/whatsapp/suggestions/:id/dismiss", (req, res) => {
    const row = setSuggestionStatus(req.params.id, "dismissed");
    if (!row) return res.status(404).json({ error: "unknown suggestion" });
    res.json({ suggestion: row });
  });

  // ---- the sticker lexicon -------------------------------------------
  api.get("/whatsapp/stickers", (_req, res) => {
    // `has_image` so the panel knows whether to render an <img> or a
    // placeholder, without a request per row that 404s.
    res.json({ stickers: listStickers().map((x) => ({ ...x, has_image: !!stickerFile(x.key) })) });
  });

  // The image itself. A library of stickers described in words and shown as a
  // list of sentences is not a library you can pick from — the whole point of a
  // sticker is that you recognise it on sight.
  api.get("/whatsapp/stickers/:key/image", (req, res) => {
    const file = stickerFile(decodeURIComponent(req.params.key));
    if (!file) return res.status(404).json({ error: "no image stored for that sticker" });
    res.type("image/webp");
    // Content-addressed: the bytes behind a key never change, so it can be
    // cached hard. Private because the file is somebody's conversation.
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.sendFile(file);
  });

  api.patch("/whatsapp/stickers/:key", (req, res) => {
    const meaning = String(req.body?.meaning || "").trim();
    if (!meaning) return res.status(400).json({ error: "meaning is required" });
    // source "owner": from here on the model may count sightings but never
    // rewrite the words.
    const entry = learnSticker(decodeURIComponent(req.params.key), meaning, { source: "owner" });
    if (!entry) return res.status(400).json({ error: "unknown sticker" });
    res.json(entry);
  });
}

/** Create the calendar event for a confirmed appointment. */
async function bookAppointment(row, body = {}) {
  const { resolveIntegration } = await import("#core/integrations/index.js");
  const { createEvent } = await import("#core/integrations/plugins/calendar.js");
  // No project storage: WhatsApp is a channel, so its calendar is the global
  // one — which resolveIntegration reads from the default project's store.
  const resolved = resolveIntegration({ slug: "calendar" });
  const record = resolved?.record;
  if (!record) {
    throw new Error("Google Calendar is not connected — connect it under Integrations first");
  }
  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) throw new Error("`start` must be a date");
  const minutes = Number(body.minutes) > 0 ? Number(body.minutes) : 60;
  const end = new Date(start.getTime() + minutes * 60_000);
  return createEvent(record.config, {
    title: body.title || row.summary || `WhatsApp · ${row.from_name}`,
    start: start.toISOString(),
    end: end.toISOString(),
    description: [row.what, row.when_text && `Pidió: ${row.when_text}`, `De: ${row.from_name}`]
      .filter(Boolean).join("\n"),
  });
}

function qrNote(status) {
  if (status?.state === "connected") return "already connected — log out first to pair a different account";
  return "no QR yet; try again in a moment";
}

/** Render the QR as a PNG data URL so the panel can just show it. */
async function qrDataUrl(text) {
  try {
    const { default: QRCode } = await import("qrcode");
    return await QRCode.toDataURL(text, { margin: 1, width: 320 });
  } catch {
    // The optional dep is missing: hand back the raw string and let the caller
    // render it (the CLI does, with qrcode-terminal).
    return null;
  }
}
