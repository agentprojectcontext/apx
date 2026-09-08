// Turning a request into something the owner can act on in one tap.
//
// The turn that answers a contact has no tools and never will: that is what
// makes a leak structurally impossible. So a "capability" cannot mean the
// conversation DOES anything. It means the request is read a second time, on
// its own, and what it was asking for is written down for the owner to confirm.
//
// Why a SEPARATE call rather than asking the reply to carry a hidden block:
// a block embedded in the reply has to be stripped before sending, and a strip
// that fails once sends the machinery to the contact. There is no such failure
// mode here — the reply is plain text that nothing post-processes, and this
// runs beside it on the same message.
//
// Everything here is best-effort. A capture that fails costs a suggestion, not
// the conversation.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/paths.js";
import { callEngine } from "#core/engines/index.js";
import { logWarn } from "#core/logging.js";

const STORE = () => path.join(APX_HOME, "whatsapp", "suggestions.json");

const SYSTEM = `You read one WhatsApp message and decide whether the sender is ASKING FOR SOMETHING their recipient would have to act on.

Answer with JSON only, no prose, no code fence:
{"kind":"appointment"|"errand"|"none","summary":"...","what":"...","when":"...","urgent":true|false}

- "appointment" only when they are asking for a time, a date, a turn, a visit or a slot.
- "errand" when they want something else done, sent, answered, quoted or checked.
- "none" for greetings, chat, thanks, reactions, or anything already answered in the message itself.
- "summary": one short line in the SENDER'S language, as the recipient would want to read it in a list.
- "when": their words about timing, verbatim ("mañana a la tarde", "la semana que viene"). Empty when they gave none. NEVER invent or resolve a date.
- "urgent": true only when they said so or it plainly cannot wait.`;

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(rows) {
  const file = STORE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 0600: these name people and what they asked for.
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), { mode: 0o600 });
}

export function listSuggestions({ status = "pending" } = {}) {
  const rows = readStore();
  return (status === "all" ? rows : rows.filter((r) => r.status === status))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export function findSuggestion(id) {
  return readStore().find((r) => r.id === id) || null;
}

export function setSuggestionStatus(id, status, extra = {}) {
  const rows = readStore();
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  row.status = status;
  row.resolved_at = new Date().toISOString();
  Object.assign(row, extra);
  writeStore(rows);
  return row;
}

/**
 * Read one inbound message and record what it was asking for.
 *
 * `caps` gates the KIND, not the reading: with only `errands` on, an
 * appointment request is still captured — as an errand — because the owner
 * wanting to hear about requests and not wanting the scheduling shape are
 * different preferences.
 *
 * Returns the stored suggestion, or null when there was nothing to record.
 */
export async function captureRequest({ body, sender, chatJid, caps, globalConfig }) {
  if (!caps?.appointments && !caps?.errands) return null;
  const text = String(body || "").trim();
  if (!text || text.startsWith("[")) return null; // a bare marker: sticker, reaction, media with no words

  let parsed = null;
  try {
    const r = await callEngine({
      modelId: globalConfig?.super_agent?.model,
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
      config: globalConfig,
      maxTokens: 200,
    });
    parsed = JSON.parse(String(r?.text || "").replace(/^```(?:json)?|```$/g, "").trim());
  } catch (e) {
    logWarn("whatsapp", `capture failed for ${sender?.name || chatJid}: ${e.message}`);
    return null;
  }

  const kindRaw = String(parsed?.kind || "none");
  if (kindRaw === "none") return null;
  // Downgrade rather than drop: see the note above.
  const kind = kindRaw === "appointment" && !caps.appointments ? "errand" : kindRaw;
  if (kind === "errand" && !caps.errands) return null;
  if (!["appointment", "errand"].includes(kind)) return null;

  const row = {
    id: `sg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    status: "pending",
    created_at: new Date().toISOString(),
    from_jid: sender?.jid || null,
    from_name: sender?.name || "",
    chat_jid: chatJid || null,
    summary: String(parsed?.summary || "").slice(0, 200),
    what: String(parsed?.what || "").slice(0, 300),
    // Their words, never a resolved date: "mañana a la tarde" is what they said,
    // and turning it into a timestamp here would be this file deciding something
    // it has no business deciding.
    when_text: String(parsed?.when || "").slice(0, 120),
    urgent: parsed?.urgent === true,
  };
  const rows = readStore();
  rows.push(row);
  writeStore(rows);
  return row;
}
