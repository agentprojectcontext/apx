// Telegram media helpers: send photo/voice/document/audio + download a remote
// file. Auto-extracted from plugins/telegram/index.js — these used to live
// inline next to the poll loop and the super-agent dispatch.
//
// Each helper takes the bot token and chat id explicitly so they can be used
// from any code path (tests, other plugins, future agents). Buffer or
// absolute path input is accepted for media; for URLs the helpers pass them
// through to Telegram and let the API fetch them.
import fs from "node:fs";
import path from "node:path";

export const API_BASE = "https://api.telegram.org";

/**
 * Send a photo to a Telegram chat.
 * @param {string} token     Bot token
 * @param {string|number} chatId  Telegram chat_id
 * @param {string|Buffer} photo   Absolute file path OR Buffer of image data
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.parse_mode]  "HTML" | "Markdown" | "MarkdownV2"
 */
export async function sendPhoto(token, chatId, photo, { caption, parse_mode } = {}) {
  const url = `${API_BASE}/bot${token}/sendPhoto`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (parse_mode) form.append("parse_mode", parse_mode);

  if (typeof photo === "string" && photo.startsWith("http")) {
    // Public URL — send as string
    form.append("photo", photo);
  } else {
    // Local file path or Buffer
    const buf = Buffer.isBuffer(photo) ? photo : fs.readFileSync(photo);
    const name = typeof photo === "string" ? path.basename(photo) : "photo.jpg";
    const blob = new Blob([buf], { type: name.endsWith(".png") ? "image/png" : "image/jpeg" });
    form.append("photo", blob, name);
  }

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendPhoto failed: ${json.description || res.status}`);
  return json.result;
}

/**
 * Send a voice message (OGG/Opus preferred by Telegram).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} audio  Path or Buffer
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {number} [opts.duration]
 */
export async function sendVoice(token, chatId, audio, { caption, duration } = {}) {
  const url = `${API_BASE}/bot${token}/sendVoice`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (duration) form.append("duration", String(duration));

  const buf = Buffer.isBuffer(audio) ? audio : fs.readFileSync(audio);
  const name = typeof audio === "string" ? path.basename(audio) : "voice.ogg";
  const blob = new Blob([buf], { type: "audio/ogg" });
  form.append("voice", blob, name);

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendVoice failed: ${json.description || res.status}`);
  return json.result;
}

/**
 * Send an audio file (MP3, M4A, etc — shown in Telegram music player).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} audio  Path or Buffer
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.title]
 * @param {string} [opts.performer]
 */
/**
 * Send any file as a Telegram document (PDF, zip, txt, etc).
 * @param {string} token
 * @param {string|number} chatId
 * @param {string|Buffer} document  Path or Buffer of document data
 * @param {object} [opts]
 * @param {string} [opts.caption]
 * @param {string} [opts.filename] override filename for Buffer input
 * @param {string} [opts.mime_type]
 */
export async function sendDocument(token, chatId, document, { caption, filename, mime_type } = {}) {
  const url = `${API_BASE}/bot${token}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);

  // URL string → let Telegram fetch it
  if (typeof document === "string" && /^https?:\/\//.test(document)) {
    form.append("document", document);
  } else {
    const buf = Buffer.isBuffer(document) ? document : fs.readFileSync(document);
    const name =
      filename ||
      (typeof document === "string" ? path.basename(document) : "document.bin");
    const blob = new Blob([buf], { type: mime_type || "application/octet-stream" });
    form.append("document", blob, name);
  }

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendDocument failed: ${json.description || res.status}`);
  return json.result;
}

export async function sendAudio(token, chatId, audio, { caption, title, performer } = {}) {
  const url = `${API_BASE}/bot${token}/sendAudio`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  if (title) form.append("title", title);
  if (performer) form.append("performer", performer);

  const buf = Buffer.isBuffer(audio) ? audio : fs.readFileSync(audio);
  const name = typeof audio === "string" ? path.basename(audio) : "audio.mp3";
  const blob = new Blob([buf], { type: "audio/mpeg" });
  form.append("audio", blob, name);

  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`sendAudio failed: ${json.description || res.status}`);
  return json.result;
}

// Audio transcription is delegated to the central dispatcher
// (../transcription.js) which handles local (faster-whisper via Python) +
// OpenAI cloud fallback. See that module for config keys.

/**
 * Download a file from Telegram servers.
 * Returns the local file path where it was saved.
 */
export async function downloadTelegramFile(token, fileId, destDir) {
  // Step 1: get file path from Telegram
  const infoRes = await fetch(`${API_BASE}/bot${token}/getFile?file_id=${fileId}`);
  const infoJson = await infoRes.json();
  if (!infoJson.ok) throw new Error(`getFile failed: ${infoJson.description}`);
  const filePath = infoJson.result.file_path; // e.g. "photos/file_123.jpg"
  const ext = path.extname(filePath) || ".jpg";
  const fileName = `tg_${fileId.slice(-8)}_${Date.now()}${ext}`;
  const localPath = path.join(destDir, fileName);

  // Step 2: download
  const dlRes = await fetch(`${API_BASE}/file/bot${token}/${filePath}`);
  if (!dlRes.ok) throw new Error(`download failed: ${dlRes.status}`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  return localPath;
}

