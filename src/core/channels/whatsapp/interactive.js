// Interactive WhatsApp: menus, buttons, lists, templates — and the taps on them.
//
// A corporate bot does not send sentences. It sends a MENU: three quick-reply
// buttons, a "ver opciones" list, a hydrated template. None of those carry
// `conversation` or `extendedTextMessage.text`, which used to be the only two
// fields the dispatch read — so on 2026-09-10 a bot's button menu arrived in the
// owner's Telegram as the literal string "[empty message]". The bytes were all
// there; nothing looked at them.
//
// Two families live here and they are not the same thing:
//
//   an OFFER  — somebody is showing choices (buttonsMessage, listMessage,
//               templateMessage, interactiveMessage, a poll). It has options.
//   a REPLY   — somebody PICKED one (buttonsResponseMessage,
//               templateButtonReplyMessage, listResponseMessage,
//               interactiveResponseMessage). It has a selection.
//
// Both must read as text, because everything downstream — the ledger, the
// thread, the notification to the owner, the prompt a turn is given — is text.
// An offer renders its options inline so the agent can answer "2" the way a
// person would; a reply renders what was chosen so the thread makes sense a day
// later.
//
// Everything is best-effort and non-throwing by design. These payloads come off
// somebody else's server, the proto has a decade of overlapping generations in
// it (fourRowTemplate vs hydratedTemplate vs nativeFlow, all still live), and a
// decoder that throws on a field it did not expect turns one odd message into a
// dead channel.
import { CHANNELS } from "#core/constants/channels.js";
import { readGlobalMessages } from "#core/stores/messages.js";
import { normalizeJid } from "#core/identity/whatsapp.js";
import { addressesFor } from "./aliases.js";

/**
 * Containers WhatsApp wraps real content in.
 *
 * This is not a nicety: WhatsApp Business API interactive messages routinely
 * arrive inside `viewOnceMessage`, and disappearing chats wrap EVERYTHING in
 * `ephemeralMessage`. A decoder that reads the top level only sees a wrapper
 * with no text in it and reports an empty message — which is exactly the bug
 * this file exists for, one layer up.
 */
const CONTAINERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
  "deviceSentMessage",
  "botInvokeMessage",
];

/** Peel the containers off until a real message node is in hand. */
export function unwrapMessage(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 6) return message || {};
  for (const key of CONTAINERS) {
    const inner = message[key]?.message;
    if (inner) return unwrapMessage(inner, depth + 1);
  }
  return message;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
/** A proto string field that is sometimes `{ text }` and sometimes a string. */
const soft = (v) => (typeof v === "string" ? v.trim() : str(v?.text) || str(v?.displayText));

function parseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Options, numbered from 1, with the duplicates and the blanks gone.
 *
 * The number is what makes an offer answerable: "2" is how a person replies to
 * a menu on a phone, and it is the only handle that survives being read back
 * out of the ledger by a turn that never saw the proto.
 */
function numbered(raw) {
  const out = [];
  const seen = new Set();
  for (const o of raw) {
    const title = str(o?.title);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      n: out.length + 1,
      id: str(o?.id) || title,
      title,
      ...(str(o?.description) ? { description: str(o.description) } : {}),
      ...(str(o?.url) ? { url: str(o.url) } : {}),
    });
  }
  return out;
}

// --- the offers -----------------------------------------------------------

function fromButtons(node) {
  const options = (node.buttons || []).map((b) => ({
    id: str(b?.buttonId),
    title: soft(b?.buttonText),
  }));
  return {
    kind: "buttons",
    title: soft(node.headerText) || soft(node.text),
    text: soft(node.contentText),
    footer: soft(node.footerText),
    options: numbered(options),
  };
}

