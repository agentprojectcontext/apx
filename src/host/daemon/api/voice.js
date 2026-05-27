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

// ── Voice intent classifier ────────────────────────────────────────
//
// A very small, regex-based router that catches a handful of "verb-y"
// utterances we want to short-circuit instead of sending to the LLM.
// Right now: "crear tarea ...", "creá tarea ...", "agregá una tarea ...",
// "nueva tarea ..." → POST to the project's tasks store directly.
//
// The classifier always returns either:
//   - { handled: false } → caller falls through to the super-agent
//   - { handled: true, reply: "...", meta?: {...} } → caller returns
//
// Keeping it dependency-free + sync lets us run it before any heavy
// work in the voice handler.
const TASK_INTENT_RE = new RegExp(
  // Optional polite preamble: "podés / por favor"
  "^\\s*(?:por favor|porfa|porfis|dale|che|apx)?[,!\\s]*" +
    // Either:
    //   (a) verb cluster + optional article + "tarea"
    //   (b) standalone "nueva|otra tarea" (no verb)
    "(?:" +
      // (a) verbs — with optional clitic pronouns (-me, -te, -le)
      "(?:crea[r]?|cre[áa]|agreg[áa](?:me|le)?|agreg[uú]e|sum[áa](?:me)?|" +
      "anot[áa](?:me)?|an[oó]tame|guard[áa](?:me)?|met[ée](?:me)?|" +
      "añad[íi]|añad[ée]|pone(?:me|le)?|recor[dáa]me)" +
      "\\s+(?:una|la|el|esta|ese|otra|otro)?\\s*" +
      "(?:tarea|task|pendiente|todo|to-do)" +
    "|" +
      // (b) "nueva tarea X" / "otra tarea X" without a verb
      "(?:nueva|otra|nuevo)\\s+(?:tarea|task|pendiente)" +
    ")" +
    // Optional connectors before the title
    "\\s+(?:que\\s+(?:diga|sea|es)|para|de|sobre|llamada|titulada|titul[áa]da|:|-|de:)?\\s*",
  "i"
);

function extractTaskTitle(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^[«"']|[«"'.,;:!?]+$/g, "");
  if (!cleaned) return null;
  const m = TASK_INTENT_RE.exec(cleaned);
  if (!m) return null;
  const title = cleaned.slice(m[0].length).trim().replace(/[.!?]+$/, "");
  if (!title) return null;
  return title;
}

function pickIntentProject({ projects, hintId }) {
  if (!projects?.list) return null;
  const list = projects.list();
  if (hintId !== undefined && hintId !== null) {
    const hit = list.find((p) => String(p.id) === String(hintId));
    if (hit) return hit;
  }
  // Prefer the first non-default real project; fall back to default.
  return list.find((p) => Number(p.id) !== 0) || list[0] || null;
}

async function tryVoiceTaskIntent({ projects, userText, hintProjectId }) {
  const title = extractTaskTitle(userText);
  if (!title) return { handled: false };
  const listEntry = pickIntentProject({ projects, hintId: hintProjectId });
  if (!listEntry) {
    return {
      handled: true,
      reply: "No hay proyectos APX registrados. Agregá uno con `apx project add` y volvé a intentar.",
    };
  }
  // projects.list() returns flat entries without storagePath; the
  // resolver returns the full record. We need that for the JSONL store.
  const project = projects.get(listEntry.id) || listEntry;
  if (!project?.storagePath) {
    return {
      handled: true,
      reply: `No pude crear la tarea: no encuentro el storage del proyecto ${project?.name || listEntry.name}.`,
    };
  }
  try {
    const { createTask } = await import("../../../core/tasks-store.js");
    const task = createTask(project.storagePath, {
      title,
      source: "voice",
    });
    // Resolver may strip the human-readable name; fall back to the
    // list entry which always has it.
    const displayName = project.name || listEntry.name || `proyecto #${project.id}`;
    return {
      handled: true,
      reply: `Listo. Anoté "${title}" en ${displayName}.`,
      meta: { task_id: task.id, project_id: project.id },
    };
  } catch (e) {
    return {
      handled: true,
      reply: `No pude crear la tarea: ${e.message || "error desconocido"}`,
    };
  }
}

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

      // ── 1.5 Intent classifier (regex short-circuits) ────────────────
      // Cheap pattern match for "creá una tarea X" style utterances —
      // we skip the LLM, create the task directly, and return a
      // confirmatory reply that still gets TTS'd. The app sends
      // `projectId` so we can target the active project; we fall back
      // to the first non-default project otherwise.
      const intentResult = await tryVoiceTaskIntent({
        projects,
        userText,
        hintProjectId: body.projectId,
      });
      let replyText = "";
      const previousMessages = Array.isArray(body.previousMessages)
        ? body.previousMessages
        : [];
      const channel = body.channel || "voice";

      let intentMeta = null;
      if (intentResult.handled) {
        replyText = intentResult.reply;
        intentMeta = intentResult.meta || null;
      } else if (isSuperAgentEnabled(cfg)) {
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
        intent: intentMeta || undefined,
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
