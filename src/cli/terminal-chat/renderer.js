import readline from "node:readline";
import fs from "node:fs";

export const MODES = ["Build", "Plan", "Zen"];
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export const C = {
  reset: "\x1b[0m",
  altOn: "\x1b[?1049h",
  altOff: "\x1b[?1049l",
  showCursor: "\x1b[?25h",
  setBgBlack: "\x1b]11;#000000\x07",
  resetBg: "\x1b]111\x07",
  bg: "\x1b[48;2;0;0;0m",
  panel: "\x1b[48;2;26;26;26m",
  panel2: "\x1b[48;2;31;31;31m",
  text: "\x1b[38;2;237;237;237m",
  muted: "\x1b[38;2;135;135;135m",
  dim: "\x1b[38;2;69;69;69m",
  primary: "\x1b[38;2;82;168;255m",
  warning: "\x1b[38;2;255;178;36m",
  error: "\x1b[38;2;229;72;77m",
  success: "\x1b[38;2;70;167;88m",
  bold: "\x1b[1m",
  normal: "\x1b[22m",
  italic: "\x1b[3m",
  noItalic: "\x1b[23m",
};

export function titlecase(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return clean.slice(0, 1).toUpperCase() + clean.slice(1);
}

export function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version || "dev";
  } catch {
    return "dev";
  }
}

function visible(text) {
  return String(text).replace(ANSI_RE, "").length;
}

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, "");
}

function fit(text, width) {
  const clean = stripAnsi(text).replace(/\r?\n/g, " ");
  if (clean.length <= width) return text;
  return clean.slice(0, Math.max(0, width - 1)) + "…";
}

function padAnsi(text, width) {
  return String(text) + " ".repeat(Math.max(0, width - visible(text)));
}

function terminalSize() {
  return {
    width: Math.max(40, process.stdout.columns || 80),
    height: Math.max(12, process.stdout.rows || 24),
  };
}

function moveTo(row, col) {
  readline.cursorTo(process.stdout, Math.max(0, col), Math.max(0, row));
}

function writeAt(row, col, text, width, bg = C.bg) {
  moveTo(row, col);
  process.stdout.write(bg + padAnsi(text, width) + C.bg);
}

function clearFull() {
  const { width, height } = terminalSize();
  process.stdout.write(C.bg + "\x1b[2J\x1b[3J\x1b[H");
  for (let row = 0; row < height; row++) {
    process.stdout.write(C.bg + " ".repeat(width));
    if (row < height - 1) process.stdout.write("\n");
  }
  process.stdout.write("\x1b[H" + C.bg);
}

function centerLeft(width, contentWidth) {
  return Math.max(0, Math.floor((width - contentWidth) / 2));
}

function wrapText(text, width) {
  const raw = String(text || "").replace(/\t/g, "  ").split(/\r?\n/);
  const out = [];
  for (const line of raw) {
    if (!line) {
      out.push("");
      continue;
    }
    let rest = line;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut < Math.floor(width * 0.5)) cut = width;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function renderLogo(termWidth, top) {
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
    writeAt(top + i, left, C.bold + color + line + C.normal, visible(line));
  }
}

function renderModeMeta(currentModeIdx, activeAgent, activeModel, maxWidth) {
  const modeText = MODES.map((mode, i) =>
    i === currentModeIdx ? C.primary + mode : C.muted + mode
  ).join(C.muted + " · ");
  const meta = `${modeText}${C.muted} · ${C.text}${C.bold}${activeAgent}${C.normal} ${C.muted}${activeModel}`;
  return visible(meta) <= maxWidth ? meta : C.muted + fit(stripAnsi(meta), maxWidth);
}

function promptGeometry(centered, hasStarted, chatWidth) {
  const { width, height } = terminalSize();
  const boxWidth = hasStarted
    ? Math.max(36, chatWidth - 4)
    : Math.min(75, Math.max(36, width - 4));
  const left = centered ? centerLeft(width, boxWidth) : 2;
  const top = hasStarted ? Math.max(0, height - 7) : Math.max(1, Math.floor(height / 2));
  return { left, top, boxWidth };
}

