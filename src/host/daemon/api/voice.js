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

// ── Channel-aware pre-processor ────────────────────────────────────
//
// Each surface that talks to the super-agent (voice overlay on the
// deck, deck buttons, telegram, raw API) has different ergonomics:
// what the response will look like, how long it can be, whether the
// UI can render structured suggestions. `buildChannelContext` is the
// single place where those decisions live — voice.js passes the
// channel string from the request body and gets back the context
// note + system suffix to feed into the super-agent.
//
// The shape is intentionally tiny: contextNote becomes the
// `contextNote` field on the super-agent call (gets prepended to the
// prompt), systemSuffix is concatenated onto the system prompt to
// teach the model surface-specific output rules (e.g. trailing
// ```suggestions JSON block``` on voice/deck).
function buildChannelContext(channel, { projectId, language = "es" } = {}) {
  const base = {
    contextNote: "",
    systemSuffix: "",
    wantsSuggestions: false,
  };
  // Imperative project hint: weaker models otherwise ask "¿en qué
  // proyecto?" even when the active project is obvious from the
  // surface. Tell them to just use it.
  const projectHint = projectId
    ? `\nThe active project is id=${projectId}. For ANY task/note/list ` +
      `action, pass project_id=${projectId} automatically. Do NOT ask the ` +
      `user which project — they're already looking at it. Only use a ` +
      `different project if the user explicitly names one.`
    : "";
  // Hard language directive — without this the model defaults to its
  // training-bias English on short Spanish prompts, especially when
  // the user mixes English-ish product names ("aicrm").
  const langDirective = language === "es"
    ? "IMPORTANT: Reply ALWAYS in Spanish (rioplatense/Argentina). The user speaks Spanish."
    : `IMPORTANT: Reply in language "${language}".`;

  switch (channel) {
    case "voice":
      return {
        contextNote:
          `${langDirective}\n` +
          `Channel: voice. The user spoke this through the deck's voice overlay; ` +
          `your reply will be read aloud by a TTS engine. Keep it under two short ` +
          `sentences, no markdown, no bullet lists.${projectHint}`,
        systemSuffix: SUGGESTIONS_INSTRUCTION,
        wantsSuggestions: true,
      };
    case "deck":
      return {
        contextNote:
          `${langDirective}\n` +
          `Channel: deck. The user is on the cockpit dashboard. You can be ` +
          `slightly longer than voice but stay concise — the reply renders in a ` +
          `small card alongside action chips.${projectHint}`,
        systemSuffix: SUGGESTIONS_INSTRUCTION,
        wantsSuggestions: true,
      };
    case "telegram":
      return {
        contextNote:
          `${langDirective}\n` +
          `Channel: telegram. Reply in conversational tone; markdown is fine; ` +
          `length up to a short paragraph. No suggestion chips — the user has a ` +
          `keyboard.${projectHint}`,
        systemSuffix: "",
        wantsSuggestions: false,
      };
    default:
      return {
        ...base,
        contextNote: `${langDirective}\nChannel: ${channel || "api"}.${projectHint}`,
      };
  }
}

// Balanced suffix. An earlier, more aggressive version ("EJECUTA, no
// narres — LLAMÁ A LA TOOL") made Gemini call tools for EVERYTHING,
// even "hola" → it fired send_telegram("hola"). The rule below gates
// tool use on a *clear* action request and explicitly tells the model
// to just talk for chit-chat.
const SUGGESTIONS_INSTRUCTION = `

# Cuándo usar tools
SOLO llamá una tool cuando el usuario pide CLARAMENTE una acción
concreta: "creá una tarea …", "mandá un telegram …", "listá …",
"abrí …", "marcá como hecha …". En esos casos ejecutá la tool (no
digas "lo voy a hacer" — hacelo) y después confirmá en una frase corta
en castellano lo que YA hiciste.

Si el mensaje es un saludo, una pregunta, o charla ("hola", "cómo
andás", "qué podés hacer") NO llames ninguna tool: respondé en texto,
breve, en castellano.

Nunca llames la misma tool dos veces en el mismo turno.

# Sugerencias (opcional)
Al final, en su propia línea, podés agregar un bloque fenced
\`suggestions\` con 2-3 próximos pasos. El usuario NO lo ve (la deck lo
quita):
\`\`\`suggestions
[{"label":"Ver tareas","command":"deck.view:tasks"}]
\`\`\`
Si no hay próximos pasos útiles, omití el bloque.`;

