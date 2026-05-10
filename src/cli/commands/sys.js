import readline from "node:readline";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { readConfig } from "../../core/config.js";

const MODES = ["Build", "Plan", "Zen"];

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const C = {
  reset: "\x1b[0m",
  bg: "\x1b[48;2;0;0;0m",
  panel: "\x1b[48;2;26;26;26m",
  panel2: "\x1b[48;2;31;31;31m",
  text: "\x1b[38;2;237;237;237m",
  muted: "\x1b[38;2;135;135;135m",
  dim: "\x1b[38;2;69;69;69m",
  primary: "\x1b[38;2;82;168;255m",
  primaryDark: "\x1b[38;2;0;112;243m",
  warning: "\x1b[38;2;255;178;36m",
  error: "\x1b[38;2;229;72;77m",
  success: "\x1b[38;2;70;167;88m",
  magenta: "\x1b[38;2;191;122;240m",
  bold: "\x1b[1m",
  normal: "\x1b[22m",
  italic: "\x1b[3m",
};

function visible(text) {
  return String(text).replace(ANSI_RE, "").length;
}

function fit(text, width) {
  const clean = String(text).replace(/\r?\n/g, " ");
  if (clean.length <= width) return clean;
  return clean.slice(0, Math.max(0, width - 1)) + "…";
}

function padAnsi(text, width) {
  return String(text) + " ".repeat(Math.max(0, width - visible(text)));
}

function writeRaw(text = "") {
  process.stdout.write(C.bg + text + C.bg);
}

function writeLine(text = "") {
  process.stdout.write(C.bg + text + C.bg + "\n");
}

function clearFull() {
  process.stdout.write(C.bg + "\x1b[2J\x1b[3J\x1b[H");
}

function clearDown() {
  process.stdout.write(C.bg);
  readline.cursorTo(process.stdout, 0);
  readline.clearScreenDown(process.stdout);
}

function centerLeft(width, contentWidth) {
  return Math.max(0, Math.floor((width - contentWidth) / 2));
}

function plainKey(key) {
  return C.bold + C.text + key + C.normal;
}

function renderLogo(termWidth) {
  const lines = [
    " █████╗ ██████╗ ██╗  ██╗",
    "██╔══██╗██╔══██╗╚██╗██╔╝",
    "███████║██████╔╝ ╚███╔╝ ",
    "██╔══██║██╔═══╝  ██╔██╗ ",
    "██║  ██║██║     ██╔╝ ██╗",
    "╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝",
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const left = centerLeft(termWidth, visible(line));
    const color = i < 2 ? C.dim : i < 4 ? C.muted : C.text;
    writeLine(" ".repeat(left) + C.bold + color + line);
  }
}

function renderModeMeta(currentModeIdx, activeAgent, activeModel, maxWidth) {
  const modeText = MODES.map((mode, i) =>
    i === currentModeIdx ? C.primary + mode : C.muted + mode
  ).join(C.muted + " · ");
  const meta = `${modeText}${C.muted} · ${C.text}${C.bold}${activeAgent}${C.normal} ${C.muted}${fit(activeModel, 28)}`;
  return fitAnsi(meta, maxWidth);
}

function fitAnsi(text, width) {
  if (visible(text) <= width) return text;
  const clean = String(text).replace(ANSI_RE, "");
  return fit(clean, width);
}

function renderPanelLine(left, boxWidth, content) {
  const innerWidth = boxWidth - 2;
  writeLine(
    " ".repeat(left) +
      C.primary +
      "┃" +
      C.panel +
      " " +
      padAnsi(content, innerWidth - 1)
  );
}

