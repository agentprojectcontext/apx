// Inbound Telegram FILES: document, video, video_note, animation.
//
// Same shape as ./photo.js and ./audio.js — take the poller (`self`) plus the
// parsed update, download and archive the file, and return the (rewritten)
// `text` the rest of the pipeline runs with.
//
// Why this exists: dispatch only recognised photo and voice/audio. Every other
// attachment fell through to `text = msg.caption || ""`, and a file sent with
// no caption produced an EMPTY text — so the turn was dropped and the bot said
// nothing at all. A user who sends a file and gets silence cannot tell the
// difference between "not supported" and "broken".
//
// The reply is model-authored, as everywhere else: the marker states what
// arrived and where it landed, and the agent puts that in its own words. No
// canned "file received" string.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { resolveBotToken, telegramMediaDir } from "../helpers.js";
import { downloadTelegramFile } from "../media.js";

/**
 * The attachment kinds handled here, in the order Telegram nests them. A
 * `video_note` (the round selfie clip) has no file_name; a `document` usually
 * does and it is the one worth preserving.
 */
const FILE_KINDS = [
  { key: "document", label: "document", type: "document" },
  { key: "video", label: "video", type: "video" },
  { key: "video_note", label: "video note", type: "video" },
  { key: "animation", label: "animation (GIF)", type: "animation" },
];

/** The first file-like attachment on a message, or null. */
export function detectIncomingFile(msg) {
  for (const kind of FILE_KINDS) {
    const file = msg?.[kind.key];
    if (file?.file_id) return { ...kind, file };
  }
  return null;
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {object} self  poller instance (uses self.log, self.channel)
 * @param {object} ctx   { msg, u, author, chat_id, text, incoming }
 * @returns {Promise<{ text: string }>}
 */
export async function handleIncomingFile(self, { msg, u, author, chat_id, text, incoming }) {
  const { file, label, type } = incoming;
  const token = resolveBotToken(self.channel);
  const mediaDir = telegramMediaDir();
  const declaredName = file.file_name || "";

  let localPath = null;
  let failure = "";
  try {
    localPath = await downloadTelegramFile(token, file.file_id, mediaDir, {
      preferredName: declaredName,
    });
    self.log(`telegram[${self.channel.name}] ${label} saved: ${localPath}`);
  } catch (e) {
    failure = e.message;
    // Telegram refuses getFile over 20 MB for bots; say which failure it was
    // rather than leaving the agent to guess.
    self.log(`telegram[${self.channel.name}] ${label} download failed: ${e.message}`);
  }

  // Archive regardless of download outcome, so the history records the file
  // even when the fetch failed.
  appendGlobalMessage({
    channel: CHANNELS.TELEGRAM,
    direction: "in",
    type,
    actor_id: msg.from?.id ? String(msg.from.id) : author,
    external_id: String(u.update_id),
    author,
    body: text || `[${label}]`,
    meta: {
      chat_id,
      user_id: msg.from?.id || null,
      message_id: msg.message_id,
      tg_channel: self.channel.name,
      local_path: localPath,
      file_id: file.file_id,
      file_name: declaredName || null,
      mime_type: file.mime_type || null,
      file_size: file.file_size || null,
      duration: file.duration || null,
    },
  });

  const bits = [declaredName || label];
  const size = humanSize(file.file_size);
  if (size) bits.push(size);
  if (file.mime_type) bits.push(file.mime_type);
  const marker = localPath
    ? `[${label} received: ${bits.join(", ")} — saved to ${localPath}. You can open it with your file tools.]`
    : `[${label} received: ${bits.join(", ")} — the download FAILED (${failure || "unknown error"}), so there is no local copy. Say so; files over 20 MB cannot be fetched by a bot.]`;

  return { text: text ? `${marker} ${text}` : marker };
}