function fromList(node) {
  const options = [];
  for (const section of node.sections || []) {
    const sectionTitle = str(section?.title);
    for (const row of section?.rows || []) {
      options.push({
        id: str(row?.rowId),
        title: str(row?.title),
        description: [sectionTitle, str(row?.description)].filter(Boolean).join(" — "),
      });
    }
  }
  return {
    kind: "list",
    title: soft(node.title),
    text: soft(node.description),
    footer: soft(node.footerText),
    // What the button that OPENS the list says ("Ver opciones"). Kept because a
    // list with an empty body is otherwise a menu with no question on it.
    prompt: soft(node.buttonText),
    options: numbered(options),
  };
}

/**
 * A hydrated template — the generation before nativeFlow, still what most
 * business accounts send. Three spellings of the same thing are live at once
 * (`hydratedTemplate`, `hydratedFourRowTemplate`, `fourRowTemplate`), so all
 * three are read rather than betting on one.
 */
function fromTemplate(node) {
  const h = node.hydratedTemplate || node.hydratedFourRowTemplate || {};
  const four = node.fourRowTemplate || {};
  const options = [];
  for (const b of h.hydratedButtons || four.buttons || []) {
    const quick = b?.quickReplyButton;
    const url = b?.urlButton;
    const call = b?.callButton;
    if (quick) options.push({ id: soft(quick.id), title: soft(quick.displayText) });
    else if (url) options.push({ id: soft(url.url), title: soft(url.displayText), url: soft(url.url) });
    else if (call) options.push({ id: soft(call.phoneNumber), title: soft(call.displayText) });
  }
  return {
    kind: "template",
    title: soft(h.hydratedTitleText) || soft(four.title),
    text: soft(h.hydratedContentText) || soft(four.content),
    footer: soft(h.hydratedFooterText) || soft(four.footer),
    options: numbered(options),
  };
}

/**
 * nativeFlow — the current generation, and the one the La Caja bot used.
 *
 * Every button hides its real content in `buttonParamsJson`, a JSON STRING
 * whose shape depends on `name`: a quick reply is one option, a `single_select`
 * is a whole list of them, a `cta_url` is a link. Reading `name` and ignoring
 * the params (or the other way round) loses the labels a person actually sees.
 */
function fromNativeFlow(flow, into) {
  for (const b of flow?.buttons || []) {
    const name = str(b?.name);
    const params = parseJson(b?.buttonParamsJson) || {};
    if (name === "single_select" || Array.isArray(params.sections)) {
      if (!into.prompt) into.prompt = str(params.title);
      for (const section of params.sections || []) {
        for (const row of section?.rows || []) {
          into.options.push({
            id: str(row?.id),
            title: str(row?.title) || str(row?.header),
            description: [str(section?.title), str(row?.description)].filter(Boolean).join(" — "),
          });
        }
      }
      continue;
    }
    const title = str(params.display_text) || str(params.displayText) || str(params.flow_cta);
    if (!title) continue;
    into.options.push({
      id: str(params.id) || str(params.flow_id) || title,
      title,
      ...(str(params.url) ? { url: str(params.url) } : {}),
    });
  }
}

function fromInteractive(node) {
  const into = { options: [], prompt: "" };
  fromNativeFlow(node.nativeFlowMessage, into);
  // A carousel is several cards, each with its own buttons. Flattened: from the
  // agent's side it is still one list of things it may pick.
  for (const card of node.carouselMessage?.cards || []) {
    fromNativeFlow(card?.nativeFlowMessage, into);
  }
  return {
    kind: "interactive",
    title: soft(node.header?.title),
    subtitle: soft(node.header?.subtitle),
    text: soft(node.body),
    footer: soft(node.footer),
    prompt: into.prompt,
    options: numbered(into.options),
  };
}

function fromPoll(node) {
  return {
    kind: "poll",
    title: "",
    text: str(node.name),
    options: numbered((node.options || []).map((o) => ({ id: str(o?.optionName), title: str(o?.optionName) }))),
  };
}

// --- the replies ----------------------------------------------------------

