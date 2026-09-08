// Inbound WhatsApp media → what a turn can actually use.
//
// Same contract as the Telegram inbound handlers next door (`{ text,
// attachment, media }`): audio becomes a transcript folded into the text,
// pixels become an `attachment` a multimodal engine renders and everything else
// ignores, and every branch leaves a marker in the text so a turn is NEVER
// silent about something having arrived. A message whose only content was a
// photo must not produce an empty prompt.
//
// What differs from Telegram, and why this file exists rather than a shared one:
//
//   - The bytes come off the socket, not a URL, so `download` is injected. That
//     also makes every branch testable without a WhatsApp session.
//   - Stickers are a first-class message type here and carry meaning. They get
//     a lexicon (./stickers.js) instead of being described from scratch.
//   - A GIF is not a type. WhatsApp ships GIFs as `videoMessage` with
//     `gifPlayback: true`, so the ONE flag is what separates "a short loop we
//     can look at" from "a video we do not handle". Reading the type alone gets
//     this wrong in both directions.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { transcribe } from "#core/voice/transcription.js";
import { envWithPath } from "#core/util/path-env.js";
import { APX_HOME } from "#core/config/paths.js";
import { recallSticker, learnSticker, touchSticker, keepStickerFile } from "./stickers.js";

const run = promisify(execFile);

export function whatsappMediaDir() {
  const dir = path.join(APX_HOME, "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Which of the kinds we handle is this, and where is its node?
 *
 * Returns null for a plain text message and for anything we deliberately do not
 * touch. `gif` is deliberately resolved BEFORE `video`: a GIF that fell through
 * to the video branch would be refused as unsupported, and a video that fell
 * through to the GIF branch would be watched.
 */
export function classifyMessage(message = {}) {
  // A reaction is not media and not a message: it is a mark somebody put ON a
  // message. It arrived here as nothing at all, so the body fell through to
  // "[empty message]" and the agent, reasonably, asked what had been sent —
  // observed live when the owner hearted a reply and got "me llegó vacío" back.
  if (message.reactionMessage) return { kind: "reaction", node: message.reactionMessage };
  if (message.imageMessage) return { kind: "image", node: message.imageMessage };
  if (message.audioMessage) return { kind: "audio", node: message.audioMessage };
  if (message.stickerMessage) return { kind: "sticker", node: message.stickerMessage };
  if (message.videoMessage) {
    return message.videoMessage.gifPlayback
      ? { kind: "gif", node: message.videoMessage }
      : { kind: "video", node: message.videoMessage };
  }
  if (message.documentMessage) return { kind: "document", node: message.documentMessage };
  return null;
}

const IMAGE_MIME = {
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".heic": "image/heic", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};
const mimeFromPath = (p) => IMAGE_MIME[path.extname(p).toLowerCase()] || "image/jpeg";

function attachmentFrom(localPath) {
  try {
    return {
      kind: "image",
      mime: mimeFromPath(localPath),
      data: fs.readFileSync(localPath).toString("base64"),
      path: localPath,
    };
  } catch {
    return null;
  }
}

/**
 * One still frame, for the things that move.
 *
 * An animated WebP sticker and a GIF-as-MP4 are both sequences, and handing a
 * sequence to a vision model is a coin flip: some decode the first frame, some
 * refuse the container, some read the last frame. One explicit frame is the
 * only version that behaves the same everywhere.
 *
 * Returns null when ffmpeg is missing or fails — a still is an upgrade, and
 * losing the message because the upgrade failed is not acceptable. ffmpeg is
 * reached through envWithPath() because a launchd-booted daemon has no Homebrew
 * on its PATH (core/util/path-env.js).
 */
export async function firstFrame(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  const target = path.join(
    whatsappMediaDir(),
    `${path.basename(sourcePath, path.extname(sourcePath))}-frame.jpg`
  );
  try {
    await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
       "-frames:v", "1", "-f", "image2", target],
      { env: envWithPath(), timeout: 30_000 }
    );
  } catch {
    return null;
  }
  return fs.existsSync(target) && fs.statSync(target).size > 0 ? target : null;
}

/**
 * Turn one inbound WhatsApp message into text + (optionally) pixels.
 *
 * @param {object} message  the Baileys `message` object
 * @param {object} deps
 *   download(node, kind) → Promise<string localPath>   bytes off the socket
 *   describeImage(localPath) → Promise<string|null>    vision, for learning stickers
 *   transcribeAudio(localPath) → Promise<{text,...}>   defaults to core STT
 *   log(msg), from                                     context only
 *   audience: "owner" | "third_party"                  who reads the marker
 * @returns {Promise<{text, attachment, media, kind}>}
 */
