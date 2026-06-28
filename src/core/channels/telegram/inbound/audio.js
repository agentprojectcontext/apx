// Inbound Telegram VOICE/AUDIO handling, split out of dispatch.js. Telegram
// sends `voice` for the press-and-hold mic recording (.oga/opus) and `audio`
// for uploaded audio files (mp3/m4a/etc.). Either way we download, run it
// through Whisper, prefix the result with `[audio] ` and let the rest of the
// message flow handle it as plain text.
//
// Takes the poller instance (`self`, for logging, channel + the typing
// indicator) plus the parsed update context, and returns the `text` the rest of
// the pipeline should run — the transcript merged into any existing caption.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { transcribe as transcribeAudioFile } from "#core/voice/transcription.js";
import { resolveBotToken, telegramMediaDir } from "../helpers.js";
import { downloadTelegramFile } from "../media.js";

/**
 * @param {object} self  poller instance (uses self.log, self.channel, self._startTyping)
 * @param {object} ctx   { msg, u, author, chat_id, text, incomingAudio }
 * @returns {Promise<{ text: string }>}  text to continue the pipeline with
 */
export async function handleIncomingAudio(self, { msg, u, author, chat_id, text, incomingAudio }) {
  const token = resolveBotToken(self.channel);
  const mediaDir = telegramMediaDir();

  // Show "typing…" right away — download + transcription is the slow part of a
  // voice message, and the reply-path typing only starts after it, so without
  // this the chat sits silent for seconds with no feedback.
  const stopVoiceTyping = self._startTyping(chat_id);
  let localPath = null;
  let transcript = "";
  let transcribeError = null;
  let transcribeBackend = null;
  try {
    localPath = await downloadTelegramFile(token, incomingAudio.file_id, mediaDir);
    self.log(`telegram[${self.channel.name}] audio saved: ${localPath}`);
  } catch (e) {
    self.log(`telegram[${self.channel.name}] audio download failed: ${e.message}`);
  }
  if (localPath) {
    try {
      const result = await transcribeAudioFile(localPath);
      transcript = result.text || "";
      transcribeBackend = result.backend;
      self.log(`telegram[${self.channel.name}] audio transcribed via ${transcribeBackend} (${transcript.length} chars, lang=${result.language || "?"})`);
    } catch (e) {
      transcribeError = e.message;
      self.log(`telegram[${self.channel.name}] audio transcription failed: ${e.message}`);
    }
  }
  stopVoiceTyping(); // reply-path typing takes over from here

  const audioBody = transcript
    ? `[audio] ${transcript}`
    : `[audio] (transcription unavailable${transcribeError ? ": " + transcribeError : ""})`;

  appendGlobalMessage({
    channel: CHANNELS.TELEGRAM,
    direction: "in",
    type: "audio",
    actor_id: msg.from?.id ? String(msg.from.id) : author,
    external_id: String(u.update_id),
    author,
    body: audioBody,
    meta: {
      chat_id,
      user_id: msg.from?.id || null,
      message_id: msg.message_id,
      tg_channel: self.channel.name,
      local_path: localPath,
      file_id: incomingAudio.file_id,
      duration: incomingAudio.duration,
      mime_type: incomingAudio.mime_type,
      transcription_backend: transcribeBackend,
      transcription_error: transcribeError,
    },
  });

  // Inject the transcribed text into `text` so the rest of the agent pipeline
  // treats it identically to a typed message. If there was a caption alongside
  // the audio, prepend the audio marker to it.
  return { text: text ? `${audioBody}\n${text}` : audioBody };
}
