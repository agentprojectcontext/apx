// Low-level Telegram Bot API client — the single place the raw JSON endpoints
// are called. Higher layers (the poller's send/typing/keyboard methods, the
// confirmation adapter, the ask flow) compose these instead of hand-rolling
// fetch boilerplate, so each endpoint's quirks live in exactly one spot. These
// used to be duplicated across the poller AND the confirm adapter.
//
// Every call is token-explicit (no channel/config coupling) so it's reusable
// from any surface — poller, adapter, routines, tests. Media uploads (multipart
// FormData) stay in ./media.js; this module owns the JSON endpoints.
import { API_BASE } from "./media.js";

/**
 * POST a JSON body to a Bot API method. Returns the parsed `result` on success;
 * throws on transport failure or a non-ok Telegram response. Best-effort callers
 * (typing, keyboard edits, callback acks) wrap this in their own try/catch.
 */
async function apiCall(token, method, body) {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.description || `${method} failed (${res.status})`);
  return json.result;
}

/** sendMessage: the plain text reply (optionally with an inline keyboard). */
export function sendMessage(token, chatId, { text, reply_markup, parse_mode } = {}) {
  const body = { chat_id: chatId, text };
  if (reply_markup) body.reply_markup = reply_markup;
  if (parse_mode) body.parse_mode = parse_mode;
  return apiCall(token, "sendMessage", body);
}

/** sendChatAction: the "typing…" indicator (auto-clears after ~5s). */
export function sendChatAction(token, chatId, action = "typing") {
  return apiCall(token, "sendChatAction", { chat_id: chatId, action });
}

/** editMessageReplyMarkup: swap/clear the inline keyboard on a sent message. */
export function editMessageReplyMarkup(token, chatId, messageId, reply_markup) {
  const body = { chat_id: chatId, message_id: messageId };
  if (reply_markup) body.reply_markup = reply_markup;
  return apiCall(token, "editMessageReplyMarkup", body);
}

/** answerCallbackQuery: clear the spinner on a tapped inline button (+ toast). */
export function answerCallbackQuery(token, callbackQueryId, text) {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  return apiCall(token, "answerCallbackQuery", body);
}

/** getUpdates: long-poll for inbound updates from a given offset. */
export async function getUpdates(token, { offset = 0, timeout = 25 } = {}) {
  const res = await fetch(`${API_BASE}/bot${token}/getUpdates?timeout=${timeout}&offset=${offset}`);
  if (!res.ok) throw new Error(`getUpdates ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "telegram error");
  return json.result || [];
}