export async function resolveInboundMedia(message, deps = {}) {
  const {
    download,
    describeImage = null,
    transcribeAudio = transcribe,
    log = () => {},
    from = "",
    // Markers are written INTO the prompt, so they are subject to the same rule
    // as everything else a third party's turn is told. A local path names the
    // owner's home directory and username, and a model asked "where did you
    // save my photo?" will happily read it out. The file still goes in
    // `media.meta`, which is stored rather than spoken.
    audience = "owner",
  } = deps;
  const showPaths = audience !== "third_party";

  const hit = classifyMessage(message);
  if (!hit) return { text: "", attachment: null, media: null, kind: null };
  const { kind, node } = hit;
  const caption = String(node.caption || "").trim();

  // Reactions carry no bytes and need no turn — see the dispatch. Rendered so
  // the thread reads like the conversation actually went.
  if (kind === "reaction") {
    const emoji = String(node.text || "").trim();
    return {
      kind,
      attachment: null,
      // An empty `text` is how WhatsApp says a reaction was REMOVED.
      text: emoji ? `[reaccionó ${emoji}]` : "[quitó su reacción]",
      media: { kind: "reaction", meta: { emoji, to_id: node.key?.id || null } },
    };
  }

  // Refused before anything is downloaded: a video we will not look at is not
  // worth the bytes, the disk or the wait.
  if (kind === "video") {
    return {
      kind,
      attachment: null,
      media: { kind: "video", meta: { supported: false, seconds: node.seconds ?? null } },
      text: join(
        "[video — I can't watch videos, so I don't know what's in this one]",
        caption
      ),
    };
  }

  if (kind === "document") {
    const name = node.fileName || "file";
    return {
      kind,
      attachment: null,
      media: { kind: "document", meta: { file_name: name, mime_type: node.mimetype || null } },
      text: join(`[document: ${name} — not opened]`, caption),
    };
  }

  let localPath = null;
  try {
    localPath = await download(node, kind);
  } catch (e) {
    log(`whatsapp media download failed (${kind}): ${e.message}`);
  }

  if (kind === "audio") {
    let transcript = "";
    let error = null;
    let backend = null;
    if (localPath) {
      try {
        const r = await transcribeAudio(localPath);
        transcript = r?.text || "";
        backend = r?.backend || null;
      } catch (e) {
        error = e.message;
        log(`whatsapp transcription failed: ${e.message}`);
      }
    }
    // The marker says an audio arrived even when we could not hear it, so the
    // agent answers the person instead of answering nothing.
    // The error string is whatever the STT backend threw, and those routinely
    // quote the file they choked on — so it is owner-only for the same reason
    // the path markers are.
    const body = transcript
      ? `[audio] ${transcript}`
      : `[audio — I couldn't hear this one${error && showPaths ? ": " + error : ""}]`;
    return {
      kind,
      attachment: null,
      text: join(body, caption),
      media: {
        kind: node.ptt ? "voice" : "audio",
        meta: {
          local_path: localPath,
          seconds: node.seconds ?? null,
          mime_type: node.mimetype || null,
          transcription_backend: backend,
          transcription_error: error,
        },
      },
    };
  }

  if (kind === "image") {
    const attachment = localPath ? attachmentFrom(localPath) : null;
    const marker = localPath
      ? (showPaths ? `[image attached — saved to ${localPath}]` : "[image attached]")
      : "[image attached — the download failed, there is no local copy]";
    return {
      kind,
      attachment,
      text: join(marker, caption),
      media: {
        kind: "photo",
        meta: { local_path: localPath, width: node.width ?? null, height: node.height ?? null },
      },
    };
  }

  if (kind === "gif") {
    // Animated, so a still is what a vision model can actually read.
    const framePath = localPath ? await firstFrame(localPath) : null;
    const attachment = framePath ? attachmentFrom(framePath) : null;
    const marker = attachment
      ? (showPaths ? `[gif — looking at its first frame, saved to ${framePath}]` : "[gif — looking at its first frame]")
      : "[gif — I couldn't get a frame out of it]";
    return {
      kind,
      attachment,
      text: join(marker, caption),
      media: {
        kind: "gif",
        meta: { local_path: localPath, frame_path: framePath, seconds: node.seconds ?? null },
      },
    };
  }

  // kind === "sticker"
  return resolveSticker({ node, localPath, describeImage, log, from });
}

async function resolveSticker({ node, localPath, describeImage, log, from }) {
  const sha = node.fileSha256;
  const known = recallSticker(sha);

  // Seen before: reuse the words we already have. No download to read, no
  // vision call, and — the part that matters — the SAME description as last
  // time, so the history stays coherent.
  if (known) {
    // Still take the bytes if we do not have them yet. Anything learned before
    // the library existed would otherwise be understood forever and sendable
    // never: the recall path is the ONLY path a known sticker takes, so a file
    // kept only on first sight is a file never kept for them.
    keepStickerFile(sha, localPath);
    touchSticker(sha, { from });
    return {
      kind: "sticker",
      attachment: null,
      text: `[sticker: ${known.meaning}]`,
      media: { kind: "sticker", meta: { local_path: localPath, learned: true, meaning: known.meaning } },
    };
  }

  // New one: look at it once, write down what it is, and never pay for it again.
  let meaning = null;
  if (localPath && typeof describeImage === "function") {
    // An animated sticker is a sequence; flatten it the same way a GIF is.
    const still = node.isAnimated ? (await firstFrame(localPath)) || localPath : localPath;
    try {
      meaning = await describeImage(still);
    } catch (e) {
      log(`whatsapp sticker description failed: ${e.message}`);
    }
  }

  if (meaning) {
    // The bytes are kept BEFORE the description is written down, so a lexicon
    // entry never claims a file that is not there.
    keepStickerFile(node.fileSha256, localPath);
    learnSticker(sha, meaning, { source: "vision", from });
    return {
      kind: "sticker",
      attachment: null,
      text: `[sticker: ${String(meaning).trim()}]`,
      media: { kind: "sticker", meta: { local_path: localPath, learned: true, meaning } },
    };
  }

  // Unlearnable this time. Still say a sticker arrived: silence would read as
  // the message never having been sent.
  return {
    kind: "sticker",
    attachment: null,
    text: "[sticker — I can't tell what this one shows]",
    media: { kind: "sticker", meta: { local_path: localPath, learned: false } },
  };
}

const join = (marker, caption) => (caption ? `${marker} ${caption}` : marker);