// Pull the trailing ```suggestions ... ``` block off the agent's
// reply. Returns { cleanText, suggestions[] } — cleanText is the
// reply with the block removed so the user (and TTS) never sees it.
const SUGGESTIONS_BLOCK_RE = /\n*```\s*suggestions\s*\n([\s\S]*?)\n?```\s*$/i;

function extractSuggestions(text) {
  if (typeof text !== "string" || !text) return { cleanText: text || "", suggestions: [] };
  const m = SUGGESTIONS_BLOCK_RE.exec(text);
  if (!m) return { cleanText: text, suggestions: [] };
  const cleanText = text.slice(0, m.index).trim();
  let suggestions = [];
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed)) {
      suggestions = parsed
        .filter((s) => s && typeof s === "object" && typeof s.label === "string")
        .slice(0, 4)
        .map((s) => ({
          label: String(s.label).slice(0, 48),
          ...(typeof s.command === "string" ? { command: s.command.slice(0, 96) } : {}),
        }));
    }
  } catch {
    // Malformed JSON — drop suggestions silently rather than fail the
    // turn. Better UX to show the reply without chips than an error.
  }
  return { cleanText, suggestions };
}

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

      // ── 1.5 Intent classifier (DISABLED) ──────────────────────────
      // We used to regex-match "creá una tarea X" here and short-circuit
      // the LLM. That fired far too eagerly — any sentence containing
      // those words became a task title, even when the user's actual
      // intent was different ("explicame cómo funciona crear una
      // tarea" would create a bogus task).
      //
      // The right path is the agent's own tool calling: the super-agent
      // already has `create_task`, `send_telegram`, `list_tasks`, etc.
      // in its CORE schema (see super-agent-tools/index.js). We let
      // the model decide; the system prompt below pushes it toward
      // tool use instead of narrating the action in prose.
      const intentResult = { handled: false };
      let replyText = "";
      const previousMessages = Array.isArray(body.previousMessages)
        ? body.previousMessages
        : [];
      const channel = body.channel || "voice";

      let intentMeta = null;
      let suggestions = [];
      const channelCtx = buildChannelContext(channel, {
        projectId: body.projectId,
        language: body.language && body.language !== "auto" ? body.language : "es",
      });
      if (intentResult.handled) {
        replyText = intentResult.reply;
        intentMeta = intentResult.meta || null;
        // Intent shortcut bypasses the LLM, so no model-generated
        // suggestions either; we hand-craft a couple based on the
        // outcome so the chips area isn't empty.
        if (intentMeta?.task_id) {
          suggestions = [
            { label: "Ver tareas", command: "deck.view:tasks" },
            { label: "Anotar otra", command: "voice.again" },
          ];
        }
      } else if (isSuperAgentEnabled(cfg)) {
        try {
          const result = await runSuperAgent({
            globalConfig: cfg,
            projects,
            plugins,
            registries,
            prompt: userText,
            contextNote: channelCtx.contextNote,
            systemSuffix: channelCtx.systemSuffix,
            previousMessages,
          });
          const raw = (result?.text || "").trim();
          if (channelCtx.wantsSuggestions) {
            const parsed = extractSuggestions(raw);
            replyText = parsed.cleanText;
            suggestions = parsed.suggestions;
            // Safety net: small models sometimes return ONLY the
            // suggestions block (no visible reply). Don't ship empty
            // text to TTS — synthesize a generic confirmation so the
            // user gets audible feedback that something happened.
            if (!replyText && raw) {
              replyText = suggestions.length
                ? "Listo."
                : raw;
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
        suggestions: suggestions.length ? suggestions : undefined,
        channel: channel,
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
