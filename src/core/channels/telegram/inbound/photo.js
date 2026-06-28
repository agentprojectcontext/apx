// Inbound Telegram PHOTO handling, split out of dispatch.js so the dispatcher
// stays focused on routing. Pure of the poller's lifecycle: it takes the poller
// instance (`self`, for logging + channel) plus the parsed update context, and
// returns the (possibly rewritten) `text` the rest of the pipeline should run.
//
// Vision note: we do NOT have image understanding yet — the engine layer can't
// pass image content to the model. So we download + archive the photo and then
// inject an internal `[image]` marker into `text` so the agent ALWAYS produces a
// reply in its own words (never goes silent on a no-caption photo). The reply is
// model-authored; the marker only tells the model an image arrived and that it
// can't see the pixels yet. Mirrors the `[audio]` marker convention.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { resolveBotToken, telegramMediaDir } from "../helpers.js";
import { downloadTelegramFile } from "../media.js";

/**
 * @param {object} self  poller instance (uses self.log, self.channel)
 * @param {object} ctx   { msg, u, author, chat_id, text }
 * @returns {Promise<{ text: string }>}  text to continue the pipeline with
 */
export async function handleIncomingPhoto(self, { msg, u, author, chat_id, text }) {
  // Telegram sends multiple sizes; pick the largest.
  const bestPhoto = msg.photo.reduce((a, b) => (b.file_size > a.file_size ? b : a));
  const token = resolveBotToken(self.channel);
  const mediaDir = telegramMediaDir();

  let localPath = null;
  try {
    localPath = await downloadTelegramFile(token, bestPhoto.file_id, mediaDir);
    self.log(`telegram[${self.channel.name}] photo saved: ${localPath}`);
  } catch (e) {
    self.log(`telegram[${self.channel.name}] photo download failed: ${e.message}`);
  }

  // Archive the inbound photo regardless of download outcome, so chat history
  // records it even if the file fetch failed.
  appendGlobalMessage({
    channel: CHANNELS.TELEGRAM,
    direction: "in",
    type: "photo",
    actor_id: msg.from?.id ? String(msg.from.id) : author,
    external_id: String(u.update_id),
    author,
    body: text || "[photo]",
    meta: {
      chat_id,
      user_id: msg.from?.id || null,
      message_id: msg.message_id,
      tg_channel: self.channel.name,
      local_path: localPath,
      file_id: bestPhoto.file_id,
      width: bestPhoto.width,
      height: bestPhoto.height,
    },
  });

  // Guard: never go silent. Hand the agent an internal marker so it replies in
  // its own words. No vision yet → say so, in-band, so the model doesn't
  // hallucinate "seeing" the image.
  const marker = "[image attached — you cannot see its contents yet]";
  return { text: text ? `${marker} ${text}` : marker };
}
