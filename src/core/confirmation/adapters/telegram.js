// Telegram confirmation adapter — async inline keyboard.
//
// Flow (why a Promise survives across two independent HTTP calls):
//
//   1. requestConfirmation() is called by the agent loop mid-tool-execution.
//      It creates a pending entry in the shared store, embeds the correlationId
//      in the button callback_data, sends the keyboard to Telegram, and returns
//      a Promise that is NOT yet resolved.
//
//   2. The agent loop is now suspended at `await requestConfirmation(...)`.
//      The Telegram bot's polling loop keeps running independently.
//
//   3. When the user taps a button, Telegram sends a callback_query update.
//      The plugin's _handleUpdate() routes it to handleCallbackQuery() here.
//
//   4. handleCallbackQuery() calls pendingStore.resolve(correlationId, value),
//      which finds the Promise's resolve function in the in-memory map and
//      calls it. The agent loop resumes with true or false.
//
// Idempotency: once the promise resolves the entry is removed from the store.
// Any subsequent tap on the same button won't find an entry and is a no-op.
//
// Post-restart stale buttons: if the process restarted after sending the
// keyboard but before the user tapped, pendingStore.wasKnown() detects the
// SQLite row with no memory entry and we show "Expirado" instead of an error.

const API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 60_000; // 60 s — long enough for a human, short enough to not block forever

/**
 * @param {{ token: string, chatId: string|number, pendingStore: ConfirmationPendingStore }} opts
 * @returns {{ requestConfirmation, handleCallbackQuery }}
 */
export function createTelegramConfirmAdapter({ token, chatId, pendingStore }) {
  async function requestConfirmation(tool, _args, description) {
    const { correlationId, promise } = pendingStore.create({ timeoutMs: TIMEOUT_MS });

    await sendConfirmKeyboard(token, chatId, description, correlationId, TIMEOUT_MS);

    return promise;
  }

  // Called by ChannelPoller._handleUpdate() when a callback_query arrives.
  // Returns true if the callback matched our pattern (consumed it), false otherwise.
  async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data || "";
    const match = data.match(/^apx:confirm:([a-f0-9]{16}):(yes|no)$/);
    if (!match) return false;

    const [, correlationId, answer] = match;
    const confirmed = answer === "yes";

    // ACK the callback immediately to clear the loading spinner on the button.
    // Fire-and-forget — a slow ACK is annoying but not fatal.
    await answerCallbackQuery(token, callbackQuery.id, confirmed ? "✅ Confirmed" : "❌ Cancelled");

    const resolved = pendingStore.resolve(correlationId, confirmed);

    // If not resolved, the entry timed out or the process restarted — show "Expired"
    // so the user knows the button is no longer actionable.
    const inlineKeyboard = resolved
      ? [[{ text: confirmed ? "✅ Confirmed" : "❌ Cancelled", callback_data: "apx:noop" }]]
      : [[{ text: "⏱ Expired", callback_data: "apx:noop" }]];

    if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
      await editMessageButtons(
        token,
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        inlineKeyboard
      );
    }

    return true;
  }

  return { requestConfirmation, handleCallbackQuery };
}

// ---------- Telegram API helpers --------------------------------------------

async function sendConfirmKeyboard(token, chatId, description, correlationId, timeoutMs) {
  const timeoutSec = Math.round(timeoutMs / 1000);
  await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text:
        `⚠️ *Confirm action*\n\n${escapeMarkdown(description)}\n\n` +
        `_Expires in ${timeoutSec}s. No response → cancelled._`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Yes", callback_data: `apx:confirm:${correlationId}:yes` },
          { text: "❌ No",  callback_data: `apx:confirm:${correlationId}:no` },
        ]],
      },
    }),
  });
}

async function answerCallbackQuery(token, callbackQueryId, text) {
  try {
    await fetch(`${API_BASE}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {
    // best-effort — Telegram gives only 30s to answer; after that it's already cleared
  }
}

async function editMessageButtons(token, chatId, messageId, inlineKeyboard) {
  try {
    await fetch(`${API_BASE}/bot${token}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  } catch {
    // best-effort
  }
}

// Escape Markdown special chars so description text doesn't break Telegram markup.
function escapeMarkdown(text) {
  return String(text || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
