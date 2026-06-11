// Desktop plugin — voice/floating-window channel for the APX daemon.
//
// This plugin:
//   1. Registers as a super-agent channel (type "desktop")
//   2. Routes inbound messages (POST /desktop/message) to the super-agent
//   3. Streams tokens + tool events back to desktop clients via WebSocket
//
// Desktop history is kept in-memory per session (not persisted to disk).
// Each new desktop window starts a fresh session.
//
// Config (in ~/.apx/config.json):
//   "desktop": {
//     "enabled": true,
//     "route_to_agent": "",        // leave empty = use super-agent
//     "model": "",                 // override model; leave empty = super-agent.model
//     "max_history": 20            // turns to keep in context
//   }
// (legacy "overlay" block is still read as a fallback)

import {
  broadcastDesktop,
  sendToClient,
  setDesktopMessageHandler,
} from "../desktop-ws.js";
import { runSuperAgent, isSuperAgentEnabled } from "../super-agent.js";
import { appendGlobalMessage } from "../../../core/stores/messages.js";
import { CHANNELS } from "../../../core/constants/channels.js";
import { tryResolveSkillCommand } from "../skill-trigger.js";

const CHANNEL = CHANNELS.DESKTOP;

export default {
  id: "desktop",

  init({ projects, config, log, plugins }) {
    const cfg = config.desktop || config.overlay || {};
    const enabled = cfg.enabled !== false; // enabled by default

    // In-memory conversation history per connected client.
    // Map<WebSocket, Array<{role, content}>>
    const histories = new WeakMap();

    function getHistory(ws) {
      if (!histories.has(ws)) histories.set(ws, []);
      return histories.get(ws);
    }

    // Handle messages sent from the desktop renderer via WebSocket
    setDesktopMessageHandler(async (ws, data) => {
      if (data.type === "message") {
        await _handleMessage({ ws, text: data.text, previousMessages: getHistory(ws) }, { projects, config, log, plugins, cfg, histories });
      } else if (data.type === "cancel") {
        // Signal to abort current generation (handled via AbortController below)
        ws._desktopAbort?.abort();
      } else if (data.type === "ping") {
        sendToClient(ws, { type: "pong" });
      }
    });

    const instance = {
      start() {
        if (enabled) log("desktop: plugin started");
      },
      stop() {},
      status() { return { enabled }; },

      // Called by the /desktop/message REST endpoint
      async handleMessage({ text, previousMessages = [] }) {
        if (!enabled) throw new Error("desktop plugin not enabled");
        broadcastDesktop({ type: "user_message", text });
        await _handleMessage({ ws: null, text, previousMessages }, { projects, config, log, plugins, cfg, histories });
      },
    };

    return instance;
  },
};

// ---------------------------------------------------------------------------
// Core message handler
// ---------------------------------------------------------------------------

