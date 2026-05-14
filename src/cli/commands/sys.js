import readline from "node:readline";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { readConfig } from "../../core/config.js";
import { readIdentity } from "../../core/identity.js";
import {
  C,
  MODES,
  readPackageVersion,
  renderTerminalChat,
  titlecase,
} from "../terminal-chat/renderer.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TUI_SRC = resolve(__dirname, "../../tui/run.ts");

const MAIN_PALETTE_OPTIONS = ["Switch model", "Switch agent", "Connect provider", "Open editor", "Exit"];

// Message Actions overlay options for a queued message
const MSG_ACTION_SEND   = "Send now  (interrupt current)";
const MSG_ACTION_COPY   = "Copy message text";
const MSG_ACTION_QUESTION = "Ask about this...";
const MSG_ACTION_REMOVE = "Remove from queue";

export async function cmdSys(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const cfg = readConfig();
  const id = readIdentity();

  // Launch new Solid.js TUI via bun (runs TS source directly — no esbuild bundle needed)
  if (existsSync(TUI_SRC)) {
    const bunBin = process.env.BUN_PATH || "bun";
    spawnSync(bunBin, [
      "--preload", "@opentui/solid/preload",
      TUI_SRC,
      "--pid", pid,
      "--agent", id?.agent_name || cfg.super_agent?.name || "super-agent",
      "--model", cfg.super_agent?.model || "claude-3-5-sonnet",
    ], { stdio: "inherit", cwd: resolve(__dirname, "../../..") });
    return;
  }


  const state = {
    currentModeIdx: 0,
    inputText: "",
    cursorIndex: 0,
    inCommandPalette: false,
    paletteSelection: 0,
    paletteState: "main",
    paletteOptions: [...MAIN_PALETTE_OPTIONS],
    activeAgent: titlecase(id?.agent_name || cfg.super_agent?.name || "SuperAgent"),
    activeModel: cfg.super_agent?.model || "Claude 3.5 Sonnet",
    version: readPackageVersion(),
    hasStarted: false,
    sessionTitle: "",
    usage: { input: 0, output: 0, percent: 0 },
    chatScrollOffset: 0,
    transcript: [],
    // Message Actions overlay state
    inMsgActions: false,
    msgActionsTarget: null,   // { text } of the targeted message
    msgActionsSelection: 0,
    msgActionsOptions: [MSG_ACTION_SEND, MSG_ACTION_COPY, MSG_ACTION_QUESTION, MSG_ACTION_REMOVE],
  };

  const previousMessages = [];
  const pendingPrompts = [];
  let restored = false;
  let isRequesting = false;
  // AbortController for the current in-flight LLM request
  let currentAbortCtrl = null;

  function restoreTerminal() {
    if (restored) return;
    restored = true;
    // Disable mouse tracking before exit
    process.stdout.write("\x1b[?1000l\x1b[?1015l\x1b[?1006l");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(C.reset + C.showCursor + C.resetBg + C.altOff);
  }

  function renderScreen() {
    state.sessionTitle = state.transcript.find((item) => item.type === "user")?.text || "";
    renderTerminalChat(state);
  }

  function resetPalette() {
    state.paletteState = "main";
    state.paletteOptions = [...MAIN_PALETTE_OPTIONS];
    state.paletteSelection = 0;
  }

  function close() {
    restoreTerminal();
    process.exit(0);
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write(C.altOn + C.setBgBlack + C.showCursor + C.bg);
  // Enable xterm mouse button tracking (X10 + SGR extended for wide terminals)
  process.stdout.write("\x1b[?1000h\x1b[?1015h\x1b[?1006h");
  process.once("exit", restoreTerminal);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.stdout.on?.("resize", renderScreen);
  process.on("SIGWINCH", renderScreen);

  renderScreen();

  // Handle raw mouse tracking bytes before readline keypress
  process.stdin.on("data", (chunk) => {
    const raw = typeof chunk === "string" ? chunk : chunk.toString("binary");
    // SGR mouse: ESC [ < Pb ; Px ; Py M/m
    const sgrMatch = raw.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (sgrMatch) {
      const btn = parseInt(sgrMatch[1], 10);
      const col = parseInt(sgrMatch[2], 10) - 1;
      const row = parseInt(sgrMatch[3], 10) - 1;
      const press = sgrMatch[4] === "M";
      if (press && btn === 0) {
        handleMouseClick(col, row, state, pendingPrompts, renderScreen, () => {
          // interrupt callback: abort current request then flush queue
          if (currentAbortCtrl) currentAbortCtrl.abort();
        });
      }
      return;
    }
  });

  process.stdin.on("keypress", async (str, key) => {
    if (key.ctrl && key.name === "c") {
      // If a request is running, interrupt it first; second Ctrl-C exits
      if (isRequesting && currentAbortCtrl) {
        currentAbortCtrl.abort();
        return;
      }
      close();
    }

    // Ctrl+I = interrupt current request and immediately send first queued prompt
    if (key.ctrl && key.name === "i" && isRequesting) {
      if (currentAbortCtrl) currentAbortCtrl.abort();
      return;
    }

    if (key.ctrl && key.name === "p") {
      state.inCommandPalette = !state.inCommandPalette;
      state.inMsgActions = false;
      resetPalette();
      renderScreen();
      return;
    }

    if (key.name === "escape") {
      if (state.inMsgActions) {
        state.inMsgActions = false;
        state.msgActionsTarget = null;
        renderScreen();
        return;
      }
      if (state.inCommandPalette) {
        if (state.paletteState !== "main") {
          resetPalette();
        } else {
          state.inCommandPalette = false;
        }
        renderScreen();
        return;
      }
    }

    if (state.inMsgActions) {
      await handleMsgActionsKey(key, state, pendingPrompts, renderScreen, () => {
        if (currentAbortCtrl) currentAbortCtrl.abort();
      });
      return;
    }

    if (state.inCommandPalette) {
      await handlePaletteKey(key, pid, cfg, state, renderScreen, close);
      return;
    }

    if (handleScrollKey(key, state, renderScreen)) return;

    if (isReturnKey(key)) {
      if (isExitCommand(state.inputText)) {
        close();
        return;
      }

      if (isRequesting) {
        queuePrompt(state, pendingPrompts, renderScreen);
        return;
      }

      isRequesting = true;
      await submitPromptQueue(
        pid, state, previousMessages, pendingPrompts, renderScreen, close,
        (ctrl) => { currentAbortCtrl = ctrl; }
      );
      isRequesting = false;
      currentAbortCtrl = null;
      return;
    }

    if (handleEditingKey(str, key, state, renderScreen)) return;
  });
}

// ---------------------------------------------------------------------------
// Mouse click → Message Actions overlay
// ---------------------------------------------------------------------------

/**
 * Determine if a click at (col, row) lands on a queued user message bubble,
 * and if so open the Message Actions overlay for it.
 */
function handleMouseClick(col, row, state, pendingPrompts, renderScreen, onInterrupt) {
  if (!state.hasStarted) return;

  // Find the message bubble that was clicked. 
  // We look for both queued and regular messages in the transcript.
  // Transcript is rendered from bottom to top in terms of logic, 
  // but we'll use a simple heuristic for now.
  const allUserMessages = state.transcript.filter(t => t.type === "user");
  if (allUserMessages.length === 0) return;

  const { width } = { width: process.stdout.columns || 80 };
  if (col > Math.floor(width * 0.8)) return;

  // For now, just pick the most recent one if clicked in the main area.
  // In a real app we'd map row to transcript index precisely.
  state.inMsgActions = true;
  state.msgActionsTarget = allUserMessages[allUserMessages.length - 1];
  state.msgActionsSelection = 0;
  
  // Filter options: "Send now" only for queued items
  const isQueued = state.msgActionsTarget.meta === "queued";
  state.msgActionsOptions = isQueued 
    ? [MSG_ACTION_SEND, MSG_ACTION_COPY, MSG_ACTION_QUESTION, MSG_ACTION_REMOVE]
    : [MSG_ACTION_COPY, MSG_ACTION_QUESTION];

  renderScreen();
}

/** Keyboard nav inside the Message Actions overlay */
async function handleMsgActionsKey(key, state, pendingPrompts, renderScreen, onInterrupt) {
  if (key.name === "up") {
    state.msgActionsSelection = Math.max(0, state.msgActionsSelection - 1);
    renderScreen();
    return;
  }
  if (key.name === "down") {
    state.msgActionsSelection = Math.min(
      state.msgActionsOptions.length - 1,
      state.msgActionsSelection + 1
    );
    renderScreen();
    return;
  }
  if (key.name !== "return") {
    renderScreen();
    return;
  }

  const selected = state.msgActionsOptions[state.msgActionsSelection];
  const target = state.msgActionsTarget;

  // Close overlay first
  state.inMsgActions = false;
  state.msgActionsTarget = null;

  if (selected === MSG_ACTION_REMOVE) {
    // Remove from pendingPrompts and transcript
    const idx = pendingPrompts.findIndex((p) => p.text === target?.text);
    if (idx >= 0) pendingPrompts.splice(idx, 1);
    const tidx = state.transcript.indexOf(target);
    if (tidx >= 0) state.transcript.splice(tidx, 1);
    renderScreen();
    return;
  }

  if (selected === MSG_ACTION_COPY) {
    // Best-effort clipboard via pbcopy (macOS) / xclip (Linux)
    try {
      const { execSync } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard";
      execSync(cmd, { input: target?.text || "", stdio: ["pipe", "ignore", "ignore"] });
    } catch {}
    state.transcript.push({ type: "status", text: "Copied to clipboard" });
    renderScreen();
    return;
  }

  if (selected === MSG_ACTION_QUESTION) {
    const text = target?.text || "";
    state.inputText = `Pregunta sobre esto: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"\n\n`;
    state.cursorIndex = state.inputText.length;
    renderScreen();
    return;
  }

  if (selected === MSG_ACTION_SEND) {
    // Promote the queued item to front of queue, then interrupt current request
    const idx = pendingPrompts.findIndex((p) => p.text === target?.text);
    if (idx > 0) {
      const [entry] = pendingPrompts.splice(idx, 1);
      pendingPrompts.unshift(entry);
    }
    // Signal the interrupt — the running submitPromptQueue will pick it up
    onInterrupt();
    renderScreen();
    return;
  }

  renderScreen();
}

export function isReturnKey(key) {
  return key?.name === "return" || key?.name === "enter";
}

export function isExitCommand(text) {
  return /^(exit|quit)$/i.test(String(text || "").trim());
}

export function handleScrollKey(key, state, renderScreen) {
  if (!state.hasStarted || !key) return false;
  const pageSize = key.name === "pageup" || key.name === "pagedown" ? 8 : 3;

  if (key.name === "pageup" || key.name === "up" || (key.ctrl && key.name === "up")) {
    state.chatScrollOffset = Math.min(100000, (state.chatScrollOffset || 0) + pageSize);
    renderScreen();
    return true;
  }

  if (key.name === "pagedown" || key.name === "down" || (key.ctrl && key.name === "down")) {
    state.chatScrollOffset = Math.max(0, (state.chatScrollOffset || 0) - pageSize);
    renderScreen();
    return true;
  }

  if (key.meta && key.name === "up") {
    state.chatScrollOffset = Math.min(100000, (state.chatScrollOffset || 0) + 20);
    renderScreen();
    return true;
  }

  if (key.meta && key.name === "down") {
    state.chatScrollOffset = 0;
    renderScreen();
    return true;
  }

  return false;
}

async function handlePaletteKey(key, pid, cfg, state, renderScreen, close) {
  if (key.name === "up") {
    state.paletteSelection = Math.max(0, state.paletteSelection - 1);
    renderScreen();
    return;
  }

  if (key.name === "down") {
    state.paletteSelection = Math.min(state.paletteOptions.length - 1, state.paletteSelection + 1);
    renderScreen();
    return;
  }

  if (key.name !== "return") {
    renderScreen();
    return;
  }

  const selected = state.paletteOptions[state.paletteSelection];

  if (state.paletteState === "main") {
    if (selected === "Exit") { close(); return; }

    if (selected === "Switch model") {
      state.paletteState = "switch_model";
      state.paletteOptions = ["Loading models..."];
      state.paletteSelection = 0;
      renderScreen();
      loadModelOptions(pid, cfg, state, renderScreen);
      return;
    }

    if (selected === "Switch agent") {
      state.paletteState = "switch_agent";
      state.paletteOptions = ["Loading agents..."];
      state.paletteSelection = 0;
      renderScreen();
      loadAgentOptions(pid, state, renderScreen);
      return;
    }

    state.inCommandPalette = false;
    state.transcript.push({ type: "status", text: `Command: ${selected} (not implemented yet)` });
    renderScreen();
    return;
  }

  if (
    state.paletteState === "switch_model" &&
    !selected.startsWith("Loading") &&
    !selected.startsWith("Failed") &&
    !selected.startsWith("No ")
  ) {
    state.activeModel = selected;
    const configModule = await import("../../core/config.js");
    const currentCfg = configModule.readConfig();
    if (!currentCfg.super_agent) currentCfg.super_agent = {};
    currentCfg.super_agent.model = selected;
    configModule.writeConfig(currentCfg);

    state.inCommandPalette = false;
    state.transcript.push({ type: "status", text: `Model → ${selected}` });
    renderScreen();
    return;
  }

  if (
    state.paletteState === "switch_agent" &&
    !selected.startsWith("Loading") &&
    !selected.startsWith("Failed") &&
    !selected.startsWith("No ")
  ) {
    state.activeAgent = selected;
    state.inCommandPalette = false;
    state.transcript.push({ type: "status", text: `Agent → ${selected}` });
    renderScreen();
    return;
  }

  renderScreen();
}

function loadModelOptions(pid, cfg, state, renderScreen) {
  // Load engines from APX daemon first, then fall back to Ollama tags
  const apxEnginesPromise = pid
    ? http.get("/engines").then((d) => d?.engines || []).catch(() => [])
    : Promise.resolve([]);

  const ollamaBaseUrl = cfg.engines?.ollama?.base_url || "http://127.0.0.1:11434";
  const ollamaPromise = fetch(`${ollamaBaseUrl}/api/tags`)
    .then((r) => r.json())
    .then((d) => (d.models || []).map((m) => "ollama:" + m.name))
    .catch(() => []);

  Promise.all([apxEnginesPromise, ollamaPromise])
    .then(([apxEngines, ollamaModels]) => {
      const all = [
        ...apxEngines.filter((e) => typeof e === "string"),
        ...ollamaModels,
      ];
      state.paletteOptions = all.length ? all : ["No models found"];
      if (state.paletteState === "switch_model") renderScreen();
    })
    .catch(() => {
      state.paletteOptions = ["Failed to load models"];
      if (state.paletteState === "switch_model") renderScreen();
    });
}

function loadAgentOptions(pid, state, renderScreen) {
  if (!pid) {
    state.paletteOptions = ["No project selected"];
    renderScreen();
    return;
  }
  http.get(`/projects/${pid}/agents`)
    .then((agents) => {
      state.paletteOptions = Array.isArray(agents) && agents.length
        ? agents.map((a) => a.slug || a.name || String(a))
        : ["No agents found"];
      if (state.paletteState === "switch_agent") renderScreen();
    })
    .catch(() => {
      state.paletteOptions = ["Failed to load agents"];
      if (state.paletteState === "switch_agent") renderScreen();
    });
}

export function handleEditingKey(str, key, state, renderScreen) {
  if (key.name === "tab") {
    state.currentModeIdx = (state.currentModeIdx + 1) % MODES.length;
    renderScreen();
    return true;
  }

  if (key.ctrl && key.name === "a") {
    state.cursorIndex = 0;
    renderScreen();
    return true;
  }

  if (key.ctrl && key.name === "e") {
    state.cursorIndex = state.inputText.length;
    renderScreen();
    return true;
  }

  if (key.ctrl && key.name === "u") {
    state.inputText = state.inputText.slice(state.cursorIndex);
    state.cursorIndex = 0;
    renderScreen();
    return true;
  }

  if (key.ctrl && key.name === "w") {
    const before = state.inputText.slice(0, state.cursorIndex).replace(/\s*\S+\s*$/, "");
    state.inputText = before + state.inputText.slice(state.cursorIndex);
    state.cursorIndex = before.length;
    renderScreen();
    return true;
  }

  if (key.name === "left") {
    state.cursorIndex = Math.max(0, state.cursorIndex - 1);
    renderScreen();
    return true;
  }

  if (key.name === "right") {
    state.cursorIndex = Math.min(state.inputText.length, state.cursorIndex + 1);
    renderScreen();
    return true;
  }

  if (key.name === "home") {
    state.cursorIndex = 0;
    renderScreen();
    return true;
  }

  if (key.name === "end") {
    state.cursorIndex = state.inputText.length;
    renderScreen();
    return true;
  }

  if (key.name === "delete") {
    state.inputText = state.inputText.slice(0, state.cursorIndex) + state.inputText.slice(state.cursorIndex + 1);
    renderScreen();
    return true;
  }

  if (key.name === "backspace") {
    if (state.cursorIndex === 0) return true;
    state.inputText = state.inputText.slice(0, state.cursorIndex - 1) + state.inputText.slice(state.cursorIndex);
    state.cursorIndex -= 1;
    renderScreen();
    return true;
  }

  if (str && str.length === 1 && !key.ctrl && !key.meta && str >= " ") {
    state.inputText = state.inputText.slice(0, state.cursorIndex) + str + state.inputText.slice(state.cursorIndex);
    state.cursorIndex += str.length;
    renderScreen();
    return true;
  }

  return false;
}

function queuePrompt(state, pendingPrompts, renderScreen) {
  const text = state.inputText.trim();
  if (!text) return;

  state.hasStarted = true;
  state.inputText = "";
  state.cursorIndex = 0;
  state.chatScrollOffset = 0;

  const item = { type: "user", text, meta: "queued" };
  pendingPrompts.push({ text, item });
  state.transcript.push(item);
  renderScreen();
}

async function submitPromptQueue(
  pid, state, previousMessages, pendingPrompts, renderScreen, close,
  setAbortCtrl = () => {}
) {
  const firstText = state.inputText.trim();
  if (!firstText) return;
  if (isExitCommand(firstText)) {
    close();
    return;
  }

  state.hasStarted = true;
  state.inputText = "";
  state.cursorIndex = 0;
  state.chatScrollOffset = 0;

  const firstItem = { type: "user", text: firstText };
  state.transcript.push(firstItem);
  await runPrompt(
    pid, state, previousMessages, renderScreen, firstText, firstItem, setAbortCtrl
  );

  while (pendingPrompts.length > 0) {
    const queued = pendingPrompts.shift();
    delete queued.item.meta;
    await runPrompt(
      pid, state, previousMessages, renderScreen, queued.text, queued.item, setAbortCtrl
    );
  }
}

async function runPrompt(
  pid, state, previousMessages, renderScreen, text, userItem,
  setAbortCtrl = () => {}
) {
  appendLiveItem(state, { type: "status", text: "Thinking...", active: true });
  renderScreen();

  const startTime = Date.now();
  const abortCtrl = http.createAbortController();
  setAbortCtrl(abortCtrl);

  try {
    const cwd = process.cwd();
    const body = {
      prompt: `[Mode: ${MODES[state.currentModeIdx]}]\n${text}`,
      contextNote: [
        "Channel: terminal. Format freely using markdown, but keep it readable. Use code diffs when editing.",
        `CWD: ${cwd}`,
        "When the user says \"este directorio\", \"este proyecto\", \"acá\", \"aquí\", \"this directory\", \"current dir\" or any equivalent reference without naming a path, they mean exactly the CWD above. Use it as the path argument directly — don't ask the user to provide it.",
      ].join("\n"),
      previousMessages,
      model: state.activeModel,
    };

    let result;
    let interrupted = false;
    try {
      result = await http.streamPost(
        `/projects/${pid}/super-agent/chat/stream`,
        body,
        (event) => handleProgressEvent(event, state, renderScreen),
        { signal: abortCtrl.signal }
      );
    } catch (e) {
      if (abortCtrl.signal.aborted) {
        // Interrupted by user — show notice and continue to next queued prompt
        interrupted = true;
        removeStatus(state);
        appendLiveItem(state, {
          type: "status",
          text: `\u26a1 Interrupted — ${text.slice(0, 60)}${text.length > 60 ? "\u2026" : ""}`,
        });
      } else if (e.status !== 404) {
        throw e;
      } else {
        result = await http.post(
          `/projects/${pid}/super-agent/chat`, body,
          { signal: abortCtrl.signal }
        );
        removeStatus(state);
        for (const trace of result.trace || []) {
          appendLiveItem(state, { type: "tool", trace });
        }
      }
    }

    if (!interrupted && result) {
      completeSuperAgentResult(result, text, startTime, state, previousMessages);
    }
  } catch (e) {
    if (!abortCtrl.signal.aborted) {
      removeStatus(state);
      appendLiveItem(state, { type: "error", text: e.message });
    }
  }

  if (userItem) delete userItem.meta;
  setAbortCtrl(null);
  renderScreen();
}

function removeStatus(state) {
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    if (state.transcript[i]?.type === "status" && state.transcript[i]?.active) {
      state.transcript.splice(i, 1);
      return;
    }
  }
}

