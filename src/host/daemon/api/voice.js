// Daemon HTTP routes for the unified "voice" channel.
//
//   POST /voice/turn  { audio?: <base64 or path>, format?, text?, agent?,
//                        channel?, provider?, voice?, language?,
//                        previousMessages? }
//                     → { user_text, reply_text, reply_audio_path,
//                          reply_duration_s, reply_mime, provider,
//                          conversation_id? }
//
// Conceptually a single bidirectional turn:
//   1. STT on the incoming audio (or use `text` if provided directly).
//   2. Run the APX default agent (super-agent mode) — or an explicit agent
//      slug — on the transcribed text.
//   3. TTS on the reply text → playable audio file.
//
// Channel/agent surfaces (Telegram plugin, overlay) can keep their own
// pipelines, but they should delegate here when they want a hablada reply.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { readConfig } from "../../../core/config.js";
import { synthesize } from "../../../core/voice/tts.js";
import { transcribe } from "../transcription.js";
import { runSuperAgent, isSuperAgentEnabled } from "../super-agent.js";
import { appendErrorTrace, previewText } from "../../../core/logging.js";

async function decodeAudioInput({ audio, format = "webm" }) {
  if (!audio) return null;
  // A short string that starts with "/" and exists on disk is treated as a
  // path. Anything else is interpreted as base64 (optionally with a data:
  // prefix).
  if (
    typeof audio === "string" &&
    audio.length < 1024 &&
    audio.startsWith("/") &&
    fs.existsSync(audio)
  ) {
    return { path: audio, cleanup: false };
  }
  let b64 = audio;
  const m = /^data:[^;]+;base64,(.+)$/.exec(b64);
  if (m) b64 = m[1];
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw new Error("voice/turn: decoded audio is empty");
  const ext = String(format || "webm").replace(/^\./, "");
  const tmp = path.join(os.tmpdir(), `apx-voice-${Date.now()}-${randomUUID()}.${ext}`);
  fs.writeFileSync(tmp, buf);
  return { path: tmp, cleanup: true };
}

export function register(app, { projects, plugins, registries }) {
  app.post("/voice/turn", async (req, res) => {
    const body = req.body || {};
    const cfg = readConfig();
    let userText = (body.text || "").trim();
    let decoded = null;

    try {
      // ── 1. STT (skip if caller already gave us text) ─────────────────
      if (!userText) {
        decoded = await decodeAudioInput({
          audio: body.audio,
          format: body.format,
        });
        if (!decoded) {
          return res.status(400).json({ error: "audio or text required" });
        }
        const sttResult = await transcribe(decoded.path, {
          language:
            body.language && body.language !== "auto" ? body.language : undefined,
        });
        userText = (sttResult.text || "").trim();
      }
      if (!userText) {
        return res.json({
          user_text: "",
          reply_text: "",
          reply_audio_path: null,
          provider: null,
          empty: true,
        });
      }

      // ── 2. Agent reply ───────────────────────────────────────────────
      let replyText = "";
      const previousMessages = Array.isArray(body.previousMessages)
        ? body.previousMessages
        : [];
      const channel = body.channel || "voice";

      if (isSuperAgentEnabled(cfg)) {
        try {
          const result = await runSuperAgent({
            globalConfig: cfg,
            projects,
            plugins,
            registries,
            prompt: userText,
            contextNote: `Channel: ${channel}\nThe user spoke this through a voice channel — reply concisely and naturally; the response will be read aloud.`,
            previousMessages,
          });
          replyText = (result?.text || "").trim();
        } catch (e) {
          appendErrorTrace({
            trace_id: req.apxTraceId,
            surface: "daemon_api",
            route: "POST /voice/turn",
            channel,
            error: { message: e.message, stack: e.stack },
            prompt_preview: previewText(userText),
          });
          return res.status(500).json({
            user_text: userText,
            reply_text: "",
            error: `agent failed: ${e.message}`,
          });
        }
      } else {
        // No super-agent configured: still useful as a STT+TTS echo.
        replyText = userText;
      }

      // ── 3. TTS on the reply ──────────────────────────────────────────
      let tts = { audio_path: null, duration_s: null, mime: null, provider: null };
      if (replyText) {
        try {
          tts = await synthesize({
            text: replyText,
            voice: body.voice,
            language: body.language,
            provider: body.provider,
            format: body.format_out,
            globalConfig: cfg,
          });
        } catch (e) {
          // Don't fail the whole turn just because TTS broke; return text.
          tts = {
            audio_path: null,
            duration_s: null,
            mime: null,
            provider: null,
            error: e.message,
          };
        }
      }

      res.json({
        user_text: userText,
        reply_text: replyText,
        reply_audio_path: tts.audio_path,
        reply_duration_s: tts.duration_s,
        reply_mime: tts.mime,
        provider: tts.provider,
        tts_error: tts.error || undefined,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      if (decoded?.cleanup) {
        try {
          fs.unlinkSync(decoded.path);
        } catch {
          /* ignore */
        }
      }
    }
  });
}

// Note for plugin authors:
//   Overlay (src/host/daemon/plugins/overlay.js) and Telegram
//   (src/host/daemon/plugins/telegram.js) currently implement their own
//   STT → agent → render pipelines. To get spoken replies via APX they can
//   POST to /voice/turn (or call `synthesize()` directly) instead of
//   re-implementing TTS. This module intentionally does NOT migrate them —
//   it only exposes the unified channel.