function renderPromptBlock({
  centered,
  currentModeIdx,
  activeAgent,
  activeModel,
  inputText,
  cursorIndex,
  hasStarted,
}) {
  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(75, Math.max(36, termWidth - 4));
  const left = centered ? centerLeft(termWidth, boxWidth) : Math.min(2, Math.max(0, termWidth - boxWidth));
  const contentWidth = boxWidth - 3;
  const placeholder = `Ask anything... "Fix broken tests"`;
  const displayStart = Math.max(0, cursorIndex - contentWidth + 1);
  const inputVisible = inputText.slice(displayStart, displayStart + contentWidth);
  const beforeCursor = inputText.slice(displayStart, cursorIndex);
  const promptLine = inputText
    ? C.text + fit(inputVisible, contentWidth)
    : C.muted + fit(placeholder, contentWidth);
  const metaLine = renderModeMeta(currentModeIdx, activeAgent, activeModel, contentWidth);
  const hotkeys =
    plainKey("tab") +
    C.muted +
    " agents  " +
    plainKey("ctrl+p") +
    C.muted +
    " commands";
  const hotkeyLeft = Math.max(left, left + boxWidth - visible(hotkeys));

  renderPanelLine(left, boxWidth, promptLine);
  renderPanelLine(left, boxWidth, metaLine);
  writeLine(
    " ".repeat(left) +
      C.primary +
      "╹" +
      C.panel2 +
      C.dim +
      "▀".repeat(Math.max(0, boxWidth - 1))
  );
  writeLine(" ".repeat(hotkeyLeft) + hotkeys);

  const cursorCol = left + 2 + visible(beforeCursor);
  return { row: hasStarted ? -4 : null, col: cursorCol };
}

function renderCenteredPalette(paletteState, paletteOptions, paletteSelection) {
  clearFull();
  const termWidth = process.stdout.columns || 80;
  const termHeight = process.stdout.rows || 24;
  const title = paletteState === "main" ? "COMMAND PALETTE" : "SELECT MODEL";
  const width = Math.min(
    62,
    Math.max(32, Math.max(title.length + 8, ...paletteOptions.map((x) => visible(x) + 8)))
  );
  const left = centerLeft(termWidth, width);
  const top = Math.max(2, Math.floor((termHeight - (paletteOptions.length + 5)) / 2));

  for (let i = 0; i < top; i++) writeLine("");
  writeLine(" ".repeat(left) + C.panel + C.text + C.bold + padAnsi(` ${title}`, width));
  writeLine(" ".repeat(left) + C.panel + C.dim + "▀".repeat(width));
  for (let i = 0; i < paletteOptions.length; i++) {
    const active = i === paletteSelection;
    const bg = active ? C.panel2 : C.panel;
    const fg = active ? C.primary : C.text;
    const marker = active ? "›" : " ";
    writeLine(" ".repeat(left) + bg + fg + padAnsi(` ${marker} ${paletteOptions[i]}`, width));
  }
  writeLine(" ".repeat(left) + C.panel + C.dim + "▄".repeat(width));
  writeLine(
    " ".repeat(left) +
      C.muted +
      "↑↓ select  " +
      C.text +
      "enter" +
      C.muted +
      " choose  " +
      C.text +
      "esc" +
      C.muted +
      " close"
  );
}

function printToolTrace(trace = []) {
  if (!trace.length) return;
  for (const t of trace) {
    writeLine(C.magenta + "  ▨ Tool: " + C.text + C.bold + t.tool);

    if (t.tool === "edit_file") {
      const file = t.args?.path || "unknown_file";
      writeLine(C.muted + `    → modified ${file}`);
      if (t.args?.search) {
        for (const line of t.args.search.split("\n")) writeLine(C.error + `    - ${line}`);
      }
      if (t.args?.replace) {
        for (const line of t.args.replace.split("\n")) writeLine(C.success + `    + ${line}`);
      }
      continue;
    }

    if (t.tool === "write_file") {
      const file = t.args?.path || "unknown_file";
      writeLine(C.muted + `    → wrote ${file}`);
      const content = t.args?.content || t.args?.body;
      if (content) {
        const lines = content.split("\n");
        for (const line of lines.slice(0, 5)) writeLine(C.success + `    + ${line}`);
        if (lines.length > 5) writeLine(C.muted + "    ... (truncated)");
      }
      continue;
    }

    if (t.tool === "run_shell") {
      writeLine(C.muted + `    $ ${t.args?.command}`);
      if (t.result?.stdout) {
        for (const line of t.result.stdout.split("\n").slice(0, 3)) writeLine(C.dim + `    > ${line}`);
      }
      continue;
    }

    if (t.tool === "search_files") {
      writeLine(C.muted + `    searching "${t.args?.query}"`);
    }
  }
  writeLine("");
}

