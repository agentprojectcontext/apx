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

const MAIN_PALETTE_OPTIONS = ["Switch model", "Connect provider", "Open editor", "Exit"];

export async function cmdSys(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const cfg = readConfig();
  const id = readIdentity();

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
    transcript: [],
  };

  const previousMessages = [];
  let restored = false;
  let isRequesting = false;

  function restoreTerminal() {
    if (restored) return;
    restored = true;
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
  process.once("exit", restoreTerminal);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.stdout.on?.("resize", renderScreen);
  process.on("SIGWINCH", renderScreen);

  renderScreen();

  process.stdin.on("keypress", async (str, key) => {
    if (isRequesting) return;

    if (key.ctrl && key.name === "c") {
      close();
    }

    if (key.ctrl && key.name === "p") {
      state.inCommandPalette = !state.inCommandPalette;
      resetPalette();
      renderScreen();
      return;
    }

    if (key.name === "escape" && state.inCommandPalette) {
      if (state.paletteState !== "main") {
        resetPalette();
      } else {
        state.inCommandPalette = false;
      }
      renderScreen();
      return;
    }

    if (state.inCommandPalette) {
      await handlePaletteKey(key, cfg, state, renderScreen, close);
      return;
    }

    if (isReturnKey(key)) {
      isRequesting = true;
      await submitPrompt(pid, state, previousMessages, renderScreen, close);
      isRequesting = false;
      return;
    }

    if (handleEditingKey(str, key, state, renderScreen)) return;
  });
}

export function isReturnKey(key) {
  return key?.name === "return" || key?.name === "enter";
}

async function handlePaletteKey(key, cfg, state, renderScreen, close) {
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
    if (selected === "Exit") close();

    if (selected === "Switch model") {
      state.paletteState = "switch_model";
      state.paletteOptions = ["Loading models..."];
      state.paletteSelection = 0;
      renderScreen();
      loadModelOptions(cfg, state, renderScreen);
      return;
    }

    state.inCommandPalette = false;
    state.transcript.push({ type: "status", text: `Executing command: ${selected} (not implemented yet)` });
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
    state.transcript.push({ type: "status", text: `Model updated globally to ${selected}` });
    renderScreen();
    return;
  }

  renderScreen();
}

function loadModelOptions(cfg, state, renderScreen) {
  const baseUrl = cfg.engines?.ollama?.base_url || "http://127.0.0.1:11434";
  fetch(`${baseUrl}/api/tags`)
    .then((r) => r.json())
    .then((data) => {
      state.paletteOptions = data.models?.length
        ? data.models.map((m) => "ollama:" + m.name)
        : ["No Ollama models found"];
      state.paletteOptions.push("openai:gpt-4o", "anthropic:claude-3-5-sonnet-20240620");
      if (state.paletteState === "switch_model") renderScreen();
    })
    .catch(() => {
      state.paletteOptions = ["Failed to load from Ollama", "openai:gpt-4o", "anthropic:claude-3-5-sonnet-20240620"];
      if (state.paletteState === "switch_model") renderScreen();
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

async function submitPrompt(pid, state, previousMessages, renderScreen, close) {
  const text = state.inputText.trim();
  if (!text) return;
  if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
    close();
  }

  state.hasStarted = true;
  state.inputText = "";
  state.cursorIndex = 0;
  state.transcript.push({ type: "user", text });
  state.transcript.push({ type: "status", text: "Thinking..." });
  renderScreen();

  const startTime = Date.now();

  try {
    const body = {
      prompt: `[Mode: ${MODES[state.currentModeIdx]}]\n${text}`,
      contextNote: "Channel: terminal. Format freely using markdown, but keep it readable. Use code diffs when editing.",
      previousMessages,
      model: state.activeModel,
    };

    let result;
    try {
      result = await http.streamPost(
        `/projects/${pid}/super-agent/chat/stream`,
        body,
        (event) => handleProgressEvent(event, state, renderScreen)
      );
    } catch (e) {
      if (e.status !== 404) throw e;
      result = await http.post(`/projects/${pid}/super-agent/chat`, body);
      removeStatus(state);
      for (const trace of result.trace || []) {
        state.transcript.push({ type: "tool", trace });
      }
    }

    completeSuperAgentResult(result, text, startTime, state, previousMessages);
  } catch (e) {
    removeStatus(state);
    state.transcript.push({ type: "error", text: e.message });
  }

  renderScreen();
}

function removeStatus(state) {
  const last = state.transcript[state.transcript.length - 1];
  if (last?.type === "status") state.transcript.pop();
}

function handleProgressEvent(event, state, renderScreen) {
  if (event.type === "model_start") {
    const last = state.transcript[state.transcript.length - 1];
    if (last?.type === "status") {
      last.text = event.iteration > 1 ? `Thinking... step ${event.iteration}` : "Thinking...";
      renderScreen();
    }
    return;
  }

  if (event.type === "assistant_text" && event.text) {
    removeStatus(state);
    state.transcript.push({
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
    state.transcript.push({ type: "tool", trace: event.trace });
    renderScreen();
    return;
  }

  if (event.type === "tool_result" && event.trace) {
    removeStatus(state);
    const idx = state.transcript.findIndex(
      (item) => item.type === "tool" && item.trace?.id && item.trace.id === event.trace.id
    );
    if (idx >= 0) state.transcript[idx] = { type: "tool", trace: event.trace };
    else state.transcript.push({ type: "tool", trace: event.trace });
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

  state.transcript.push({
    type: "assistant",
    name: state.activeAgent,
    text: result.text,
    meta: `${elapsed}s   ·   In: ${result.usage?.input_tokens || 0} Out: ${result.usage?.output_tokens || 0}`,
  });
}
