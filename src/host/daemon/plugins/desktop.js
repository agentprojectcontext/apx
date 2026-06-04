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
import { appendGlobalMessage } from "../../../core/messages-store.js";

const CHANNEL = "desktop";

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

  let fullResponse = "";
  let toolsExecuted = [];

  try {
    if (!isSuperAgentEnabled(config)) {
      throw new Error("super-agent not enabled — set super_agent.enabled + super_agent.model in ~/.apx/config.json");
    }

    log(`desktop: super-agent turn start — model=${cfg.model || config?.super_agent?.model || "(default)"} text="${text.slice(0, 60)}"`);
    const t0 = Date.now();
    const result = await runSuperAgent({
      globalConfig: config,
      projects,
      plugins,
      prompt: text,
      channel: "desktop",
      channelMeta: { voice: true }, // desktop module is voice-first → spoken mode
      previousMessages: history.slice(0, -1),
      overrideModel: cfg.model || null,
      signal: controller.signal,
      onToken: (chunk) => {
        fullResponse += chunk;
        _send(ws, { type: "token", text: chunk });
      },
      onEvent: async (event) => {
        if (event.type === "tool_start") {
          const t = event.trace;
          toolsExecuted.push(t.tool);
          _send(ws, { type: "tool_start", name: t.tool, args: t.args });
        } else if (event.type === "tool_result") {
          _send(ws, { type: "tool_done", name: event.trace.tool });
        } else if (event.type === "assistant_text" && event.text && !fullResponse) {
          _send(ws, { type: "token", text: event.text });
          fullResponse += event.text;
        }
      },
    });
    const finalText = fullResponse || result.text || "";
    log(`desktop: super-agent turn done in ${Date.now() - t0}ms text_len=${finalText.length}`);

    // Emit done with full text
    _send(ws, { type: "done", text: finalText });

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