function renderPromptBlock(state, chatWidth) {
  const {
    currentModeIdx,
    activeAgent,
    activeModel,
    inputText,
    cursorIndex,
    hasStarted,
  } = state;
  const { left, top, boxWidth } = promptGeometry(!hasStarted, hasStarted, chatWidth);
  const contentWidth = boxWidth - 3;
  const placeholder = `Ask anything... "Fix broken tests"`;
  const displayStart = Math.max(0, cursorIndex - contentWidth + 1);
  const inputVisible = inputText.slice(displayStart, displayStart + contentWidth);
  const beforeCursor = inputText.slice(displayStart, cursorIndex);
  const promptLine = inputText
    ? C.text + fit(inputVisible, contentWidth)
    : C.muted + C.italic + fit(placeholder, contentWidth) + C.noItalic;
  const metaLine = renderModeMeta(currentModeIdx, activeAgent, activeModel, contentWidth);

  writeAt(top, left, C.primary + "┃" + C.panel + " " + " ".repeat(contentWidth), boxWidth, C.bg);
  writeAt(top + 1, left, C.primary + "┃" + C.panel + " " + padAnsi(promptLine, contentWidth), boxWidth, C.bg);
  writeAt(top + 2, left, C.primary + "┃" + C.panel + " " + " ".repeat(contentWidth), boxWidth, C.bg);
  writeAt(top + 3, left, C.primary + "┃" + C.panel + " " + padAnsi(metaLine, contentWidth), boxWidth, C.bg);
  writeAt(top + 4, left, C.primary + "╹" + C.panel + " " + " ".repeat(contentWidth), boxWidth, C.bg);

  const hotkeys =
    C.bold + C.text + "tab" + C.normal + C.muted + " agents  " +
    C.bold + C.text + "ctrl+p" + C.normal + C.muted + " commands  " +
    C.bold + C.text + "enter" + C.normal + C.muted + " send";
  const hotkeyLeft = Math.max(left, left + boxWidth - visible(hotkeys));
  writeAt(top + 5, hotkeyLeft, hotkeys, visible(hotkeys), C.bg);

  return { row: top + 1, col: left + 2 + visible(beforeCursor) };
}

function addLine(lines, text = "", bg = C.bg) {
  lines.push({ text, bg });
}

function toolLabel(tool) {
  return {
    read_file: "Read",
    write_file: "Wrote",
    edit_file: "Edit",
    search_files: "Search",
    run_shell: "Shell",
    list_files: "List",
    list_projects: "Projects",
    list_agents: "Agents",
    tail_messages: "Messages",
  }[tool] || tool;
}

function parseTraceResult(result) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function resultPreview(result) {
  const parsed = parseTraceResult(result);
  if (!parsed) return "";
  if (typeof parsed === "string") return parsed;
  if (parsed.error) return String(parsed.error);
  if (parsed.content) return String(parsed.content);
  if (parsed.stdout) return String(parsed.stdout);
  if (parsed.path) return String(parsed.path);
  return JSON.stringify(parsed);
}

function addToolBlock(lines, item, width) {
  const trace = item.trace || {};
  const args = trace.args || {};
  const label = toolLabel(trace.tool);
  const target = args.path || args.query || args.command || args.project || "";
  const inner = Math.max(12, width - 12);
  const margin = "    ";

  addLine(lines, "", C.bg);
  addLine(lines, margin + C.muted + `→ ${label}${target ? " " + fit(String(target), inner) : ""}`, C.bg);

  if (trace.pending) {
    addLine(lines, margin + C.dim + "  " + C.muted + "running...", C.bg);
    return;
  }

  if (trace.tool === "write_file") {
    const heading = `# Wrote ${args.path || "file"}`;
    addLine(lines, margin + C.panel + " " + C.muted + heading + " ".repeat(Math.max(0, inner - visible(heading))), C.bg);
    for (const chunk of wrapText(args.content || "", inner).slice(0, 8)) {
      addLine(lines, margin + C.panel + " " + C.text + padAnsi(chunk, inner), C.bg);
    }
    return;
  }

  if (trace.tool === "edit_file") {
    const heading = `← Edit ${args.path || "file"}`;
    addLine(lines, margin + C.panel + " " + C.muted + heading + " ".repeat(Math.max(0, inner - visible(heading))), C.bg);
    for (const chunk of wrapText(args.search || "", inner - 2).slice(0, 5)) {
      addLine(lines, margin + C.panel + " " + C.error + "- " + padAnsi(chunk, inner - 2), C.bg);
    }
    for (const chunk of wrapText(args.replace || "", inner - 2).slice(0, 5)) {
      addLine(lines, margin + C.panel + " " + C.success + "+ " + padAnsi(chunk, inner - 2), C.bg);
    }
    return;
  }

  const preview = resultPreview(trace.result);
  if (!preview) return;
  for (const chunk of wrapText(preview, inner).slice(0, 6)) {
    addLine(lines, margin + C.dim + "  " + C.muted + chunk, C.bg);
  }
}