export async function cmdSys(args) {
  const pid = await resolveProjectId(args?.flags?.project);

  let currentModeIdx = 0;
  let inputText = "";
  let cursorIndex = 0;
  let inCommandPalette = false;
  let paletteSelection = 0;
  let paletteState = "main";
  let paletteOptions = ["Switch model", "Connect provider", "Open editor", "Exit"];

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const cfg = readConfig();
  const activeAgent = "super-agent";
  let activeModel = cfg.super_agent?.model || "Claude 3.5 Sonnet";
  let hasStarted = false;

  const previousMessages = [];

  function renderPrompt() {
    if (inCommandPalette) {
      renderCenteredPalette(paletteState, paletteOptions, paletteSelection);
      return;
    }

    if (!hasStarted) {
      clearFull();
      const termWidth = process.stdout.columns || 80;
      const termHeight = process.stdout.rows || 24;
      const topPadding = Math.max(1, Math.floor(termHeight / 2) - 9);
      for (let i = 0; i < topPadding; i++) writeLine("");
      renderLogo(termWidth);
      writeLine("");
      const cursor = renderPromptBlock({
        centered: true,
        currentModeIdx,
        activeAgent,
        activeModel,
        inputText,
        cursorIndex,
        hasStarted,
      });
      if (cursor.row === null) {
        const promptRow = topPadding + 7;
        readline.cursorTo(process.stdout, cursor.col, promptRow);
      }
      return;
    }

    clearDown();
    const cursor = renderPromptBlock({
      centered: false,
      currentModeIdx,
      activeAgent,
      activeModel,
      inputText,
      cursorIndex,
      hasStarted,
    });
    readline.moveCursor(process.stdout, 0, -4);
    readline.cursorTo(process.stdout, Math.min((process.stdout.columns || 80) - 1, cursor.col));
  }

  renderPrompt();

  let isRequesting = false;

  process.stdin.on("keypress", async (str, key) => {
    if (isRequesting) return;

    if (key.ctrl && key.name === "c") {
      writeRaw(C.reset);
      process.exit(0);
    }

    if (key.ctrl && key.name === "p") {
      inCommandPalette = !inCommandPalette;
      paletteState = "main";
      paletteOptions = ["Switch model", "Connect provider", "Open editor", "Exit"];
      paletteSelection = 0;
      renderPrompt();
      return;
    }

    if (key.name === "escape" && inCommandPalette) {
      if (paletteState !== "main") {
        paletteState = "main";
        paletteOptions = ["Switch model", "Connect provider", "Open editor", "Exit"];
        paletteSelection = 0;
      } else {
        inCommandPalette = false;
      }
      renderPrompt();
      return;
    }

    if (inCommandPalette) {
      if (key.name === "up") {
        paletteSelection = Math.max(0, paletteSelection - 1);
      } else if (key.name === "down") {
        paletteSelection = Math.min(paletteOptions.length - 1, paletteSelection + 1);
      } else if (key.name === "return") {
        const selected = paletteOptions[paletteSelection];

        if (paletteState === "main") {
          if (selected === "Exit") {
            writeRaw(C.reset);
            process.exit(0);
          }
          if (selected === "Switch model") {
            paletteState = "switch_model";
            paletteOptions = ["Loading models..."];
            paletteSelection = 0;
            renderPrompt();

            const baseUrl = cfg.engines?.ollama?.base_url || "http://127.0.0.1:11434";
            fetch(`${baseUrl}/api/tags`)
              .then((r) => r.json())
              .then((data) => {
                if (data.models?.length) {
                  paletteOptions = data.models.map((m) => "ollama:" + m.name);
                } else {
                  paletteOptions = ["No Ollama models found"];
                }
                paletteOptions.push("openai:gpt-4o", "anthropic:claude-3-5-sonnet-20240620");
                if (paletteState === "switch_model") renderPrompt();
              })
              .catch(() => {
                paletteOptions = [
                  "Failed to load from Ollama",
                  "openai:gpt-4o",
                  "anthropic:claude-3-5-sonnet-20240620",
                ];
                if (paletteState === "switch_model") renderPrompt();
              });
            return;
          }

          inCommandPalette = false;
          renderPrompt();
          writeLine(C.warning + `> Executing command: ${selected} (Not fully implemented yet)`);
          return;
        }

        if (
          paletteState === "switch_model" &&
          !selected.startsWith("Loading") &&
          !selected.startsWith("Failed") &&
          !selected.startsWith("No ")
        ) {
          activeModel = selected;
          const configModule = await import("../../core/config.js");
          const currentCfg = configModule.readConfig();
          if (!currentCfg.super_agent) currentCfg.super_agent = {};
          currentCfg.super_agent.model = selected;
          configModule.writeConfig(currentCfg);

          inCommandPalette = false;
          renderPrompt();
          writeLine(C.success + `✓ Model updated globally to ${selected}`);
          renderPrompt();
          return;
        }
      }
      renderPrompt();
      return;
    }

    if (key.name === "tab") {
      currentModeIdx = (currentModeIdx + 1) % MODES.length;
      renderPrompt();
      return;
    }

    if (key.ctrl && key.name === "a") {
      cursorIndex = 0;
      renderPrompt();
      return;
    }

    if (key.ctrl && key.name === "e") {
      cursorIndex = inputText.length;
      renderPrompt();
      return;
    }

    if (key.ctrl && key.name === "u") {
      inputText = inputText.slice(cursorIndex);
      cursorIndex = 0;
      renderPrompt();
      return;
    }

    if (key.ctrl && key.name === "w") {
      const before = inputText.slice(0, cursorIndex).replace(/\s*\S+\s*$/, "");
      inputText = before + inputText.slice(cursorIndex);
      cursorIndex = before.length;
      renderPrompt();
      return;
    }

    if (key.name === "left") {
      cursorIndex = Math.max(0, cursorIndex - 1);
      renderPrompt();
      return;
    }

    if (key.name === "right") {
      cursorIndex = Math.min(inputText.length, cursorIndex + 1);
      renderPrompt();
      return;
    }

    if (key.name === "home") {
      cursorIndex = 0;
      renderPrompt();
      return;
    }

    if (key.name === "end") {
      cursorIndex = inputText.length;
      renderPrompt();
      return;
    }

    if (key.name === "delete") {
      inputText = inputText.slice(0, cursorIndex) + inputText.slice(cursorIndex + 1);
      renderPrompt();
      return;
    }

    if (key.name === "return") {
      const text = inputText.trim();
      if (!text) return;
      if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
        writeRaw(C.reset);
        process.exit(0);
      }

      if (!hasStarted) {
        clearFull();
      } else {
        clearDown();
      }

      writeLine(C.primary + C.bold + "● You: " + C.text + text);
      writeLine("");

      hasStarted = true;
      inputText = "";
      cursorIndex = 0;
      isRequesting = true;
      const startTime = Date.now();

      writeLine(C.muted + C.italic + "  Thinking...");

      try {
        const body = {
          prompt: `[Mode: ${MODES[currentModeIdx]}]\n${text}`,
          contextNote: "Channel: terminal. Format freely using markdown, but keep it readable. Use code diffs when editing.",
          previousMessages,
          model: activeModel,
        };

        const result = await http.post(`/projects/${pid}/super-agent/chat`, body);

        process.stdout.write(C.bg + "\x1b[1A\x1b[2K\x1b[G");
        printToolTrace(result.trace);

        previousMessages.push({ role: "user", content: text });
        previousMessages.push({ role: "assistant", content: result.text });
        if (previousMessages.length > 20) previousMessages.splice(0, previousMessages.length - 20);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const inTok = result.usage?.input_tokens || 0;
        const outTok = result.usage?.output_tokens || 0;

        writeLine(C.primary + "■ " + C.text + C.bold + "SuperAgent:");
        for (const line of String(result.text || "").split("\n")) writeLine(C.text + line);
        writeLine("");
        writeLine(C.muted + `  ${elapsed}s   ·   In: ${inTok} Out: ${outTok}`);
        writeLine("");
      } catch (e) {
        process.stdout.write(C.bg + "\x1b[1A\x1b[2K\x1b[G");
        writeLine(C.error + "✖ Error: " + C.text + e.message);
        writeLine("");
      }

      isRequesting = false;
      renderPrompt();
      return;
    }

    if (key.name === "backspace") {
      if (cursorIndex === 0) return;
      inputText = inputText.slice(0, cursorIndex - 1) + inputText.slice(cursorIndex);
      cursorIndex -= 1;
      renderPrompt();
      return;
    }

    if (str && str.length === 1 && !key.ctrl && !key.meta) {
      inputText = inputText.slice(0, cursorIndex) + str + inputText.slice(cursorIndex);
      cursorIndex += str.length;
      renderPrompt();
    }
  });
}
