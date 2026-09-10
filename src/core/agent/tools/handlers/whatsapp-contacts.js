// The WhatsApp roster, from the agent's side: who is on it, and who gets in.
//
// The roster is the allowlist — it decides whose messages are answered and
// whose are met with silence — and until now the ONLY ways to change it were
// the panel and the HTTP API. So the agent could be asked "buscá el número de
// Rodrigo y activale los mensajes", could see the person in the ledger, and
// could do nothing about it but tell the owner to go and click.
//
// Reading is free. WRITING is gated, and deliberately so: `save` is the call
// that decides APX will hold conversations with somebody, which is the same
// decision `send_whatsapp` asks permission for. It is not dangerous in the
// irreversible sense — a roster row is editable and deletable — but it is a
// standing grant rather than one message, so it stops for a yes.
//
// Everything here is a thin adapter over core: config.js owns validation and
// the write, identity/whatsapp.js owns addressing and what a policy resolves
// to. This file only decides which of them to call.
import { TOOLS } from "../names.js";
import {
  readWhatsAppConfig,
  upsertWhatsAppContact,
  removeWhatsAppContact,
} from "#core/channels/whatsapp/config.js";
import { RELATIONSHIPS } from "#core/channels/whatsapp/relationships.js";
import {
  normalizeJid,
  resolveReplyPolicy,
  resolveWhatsAppSender,
  REPLY_POLICIES,
} from "#core/identity/whatsapp.js";
import { readConfig } from "#core/config/index.js";

/** What a row means in one word, so the agent does not have to infer it. */
function statusOf(cfg, row) {
  const sender = resolveWhatsAppSender({ cfg, addresses: [row.jid], chatJid: row.jid });
  const policy = resolveReplyPolicy(cfg, sender);
  if (policy === REPLY_POLICIES.FULL) return "owner";
  if (policy === REPLY_POLICIES.TEXT_ONLY) return "answered";
  return "silent";
}

const shape = (cfg) => (row) => ({
  jid: row.jid,
  name: row.name || null,
  role: row.role || "guest",
  status: statusOf(cfg, row),
  ...(row.nickname ? { nickname: row.nickname } : {}),
  ...(row.relationship ? { relationship: row.relationship } : {}),
  ...(row.business ? { business: true } : {}),
  // Added because the owner told APX to write to them, never reviewed since.
  ...(row.pending_review ? { pending_review: true } : {}),
  ...(row.last_seen ? { last_seen: row.last_seen } : {}),
});

