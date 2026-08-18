// Inbound Telegram PHOTO handling, split out of dispatch.js so the dispatcher
// stays focused on routing. Pure of the poller's lifecycle: it takes the poller
// instance (`self`, for logging + channel) plus the parsed update context, and
// returns the (possibly rewritten) `text` the rest of the pipeline should run.
//
// Vision: the photo is downloaded, archived, and returned as an `attachment`
// that dispatch threads onto the turn. A multimodal engine (Gemini) receives it
// as real image content; engines without vision ignore it and still get the
// `[image]` marker, which names the local path so the agent can reach the file
// with its tools. The marker also guarantees a no-caption photo never produces
// an empty turn — the reply is always model-authored, never canned. Mirrors the
// `[audio]` marker convention.
//
// The record itself is written by dispatch, once per update: this handler used
// to append its own row while also rewriting `text`, so a photo turn was stored
// twice. It now hands the file metadata back instead.
import fs from "node:fs";
import path from "node:path";
import { resolveBotToken, telegramMediaDir } from "../helpers.js";
import { downloadTelegramFile } from "../media.js";

/**
 * @param {object} self  poller instance (uses self.log, self.channel)
 * @param {object} ctx   { msg, text }
 * @returns {Promise<{ text: string, attachment: object|null, media: object }>}
 *   text to continue the pipeline with, the pixels for a multimodal engine, and
 *   what was archived for the inbound record
 */
export async function handleIncomingPhoto(self, { msg, text }) {
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

  // Hand the pixels to the turn. A multimodal engine (Gemini) renders them as
  // an inlineData part; the others ignore the field and still have the marker
  // and the path, so nothing regresses for them.
  let attachment = null;
  if (localPath) {
    try {
      attachment = {
        kind: "image",
        mime: mimeFromPath(localPath),
        data: fs.readFileSync(localPath).toString("base64"),
        path: localPath,
      };
    } catch (e) {
      self.log(`telegram[${self.channel.name}] photo read-back failed: ${e.message}`);
    }
  }

  // Guard: never go silent. The marker states what arrived and where it is,
  // and stays neutral about visibility — a vision model can describe the image
  // it was given, and one without it still has the path and its file tools.
  const marker = localPath
    ? `[image attached — saved to ${localPath}]`
    : "[image attached — the download failed, there is no local copy]";
  return {
    text: text ? `${marker} ${text}` : marker,
    attachment,
    // Reported regardless of download outcome, so the stored turn records what
    // arrived even when the fetch failed.
    media: {
      kind: "photo",
      meta: {
        local_path: localPath,
        file_id: bestPhoto.file_id,
        width: bestPhoto.width,
        height: bestPhoto.height,
      },
    },
  };
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic") return "image/heic";
  return "image/jpeg";
}