function appendLiveItem(state, item) {
  const queuedIndex = state.transcript.findIndex(
    (entry) => entry?.type === "user" && entry?.meta === "queued"
  );
  if (queuedIndex >= 0) state.transcript.splice(queuedIndex, 0, item);
  else state.transcript.push(item);
}

function handleProgressEvent(event, state, renderScreen) {
  if (event.type === "model_start") {
    const status = [...state.transcript].reverse().find((item) => item?.type === "status" && item?.active);
    if (status) {
      status.text = event.iteration > 1 ? `Thinking... step ${event.iteration}` : "Thinking...";
      renderScreen();
    }
    return;
  }

  if (event.type === "model_retry") {
    const status = [...state.transcript].reverse().find((item) => item?.type === "status" && item?.active);
    if (status) status.text = "Retrying with tool fallback...";
    else appendLiveItem(state, { type: "status", text: "Retrying with tool fallback...", active: true });
    renderScreen();
    return;
  }

  if (event.type === "assistant_text" && event.text) {
    removeStatus(state);
    appendLiveItem(state, {
      type: "assistant",
      name: state.activeAgent,
      text: event.text,
      meta: "intermediate",
    });
    renderScreen();
    return;
  }

  if (event.type === "tool_start" && event.trace) {
    removeStatus(state);
    appendLiveItem(state, { type: "tool", trace: event.trace });
    renderScreen();
    return;
  }

  if (event.type === "tool_result" && event.trace) {
    removeStatus(state);
    const idx = state.transcript.findIndex(
      (item) => item.type === "tool" && item.trace?.id && item.trace.id === event.trace.id
    );
    if (idx >= 0) state.transcript[idx] = { type: "tool", trace: event.trace };
    else appendLiveItem(state, { type: "tool", trace: event.trace });
    renderScreen();
  }
}

function completeSuperAgentResult(result, userText, startTime, state, previousMessages) {
  removeStatus(state);
  if (!result) throw new Error("super-agent stream ended without final result");

  previousMessages.push({ role: "user", content: userText });
  previousMessages.push({ role: "assistant", content: result.text });
  if (previousMessages.length > 20) previousMessages.splice(0, previousMessages.length - 20);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  state.usage.input += result.usage?.input_tokens || 0;
  state.usage.output += result.usage?.output_tokens || 0;
  state.usage.percent = Math.min(99, Math.round((state.usage.input / 200000) * 100));

  appendLiveItem(state, {
    type: "assistant",
    name: state.activeAgent,
    text: result.text,
    meta: `${elapsed}s   ·   In: ${result.usage?.input_tokens || 0} Out: ${result.usage?.output_tokens || 0}`,
  });
}