const fold = (s) =>
  String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export default {
  // Spelled out, like every other handler: tests/tool-names.test.js reads this
  // literal out of the SOURCE to check that names.js and the handler files
  // agree. A constant here compiles fine and makes that guard blind.
  name: "whatsapp_contacts",
  category: "messages",
  schema: {
    type: "function",
    function: {
      name: "whatsapp_contacts",
      description:
        "Read and manage the WhatsApp roster — the allowlist that decides whose messages get answered. " +
        "`list` shows everyone (add `pending: true` for the ones APX added by writing to them and nobody has " +
        "reviewed). `find` looks somebody up by name or number. `save` adds or updates one: give it a role to " +
        "let APX hold conversations with them, or auto_reply false to mute them. `forget` removes the row. " +
        "Use this instead of telling the owner to go and click in Settings.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "find", "save", "forget"],
            description: "list | find | save | forget",
          },
          query: {
            type: "string",
            description: "for `find`: a name, a nickname or a phone number, in any format",
          },
          jid: {
            type: "string",
            description:
              "for `save` and `forget`: the phone number (any format) or full JID. Take it from `find`/`list` " +
              "rather than retyping it — a person can hold a phone JID and an opaque …@lid, and they are the same human.",
          },
          name: { type: "string", description: "for `save`: what to call them" },
          role: {
            type: "string",
            description:
              "for `save`: \"contact\" is the ordinary one — APX answers them in a sealed, tool-free turn. " +
              "\"guest\" means recorded but never answered. Roles the owner defined in config also work. " +
              "\"owner\" cannot be granted here; it is decided by pairing.",
          },
          auto_reply: {
            type: "boolean",
            description: "for `save`: false mutes this one person without removing them from the roster",
          },
          relationship: {
            type: "string",
            enum: [...RELATIONSHIPS],
            description:
              "for `save`: a CATEGORY, not a sentence — core rejects anything off this list. " +
              "\"mi contadora\" is `supplier` plus a `bio`, not a relationship.",
          },
          bio: { type: "string", description: "for `save`: who they are, in the owner's words" },
          rules: { type: "string", description: "for `save`: what the owner wants done with this person" },
          pending: { type: "boolean", description: "for `list`: only the rows nobody has reviewed yet" },
        },
        required: ["action"],
      },
    },
  },

  makeHandler: (ctx) => async (args = {}) => {
    const { requirePermission } = ctx;
    const action = String(args.action || "").trim();
    // Read from DISK, not from the config the turn booted with: the owner may
    // have changed a role in the panel thirty seconds ago, and answering from a
    // stale copy is how the agent reports the opposite of what is true.
    const cfg = readConfig();
    const wa = readWhatsAppConfig(cfg);
    const rows = Array.isArray(wa.contacts) ? wa.contacts : [];
    const view = shape(cfg);

    if (action === "list") {
      const wanted = args.pending === true ? rows.filter((r) => r.pending_review) : rows;
      return {
        ok: true,
        count: wanted.length,
        total: rows.length,
        contacts: wanted.map(view),
        ...(args.pending === true && !wanted.length
          ? { note: "nobody is waiting to be reviewed" }
          : {}),
      };
    }

    if (action === "find") {
      const q = fold(args.query);
      if (!q) throw new Error("whatsapp_contacts: `find` needs a query");
      // A number typed loosely ("+54 9 11 5555-5555") has to reach the row it
      // names, so it is normalised and compared as an address as well as text.
      const asJid = normalizeJid(args.query);
      const digits = String(args.query).replace(/\D/g, "");
      const hits = rows.filter((r) => {
        const addrs = [r.jid, ...(r.alts || [])].map(normalizeJid).filter(Boolean);
        if (asJid && addrs.includes(asJid)) return true;
        if (digits.length >= 6 && addrs.some((a) => a.includes(digits))) return true;
        return fold(r.name).includes(q) || fold(r.nickname).includes(q);
      });
      return { ok: true, count: hits.length, contacts: hits.map(view) };
    }

    if (action === "save") {
      const jid = normalizeJid(args.jid);
      if (!jid) throw new Error(`whatsapp_contacts: "${args.jid}" is not a usable phone number or JID`);
      const before = rows.find((r) => normalizeJid(r.jid) === jid);

      // Naming what CHANGES, not just who. "allow Rodrigo to be answered" is a
      // different thing to approve than "rename Rodrigo", and a confirmation
      // that says only the jid makes them look identical.
      const changes = [];
      if (args.role !== undefined) changes.push(`role → ${args.role}`);
      if (args.auto_reply !== undefined) changes.push(args.auto_reply === false ? "muted" : "unmuted");
      if (args.name !== undefined) changes.push(`name → ${args.name}`);
      if (args.relationship !== undefined) changes.push(`relationship → ${args.relationship}`);
      if (args.bio !== undefined) changes.push("bio updated");
      if (args.rules !== undefined) changes.push("rules updated");
      if (!changes.length) throw new Error("whatsapp_contacts: `save` needs something to change");

      await requirePermission(TOOLS.WHATSAPP_CONTACTS, {
        confirmed: args.confirmed === true,
        args: {
          contact: before?.name ? `${before.name} <${jid}>` : jid,
          change: changes.join(", "),
        },
      });

      const patch = {};
      for (const k of ["name", "role", "auto_reply", "relationship", "bio", "rules"]) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      // `pending_review` is cleared by upsertWhatsAppContact itself — editing a
      // row is what reviewing one means, whichever door the edit came through.
      const saved = upsertWhatsAppContact(jid, patch);
      const after = readConfig();
      return {
        ok: true,
        created: !before,
        contact: shape(after)(saved),
        changed: changes,
      };
    }

    if (action === "forget") {
      const jid = normalizeJid(args.jid);
      if (!jid) throw new Error(`whatsapp_contacts: "${args.jid}" is not a usable phone number or JID`);
      const before = rows.find((r) => normalizeJid(r.jid) === jid);
      if (!before) return { ok: false, error: `nobody on the roster matches ${jid}` };
      await requirePermission(TOOLS.WHATSAPP_CONTACTS, {
        confirmed: args.confirmed === true,
        args: { contact: before.name ? `${before.name} <${jid}>` : jid, change: "removed from the roster" },
      });
      removeWhatsAppContact(jid);
      // Removing is not erasing: the thread stays on the ledger, they simply
      // stop being answered. Said plainly so the agent does not report a
      // deletion that did not happen.
      return { ok: true, removed: jid, note: "off the allowlist; the conversation history is untouched" };
    }

    throw new Error(`whatsapp_contacts: unknown action "${action}"`);
  },
};