async function _handleMessage({ ws, text, previousMessages }, { projects, config, log, plugins, cfg, histories }) {
  // Append user turn to history
  if (ws && histories) {
    const hist = _getHistory(ws, histories);
    hist.push({ role: "user", content: text });
  }

  const maxHistory = cfg.max_history ?? 20;
  const history = ws ? _getHistory(ws, histories).slice(-(maxHistory)) : previousMessages.slice(-(maxHistory));

  // AbortController for cancel support
  const controller = new AbortController();
  if (ws) ws._desktopAbort = controller;

  // Emit "thinking" indicator
  _send(ws, { type: "thinking" });

  // Persist to desktop message log
  try {
    await appendGlobalMessage({ channel: CHANNEL, direction: "in", type: "user", author: "user", body: text });
  } catch {}

  let toolsExecuted = [];

  // Per-segment streaming: instead of merging the whole turn into one blob, we
  // emit each assistant text piece as its own `segment` (an intro before a tool,
  // then the post-tool answer, …). The renderer renders each as its own bubble
  // and synthesizes its own audio, so a multi-step reply reads as separate spoken
  // messages instead of one run-on bubble. `liveBuf` accumulates streamed tokens
  // (streaming engines) so they can be flushed as a segment at each boundary;
  // for non-streaming models like gemini the text arrives whole via events.
  let segSeq = 0;
  let lastSegText = "";
  let liveBuf = "";
  const emittedSegments = [];
  const emitSegment = (raw) => {
    const seg = (raw || "").trim();
    if (!seg || seg === lastSegText) return;
    lastSegText = seg;
    emittedSegments.push(seg);
    _send(ws, { type: "segment", seq: ++segSeq, text: seg });
  };

  try {
    if (!isSuperAgentEnabled(config)) {
      throw new Error("super-agent not enabled — set super_agent.enabled + super_agent.model in ~/.apx/config.json");
    }

    log(`desktop: super-agent turn start — model=${cfg.model || config?.super_agent?.model || "(default)"} text="${text.slice(0, 60)}"`);
    const t0 = Date.now();
    const slashed = tryResolveSkillCommand(text);
    const slashedPrompt = slashed.handled ? slashed.prompt : text;
    const result = await runSuperAgent({
      globalConfig: config,
      projects,
      plugins,
      prompt: slashedPrompt,
      channel: CHANNELS.DESKTOP,
      ...(slashed.handled ? { contextNote: slashed.contextNote } : {}),
      channelMeta: { voice: true }, // desktop module is voice-first → spoken mode
      previousMessages: history.slice(0, -1),
      overrideModel: cfg.model || null,
      signal: controller.signal,
      onToken: (chunk) => { liveBuf += chunk; },
      onEvent: async (event) => {
        if (event.type === "tool_start") {
          const t = event.trace;
          toolsExecuted.push(t.tool);
          _send(ws, { type: "tool_start", name: t.tool, args: t.args });
        } else if (event.type === "tool_result") {
          _send(ws, { type: "tool_done", name: event.trace.tool });
          // ask_questions on desktop is voice-first: there's no inline-keyboard
          // UI to render, so we turn the structured questions into a spoken
          // segment. The user voice-replies on the next turn and the super-agent
          // sees that reply in its history. Each option is announced inline so
          // TTS reads them aloud naturally.
          if (event.trace?.tool === "ask_questions") {
            const segments = formatAskQuestionsForVoice(event.trace.args?.questions);
            if (segments) emitSegment(segments);
          }
        } else if (event.type === "assistant_text" && event.text) {
          // A complete assistant text segment (e.g. the "I'll check…" intro
          // emitted right before a tool runs). Ship it as its own message.
          emitSegment(event.text);
          liveBuf = "";
        }
      },
    });
    // The final (no-tool) iteration's answer appears ONLY in result.text (or, for
    // streaming engines, in liveBuf) — it's never emitted as an event. Ship it as
    // the closing segment (deduped against the last one).
    emitSegment((result.text || "").trim() || liveBuf.trim());

    const finalText = emittedSegments.join("\n\n");
    log(`desktop: super-agent turn done in ${Date.now() - t0}ms segments=${segSeq} text_len=${finalText.length} tools=${toolsExecuted.length}`);

    // Turn end. `segments` lets the renderer know how many bubbles to expect.
    _send(ws, { type: "done", segments: segSeq, text: finalText });

    // Append assistant turn to history
    if (ws && histories) {
      const hist = _getHistory(ws, histories);
      hist.push({ role: "assistant", content: finalText });
      // Trim history
      if (hist.length > (cfg.max_history ?? 20)) {
        hist.splice(0, hist.length - (cfg.max_history ?? 20));
      }
    }

    // Persist assistant response
    try {
      await appendGlobalMessage({ channel: CHANNEL, direction: "out", type: "agent", body: finalText });
    } catch {}

  } catch (e) {
    if (e.name === "AbortError") {
      _send(ws, { type: "cancelled" });
    } else {
      // Verbose stack — the previous one-liner hid root causes when the
      // model adapter threw inside runSuperAgent's promise chain.
      log(`desktop: error — ${e.message}`);
      console.error("desktop plugin: super-agent threw:", e.stack || e);
      _send(ws, { type: "error", message: e.message });
    }
  }
}

// Build a voice-friendly transcript of an ask_questions tool call so the
// desktop's TTS reads the prompt aloud and the bubble shows what was asked.
// Single question + options reads as "<question> Opciones: A; B; C."
// Multiple questions are numbered. Free-text questions just speak the prompt.
function formatAskQuestionsForVoice(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines = [];
  raw.forEach((rawQ, idx) => {
    const q = typeof rawQ === "string" ? { question: rawQ } : (rawQ || {});
    const text = typeof q.question === "string" ? q.question.trim() : "";
    if (!text) return;
    const prefix = raw.length > 1 ? `${idx + 1}. ` : "";
    const opts = Array.isArray(q.options) ? q.options : [];
    const optLabels = opts
      .map((o) => (typeof o === "string" ? o : (o && typeof o.label === "string" ? o.label : "")))
      .filter(Boolean);
    let line = `${prefix}${text}`;
    if (optLabels.length > 0) {
      line += ` Opciones: ${optLabels.join("; ")}.`;
    }
    lines.push(line);
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function _send(ws, msg) {
  if (ws) {
    sendToClient(ws, msg);
  } else {
    broadcastDesktop(msg);
  }
}

function _getHistory(ws, histories) {
  if (!histories.has(ws)) histories.set(ws, []);
  return histories.get(ws);
}
