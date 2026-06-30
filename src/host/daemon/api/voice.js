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
//
// Domain logic (channel context, suggestion parsing, audio decoding) lives in
// core/. This file is just glue: parse request → call core → format response.
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "#core/config/index.js";
import { synthesize } from "#core/voice/tts.js";
import { transcribe } from "#core/voice/transcription.js";
import { decodeAudioInput } from "#core/voice/audio-decode.js";
import { runSuperAgent, isSuperAgentEnabled } from "#core/agent/super-agent.js";
import { buildVoiceChannelContext } from "#core/agent/channels/voice-context.js";
import { extractSuggestions } from "#core/agent/suggestions.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { appendErrorTrace, previewText } from "#core/logging.js";

export function register(app, { projects, plugins, registries }) {
  // GET /voice/tts?path=<abs>
  //
  // Streams a TTS audio file back to the caller. Sandboxed to the
  // ~/.apx/tmp/tts directory so a client can't request arbitrary
  // filesystem paths through a manifest-leaked reply_audio_path.
  app.get("/voice/tts", async (req, res) => {
    const rawPath = String(req.query.path || "");
    if (!rawPath) return res.status(400).json({ error: "path required" });
    try {
      const os = await import("node:os");
      const ttsRoot = path.resolve(os.homedir(), ".apx", "tmp", "tts");
      const resolved = path.resolve(rawPath);
      if (!resolved.startsWith(ttsRoot + path.sep)) {
        return res.status(403).json({ error: "path outside tts dir" });
      }
      if (!fs.existsSync(resolved)) return res.status(404).json({ error: "not found" });
      const ext = path.extname(resolved).toLowerCase();
      const mime =
        ext === ".wav" ? "audio/wav" :
        ext === ".mp3" ? "audio/mpeg" :
        ext === ".m4a" || ext === ".aac" ? "audio/mp4" :
        ext === ".ogg" || ext === ".opus" ? "audio/ogg" :
        "application/octet-stream";
      res.setHeader("Content-Type", mime);
      // Cache for a minute — the client fetches each reply once anyway,
      // but a retry shouldn't re-hit disk if it's the same file.
      res.setHeader("Cache-Control", "private, max-age=60");
      fs.createReadStream(resolved).pipe(res);
    } catch (e) {
      res.status(500).json({ error: e?.message || "tts read failed" });
    }
  });

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

      let replyText = "";
      const previousMessages = Array.isArray(body.previousMessages)
        ? body.previousMessages
        : [];
      const channel = body.channel || "voice";
      let suggestions = [];
      let toolsUsed = [];

      const channelCtx = buildVoiceChannelContext(channel, {
        projectId: body.projectId,
        language: body.language && body.language !== "auto" ? body.language : "es",
      });

      if (isSuperAgentEnabled(cfg)) {
        try {
          const result = await runSuperAgent({
            globalConfig: cfg,
            projects,
            plugins,
            registries,
            prompt: userText,
            contextNote: channelCtx.contextNote,
            channel: channelCtx.channel || "",
            channelMeta: channelCtx.channelMeta || {},
            systemSuffix: channelCtx.systemSuffix,
            previousMessages,
          });
          const raw = (result?.text || "").trim();
          // Surface the tools the agent actually executed this turn so
          // the overlay can show "lo que APX hizo" instead of echoing
          // the transcript. Dedup by name (a list_tasks before+after
          // shows once) and map to a compact {name, summary} shape.
          if (Array.isArray(result?.trace)) {
            const seen = new Set();
            for (const t of result.trace) {
              const name = t?.tool;
              if (!name || seen.has(name)) continue;
              seen.add(name);
              toolsUsed.push({
                name,
                ok: !(t?.result && t.result.error),
              });
            }
          }
          if (channelCtx.wantsSuggestions) {
            const parsed = extractSuggestions(raw);
            replyText = parsed.cleanText;
            suggestions = parsed.suggestions;
            // Safety net: small models sometimes return ONLY the
            // suggestions block (no visible reply). Don't ship empty
            // text to TTS — synthesize a generic confirmation so the
            // user gets audible feedback that something happened.
            if (!replyText && raw) {
              replyText = suggestions.length ? "Listo." : raw;
            }
          } else {
            replyText = raw;
          }
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

      // Persist the turn to the cross-channel store (feeds RAG index,
      // search_messages, and the "active threads" block). channelCtx.channel is
      // the resolved surface ("deck"/"desktop"). Best-effort.
      try {
        const logCh = channelCtx.channel || channel;
        if (logCh && logCh !== "api") {
          appendGlobalMessage({ channel: logCh, direction: "in", type: "user", author: "user", body: userText });
          if (replyText) appendGlobalMessage({ channel: logCh, direction: "out", type: "agent", body: replyText });
        }
      } catch { /* best-effort */ }

      // ── 3. TTS on the reply ──────────────────────────────────────────
      let tts = { audio_path: null, duration_s: null, mime: null, provider: null };
      if (replyText) {
        try {
          tts = await synthesize({
            text: replyText,
            voice: body.voice,
            language: body.language,
            provider: body.provider,
            style: body.style,
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
        suggestions: suggestions.length ? suggestions : undefined,
        tools_used: toolsUsed.length ? toolsUsed : undefined,
        channel,
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
//   Desktop (src/host/daemon/plugins/desktop/index.js) and Telegram
//   (src/host/daemon/plugins/telegram/index.js) currently implement their own
//   STT → agent → render pipelines. To get spoken replies via APX they can
//   POST to /voice/turn (or call `synthesize()` directly) instead of
//   re-implementing TTS. This module intentionally does NOT migrate them —
//   it only exposes the unified channel.