function transcriptLines(transcript, width) {
  const lines = [];
  const inner = Math.max(10, width - 8);
  const margin = "  ";

  for (const item of transcript) {
    if (item.type === "user") {
      addLine(lines, "", C.bg);
      const chunks = wrapText(item.text, inner - 1);
      addLine(lines, margin + C.primary + "┃" + C.panel + " " + " ".repeat(inner), C.bg);
      for (const chunk of chunks) {
        addLine(lines, margin + C.primary + "┃" + C.panel + " " + C.text + padAnsi(chunk, inner), C.bg);
      }
      if (item.meta) {
        addLine(lines, margin + C.primary + "┃" + C.panel + " " + C.muted + padAnsi(item.meta, inner), C.bg);
      }
      addLine(lines, margin + C.primary + "┃" + C.panel + " " + " ".repeat(inner), C.bg);
      continue;
    }

    if (item.type === "assistant") {
      addLine(lines, "", C.bg);
      addLine(lines, margin + C.primary + "■ " + C.text + C.bold + `${item.name}:` + C.normal, C.bg);
      for (const raw of String(item.text || "").split(/\r?\n/)) {
        const isThinking = raw.trim().startsWith("Thinking:");
        const color = isThinking ? C.warning + C.italic : C.text;
        const end = isThinking ? C.noItalic : "";
        const prefix = isThinking ? margin + C.dim + "┃ " : margin + "  ";
        if (isThinking) addLine(lines, "", C.bg);
        for (const chunk of wrapText(raw, width - 6)) {
          addLine(lines, prefix + color + chunk + end, C.bg);
        }
        if (isThinking) addLine(lines, "", C.bg);
      }
      if (item.meta) addLine(lines, margin + "  " + C.muted + item.meta, C.bg);
      continue;
    }

    if (item.type === "tool") {
      addToolBlock(lines, item, width);
      continue;
    }

    if (item.type === "status") {
      addLine(lines, margin + C.muted + C.italic + item.text + C.noItalic, C.bg);
      continue;
    }

    if (item.type === "error") {
      addLine(lines, margin + C.error + "✖ Error: " + C.text + item.text, C.bg);
    }
  }

  return lines;
}

function renderChat(state, chatWidth, height, promptTop) {
  const maxRows = Math.max(1, promptTop - 1);
  const lines = transcriptLines(state.transcript, chatWidth - 2);
  const maxOffset = Math.max(0, lines.length - maxRows);
  const offset = Math.min(Math.max(0, state.chatScrollOffset || 0), maxOffset);
  state.chatScrollOffset = offset;
  const start = Math.max(0, lines.length - maxRows - offset);
  const slice = lines.slice(start, start + maxRows);

  for (let i = 0; i < slice.length && i < maxRows; i++) {
    writeAt(i, 0, slice[i].text, chatWidth - 1, slice[i].bg);
  }

  if (offset > 0 && maxRows > 1) {
    writeAt(0, 0, C.muted + `↑ ${offset} lines above bottom`, chatWidth - 1, C.bg);
  }
}