function selectionOf(message) {
  const br = message.buttonsResponseMessage;
  if (br) {
    return {
      kind: "buttons",
      selection: { id: str(br.selectedButtonId), title: soft(br.selectedDisplayText) },
    };
  }
  const tr = message.templateButtonReplyMessage;
  if (tr) {
    return {
      kind: "template",
      selection: {
        id: soft(tr.selectedId),
        title: soft(tr.selectedDisplayText),
        index: Number.isFinite(tr.selectedIndex) ? tr.selectedIndex : null,
      },
    };
  }
  const lr = message.listResponseMessage;
  if (lr) {
    return {
      kind: "list",
      selection: {
        id: str(lr.singleSelectReply?.selectedRowId),
        title: soft(lr.title),
        description: soft(lr.description),
      },
    };
  }
  const ir = message.interactiveResponseMessage;
  if (ir) {
    const params = parseJson(ir.nativeFlowResponseMessage?.paramsJson) || {};
    return {
      kind: "interactive",
      selection: {
        id: str(params.id) || str(ir.nativeFlowResponseMessage?.name),
        // The body is what the person saw on the button; the params carry the
        // machine id. Either can be missing, so neither is the only source.
        title: soft(ir.body) || str(params.display_text) || str(params.title),
      },
    };
  }
  return null;
}

/**
 * Decode one message into a menu, a choice, or nothing.
 *
 * @param {object} message  a Baileys `message` object, wrapped or not
 * @returns {null|{kind, title, subtitle, text, footer, prompt, options, selection}}
 */
export function readInteractive(message) {
  const m = unwrapMessage(message);
  if (!m || typeof m !== "object") return null;

  const picked = selectionOf(m);
  if (picked) return { title: "", subtitle: "", text: "", footer: "", prompt: "", options: [], ...picked };

  const offer =
    (m.buttonsMessage && fromButtons(m.buttonsMessage)) ||
    (m.listMessage && fromList(m.listMessage)) ||
    (m.templateMessage && fromTemplate(m.templateMessage)) ||
    (m.interactiveMessage && fromInteractive(m.interactiveMessage)) ||
    ((m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) &&
      fromPoll(m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3)) ||
    null;
  if (!offer) return null;

  const full = { title: "", subtitle: "", text: "", footer: "", prompt: "", options: [], selection: null, ...offer };
  // A "menu" with no readable options and no words in it decoded to nothing
  // useful — say so, and let the caller fall through to its own marker rather
  // than writing an empty interactive line into the thread.
  if (!full.options.length && !full.text && !full.title && !full.prompt) return null;
  return full;
}

/**
 * What a person would read.
 *
 * The options are rendered INLINE and numbered, because the number is the
 * answer: "[Opciones: 1. Autos | 2. Hogar]" is a menu the agent can reply to
 * with "2" without ever seeing the proto. The footer is dropped — it is legal
 * boilerplate on every message a business sends and it is never the point.
 */
export function describeInteractive(decoded) {
  if (!decoded) return "";
  if (decoded.selection) {
    const { title, id } = decoded.selection;
    const what = title || id;
    return what ? `[eligió: ${what}]` : "[eligió una opción]";
  }
  // The list's own button label ("Ver opciones") stands in for the body only
  // when there is no body — otherwise it is noise printed on top of a question
  // that was already asked.
  const head = [decoded.title, decoded.subtitle, str(decoded.text) || decoded.prompt]
    .map((s) => str(s))
    .filter(Boolean);
  const body = dedupe(head).join("\n");
  const opts = decoded.options
    .map((o) => `${o.n}. ${o.title}`)
    .join(" | ");
  const menu = opts ? `[Opciones: ${opts}]` : "";
  return [body, menu].filter(Boolean).join("\n").trim();
}