function renderSidebar(state) {
  const { width, height } = terminalSize();
  if (width < 84) return null;

  const sideWidth = Math.min(34, Math.max(28, Math.floor(width * 0.3)));
  const left = width - sideWidth;
  for (let row = 0; row < height; row++) {
    writeAt(row, left, "", sideWidth, C.panel);
  }

  const contentWidth = sideWidth - 4;
  const totalTokens = state.usage.input + state.usage.output;

  writeAt(1, left + 2, C.text + C.bold + "Sesión" + C.normal, contentWidth, C.panel);
  writeAt(2, left + 2, C.muted + fit(state.sessionTitle || "chat local", contentWidth), contentWidth, C.panel);
  writeAt(3, left + 2, C.muted + "agent " + C.text + state.activeAgent, contentWidth, C.panel);
  writeAt(4, left + 2, C.muted + "app " + C.text + `APX ${state.version}`, contentWidth, C.panel);

  writeAt(6, left + 2, C.text + C.bold + "Modelo" + C.normal, contentWidth, C.panel);
  const modelLines = wrapText(state.activeModel || "(none)", contentWidth).slice(0, 2);
  modelLines.forEach((line, index) => {
    writeAt(7 + index, left + 2, C.muted + line, contentWidth, C.panel);
  });

  writeAt(10, left + 2, C.text + C.bold + "Contexto" + C.normal, contentWidth, C.panel);
  writeAt(11, left + 2, C.muted + `${totalTokens.toLocaleString()} tokens total`, contentWidth, C.panel);
  writeAt(12, left + 2, C.muted + `${state.usage.input.toLocaleString()} in · ${state.usage.output.toLocaleString()} out`, contentWidth, C.panel);
  writeAt(13, left + 2, C.muted + `${state.usage.percent}% usado`, contentWidth, C.panel);
  writeAt(14, left + 2, C.muted + "$0.00 spent", contentWidth, C.panel);

  writeAt(16, left + 2, C.text + C.bold + "LSP" + C.normal, contentWidth, C.panel);
  writeAt(17, left + 2, C.muted + "LSPs are disabled", contentWidth, C.panel);

  const cwdLines = wrapText(process.cwd(), contentWidth).slice(-4);
  let row = Math.max(19, height - cwdLines.length - 4);
  writeAt(row++, left + 2, C.text + C.bold + "Directorio" + C.normal, contentWidth, C.panel);
  for (const line of cwdLines) writeAt(row++, left + 2, C.muted + line, contentWidth, C.panel);
  writeAt(height - 1, left + 2, C.success + "• " + C.text + "APX" + C.muted + ` ${state.version}`, contentWidth, C.panel);

  return { left, width: sideWidth };
}

function renderPaletteOverlay(state) {
  const { width, height } = terminalSize();
  const title = state.paletteState === "main" ? "COMMAND PALETTE" : "SELECT MODEL";
  const boxWidth = Math.min(
    62,
    Math.max(32, Math.max(title.length + 8, ...state.paletteOptions.map((x) => visible(x) + 8)))
  );
  const boxHeight = state.paletteOptions.length + 4;
  const left = centerLeft(width, boxWidth);
  const top = Math.max(1, Math.floor((height - boxHeight) / 2));

  writeAt(top, left, C.text + C.bold + " " + title + C.normal, boxWidth, C.panel);
  writeAt(top + 1, left, C.dim + "▀".repeat(boxWidth), boxWidth, C.panel);
  for (let i = 0; i < state.paletteOptions.length; i++) {
    const active = i === state.paletteSelection;
    const marker = active ? "›" : " ";
    const bg = active ? C.panel2 : C.panel;
    const fg = active ? C.primary + C.bold : C.text;
    writeAt(top + 2 + i, left, fg + ` ${marker} ${state.paletteOptions[i]}` + C.normal, boxWidth, bg);
  }
  writeAt(top + 2 + state.paletteOptions.length, left, C.dim + "▄".repeat(boxWidth), boxWidth, C.panel);
  writeAt(
    top + 3 + state.paletteOptions.length,
    left,
    C.muted + "↑↓ select  " + C.text + C.bold + "enter" + C.normal + C.muted + " choose  " + C.text + C.bold + "esc" + C.normal + C.muted + " close",
    boxWidth,
    C.bg
  );
}

export function renderTerminalChat(state) {
  clearFull();
  const { width, height } = terminalSize();
  const sidebar = state.hasStarted ? renderSidebar(state) : null;
  const chatWidth = sidebar ? sidebar.left : width;

  if (!state.hasStarted) {
    renderLogo(chatWidth, Math.max(1, Math.floor(height / 2) - 8));
  } else {
    const prompt = promptGeometry(false, true, chatWidth);
    renderChat(state, chatWidth, height, prompt.top);
  }

  const cursor = renderPromptBlock(state, chatWidth);

  if (state.inCommandPalette) renderPaletteOverlay(state);
  if (!state.inCommandPalette) moveTo(cursor.row, cursor.col);
}