const dedupe = (lines) => {
  const seen = new Set();
  return lines.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Everything a WhatsApp message says, as text.
 *
 * The one entry point the dispatch uses. Plain text first because it is the
 * common case and the cheapest; interactive after, because a message that has
 * `conversation` never also has buttons. Captions are deliberately NOT read
 * here — `resolveInboundMedia` already folds those in next to the media marker,
 * and reading them twice would print every photo's caption twice.
 */
export function messageText(message) {
  const m = unwrapMessage(message);
  const plain = str(m?.conversation) || soft(m?.extendedTextMessage);
  if (plain) return plain;
  return describeInteractive(readInteractive(m));
}

// --- answering a menu -----------------------------------------------------

/**
 * The last menu somebody offered in this chat.
 *
 * Read back out of the LEDGER rather than held in memory: the agent that
 * answers a menu is often not the turn that received it (the owner reads the
 * notification on Telegram an hour later and says "decile que autos"), and a
 * daemon restart in between must not lose the choices. `dispatch.js` stamps
 * `meta.interactive_options` on the inbound row for exactly this.
 */
export function lastOfferFor(chatJid, { limit = 200 } = {}) {
  const wanted = normalizeJid(chatJid);
  if (!wanted) return null;
  // ONE person, two addresses — and the menu is almost never filed under the
  // one you are about to answer from. Observed live: a company's menu arrived
  // on their LID (`1049…@lid`, the row the ledger keys the thread by) and the
  // agent answered the PHONE number it had originally written to. Comparing the
  // raw address found no offer, the choice went out as typed text instead of a
  // button, and the bot replied "no te entendí". The credential store knows the
  // pair (aliases.js), and rows also carry the contact key the roster resolved,
  // so both are accepted here.
  const addresses = new Set(addressesFor(wanted));
  let rows = [];
  try {
    rows = readGlobalMessages({ channel: CHANNELS.WHATSAPP, limit }) || [];
  } catch {
    return null;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.direction !== "in") continue;
    const chat = normalizeJid(r.meta?.chat_jid);
    const key = normalizeJid(r.meta?.contact_key);
    if (!addresses.has(chat) && !(key && addresses.has(key))) continue;
    const options = r.meta?.interactive_options;
    if (!Array.isArray(options) || !options.length) continue;
    return {
      kind: r.meta.interactive_kind || "buttons",
      options,
      // WHERE it was offered. A button reply belongs in the chat that showed
      // the buttons, which is not necessarily the address the caller named.
      chat_jid: chat || wanted,
      message_id: r.meta?.external_id || r.external_id || null,
      ts: r.ts || null,
    };
  }
  return null;
}

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Which option did the caller mean?
 *
 * Four ways to name one, in falling order of certainty: its number, its exact
 * id, its exact title, then a containment match either way round. The loose
 * pass is last and only accepted when exactly ONE option matches — "seguros"
 * against a menu of five insurance products is an ambiguity, and guessing at it
 * would tap a button on somebody's behalf.
 */
export function matchOption(options = [], wanted) {
  const list = Array.isArray(options) ? options : [];
  const raw = String(wanted ?? "").trim();
  if (!list.length || !raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const hit = list.find((o) => Number(o.n) === n);
    if (hit) return hit;
  }
  const key = fold(raw);
  const byId = list.find((o) => fold(o.id) === key);
  if (byId) return byId;
  const byTitle = list.find((o) => fold(o.title) === key);
  if (byTitle) return byTitle;

  const loose = list.filter((o) => {
    const t = fold(o.title);
    return t && (t.includes(key) || key.includes(t));
  });
  return loose.length === 1 ? loose[0] : null;
}

/**
 * How to answer this menu on the wire.
 *
 * Baileys can build the exact proto for three of the four generations
 * (`buttonsResponseMessage`, `templateButtonReplyMessage`,
 * `listResponseMessage`) — for those, a real tap is what leaves. It has NO
 * builder for nativeFlow's `interactiveResponseMessage`, so an `interactive`
 * menu is answered by typing the option's label, which is what a person does
 * when the button will not open and what every bot's NLU is written to accept.
 * A poll is the same: casting a vote is a different protocol, not a message.
 */
export function replyModeFor(kind) {
  return kind === "buttons" || kind === "template" || kind === "list" ? "native" : "text";
}
