// APX Desktop — Electron main process.
// Provides: system tray icon, configurable global shortcut, transparent
// floating chat window, WebSocket connection to APX daemon.
//
// Default shortcut: Cmd+G (Mac) / Ctrl+G (Win/Linux).
// Override in ~/.apx/config.json:  "desktop": { "shortcut": "CommandOrControl+Shift+Space" }
//
// Launch via: electron src/interfaces/desktop/main.js [--port 7430] [--shortcut <accel>]
// Or via:     apx desktop start

"use strict";
const { app, BrowserWindow, Tray, globalShortcut, ipcMain, nativeImage, screen, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

// ---------------------------------------------------------------------------
// Config from CLI args or env
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const DAEMON_PORT = parseInt(getArg("--port") || process.env.APX_PORT || "7430", 10);
const DAEMON_HOST = getArg("--host") || process.env.APX_HOST || "127.0.0.1";
const WHISPER_PORT = 18765;
const TOKEN_PATH  = path.join(os.homedir(), ".apx", "daemon.token");
const CONFIG_PATH = path.join(os.homedir(), ".apx", "config.json");

// Default shortcut: Cmd/Ctrl + G.
// User can override via config desktop.shortcut or --shortcut CLI arg.
const DEFAULT_SHORTCUT = "CommandOrControl+G";

function readApxConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

function getShortcut() {
  const fromArg = getArg("--shortcut");
  if (fromArg) return fromArg;
  const cfg = readApxConfig();
  return cfg?.desktop?.shortcut || cfg?.overlay?.shortcut || DEFAULT_SHORTCUT;
}

function readToken() {
  try { return fs.readFileSync(TOKEN_PATH, "utf8").trim(); } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Window size + position helpers
// ---------------------------------------------------------------------------
//
// The v2 design is a floating capsule (~480×80) that grows to fit a chat card
// (~480 × up to 600) when there is a conversation. The window starts small
// and the renderer asks main to resize via the "resize-window" IPC.

const WIN_W   = 480;
const WIN_H_MIN = 80;     // just the capsule + margins (idle, no conv)
const WIN_H_MAX = 760;    // capsule + full conv + session bar
const WIN_MARGIN = 14;    // edge padding (matches .float-root inset in CSS)

function getPosition() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const p = cfg?.desktop?.position;
    if (p === "left" || p === "center" || p === "right") return p;
  } catch {}
  return "right";
}

function getTheme() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const t = cfg?.desktop?.theme;
    if (t === "light" || t === "dark") return t;
  } catch {}
  return "light";
}

function getWindowOrigin(height) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const pos = getPosition();
  const top = workArea.y + (process.platform === "darwin" ? 8 : 12);
  if (pos === "left")   return { x: workArea.x + WIN_MARGIN, y: top };
  if (pos === "center") return { x: workArea.x + Math.round((workArea.width - WIN_W) / 2), y: top };
  /* right */            return { x: workArea.x + workArea.width - WIN_W - WIN_MARGIN, y: top };
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let mainWindow = null;
let tray = null;
let wsConn = null; // WebSocket to daemon
let isRecording = false;
let overlayVisible = false;

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Asset paths — real PNG logos (apx/assets/favicon/dark/*) copied to
// src/interfaces/desktop/assets/ at install time.
const TRAY_ICON_PATH      = path.join(__dirname, "assets", "tray-icon.png");      // 180×180 apple-touch
const TRAY_ICON_REC_PATH  = path.join(__dirname, "assets", "tray-icon.png");      // same; tinted in JS
const APP_ICON_PATH       = path.join(__dirname, "assets", "app-icon-180.png");   // dock / window icon

// On macOS, hide from the dock AND from Cmd+Tab. "accessory" is the modern
// equivalent of LSUIElement=true — works without repackaging Electron's
// Info.plist. Falls back to plain dock.hide() on older Electron builds.
if (process.platform === "darwin") {
  try {
    if (typeof app.setActivationPolicy === "function") app.setActivationPolicy("accessory");
    else app.dock?.hide();
  } catch { app.dock?.hide(); }
}

app.whenReady().then(() => {
  console.log(`desktop: starting — daemon ${DAEMON_HOST}:${DAEMON_PORT} — pid ${process.pid}`);
  try { createTray();        console.log("desktop: tray created"); }
  catch (e) { console.error("desktop: createTray failed:", e.message); }
  try { createWindow();      console.log("desktop: window created"); }
  catch (e) { console.error("desktop: createWindow failed:", e.message); }
  try { registerShortcut(); }
  catch (e) { console.error("desktop: registerShortcut failed:", e.message); }
  connectDaemon();
});

process.on("uncaughtException", (e) => {
  console.error("desktop: uncaught exception:", e.stack || e.message);
});

app.on("window-all-closed", (e) => {
  // Prevent app from quitting when window closes — keep in tray
  e.preventDefault?.();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

// Build a tray-sized NativeImage from the real APX logo. macOS auto-fits
// to ~18pt; Windows/Linux to ~16px. We NOT mark it as template image because
// the logo is a coloured glyph (looks washed out if forced monochrome).
function buildTrayIcon(_recording) {
  let img;
  try {
    img = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (img.isEmpty()) throw new Error("empty image");
  } catch (e) {
    console.warn(`desktop: tray icon load failed (${e.message}) — falling back to empty icon`);
    return nativeImage.createEmpty();
  }
  // Down-scale for the menu bar; macOS expects 18×18, others 16×16.
  const target = process.platform === "darwin" ? 18 : 16;
  return img.resize({ width: target, height: target, quality: "best" });
}

function createTray() {
  const icon = buildTrayIcon(false);
  tray = new Tray(icon);

  // No extra text label on macOS — the icon is the brand mark.
  tray.setToolTip("APX Desktop — click to toggle, right-click for menu");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show / Hide",    click: toggleWindow },
    { label: "Start Recording", click: () => { showOverlay(); startRecording(); } },
    { type: "separator" },
    { label: "Quit APX Desktop", click: () => app.exit(0) },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", toggleWindow);
}

function updateTrayRecording(rec) {
  if (!tray) return;
  // Recording state is signalled with a red ⏺ in the title; the icon stays.
  if (process.platform === "darwin") tray.setTitle(rec ? " ⏺" : "");
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const origin = getWindowOrigin(WIN_H_MIN);
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H_MIN,
    x: origin.x,
    y: origin.y,
    minWidth: WIN_W,
    minHeight: WIN_H_MIN,
    maxWidth: WIN_W,
    maxHeight: WIN_H_MAX,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    icon: APP_ICON_PATH,   // used by Windows/Linux taskbar; mac uses dock.setIcon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow getUserMedia for microphone access
      allowRunningInsecureContent: false,
    },
  });
  // macOS dock icon (only visible if accessory policy ever flips back to regular)
  if (process.platform === "darwin" && app.dock?.setIcon) {
    try { app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH)); } catch {}
  }

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("blur", () => {
    // Don't auto-hide while recording or streaming
    if (!isRecording) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isFocused() && !isRecording) {
          // Keep visible — user might be reading the response
        }
      }, 200);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  // ESC key handled in renderer via preload
}

function toggleWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (overlayVisible) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

function showOverlay() {
  if (!mainWindow) createWindow();
  const [, currentH] = mainWindow.getSize();
  const origin = getWindowOrigin(currentH);
  mainWindow.setPosition(origin.x, origin.y);
  mainWindow.show();
  mainWindow.focus();
  overlayVisible = true;
}

function hideOverlay() {
  if (mainWindow) mainWindow.hide();
  overlayVisible = false;
  if (isRecording) stopRecording();
}

// ---------------------------------------------------------------------------
// Global shortcut: Cmd/Ctrl+Shift+Space toggles recording
// ---------------------------------------------------------------------------

function registerShortcut() {
  // Primary: configured shortcut → toggle window + start/stop recording
  const shortcut = getShortcut();
  const ok = globalShortcut.register(shortcut, () => {
    if (!overlayVisible) {
      showOverlay();
      // Auto-start recording when opening via shortcut.
      // 250ms gives the renderer time to attach onRecordingStart before
      // we send it — otherwise the first activation is dropped.
      setTimeout(startRecording, 250);
    } else if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
  if (!ok) {
    console.error(`desktop: failed to register shortcut "${shortcut}". Try a different shortcut in ~/.apx/config.json: desktop.shortcut`);
  } else {
    console.log(`desktop: shortcut registered: ${shortcut}`);
  }

  // Secondary: Alt+/ (Option+/ on mac) → show window + focus the text input
  const focusAccel = "Alt+/";
  const ok2 = globalShortcut.register(focusAccel, () => {
    showOverlay();
    setTimeout(() => mainWindow?.webContents.send("focus-input"), 80);
  });
  if (ok2) console.log(`desktop: focus shortcut registered: ${focusAccel}`);
  else     console.warn(`desktop: failed to register focus shortcut "${focusAccel}"`);
}

// ---------------------------------------------------------------------------
// Recording control
// ---------------------------------------------------------------------------

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  updateTrayRecording(true);
  mainWindow?.webContents.send("recording-start");
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  updateTrayRecording(false);
  mainWindow?.webContents.send("recording-stop");
}

// ---------------------------------------------------------------------------
// IPC handlers (renderer → main)
// ---------------------------------------------------------------------------

// Renderer sends audio chunk for transcription
ipcMain.handle("transcribe-chunk", async (_event, { buffer, format, language }) => {
  try {
    console.log(`desktop: transcribe chunk — ${buffer.byteLength}b ${format}`);
    const result = await transcribeChunk(Buffer.from(buffer), format || "webm", language || "auto");
    if (result?.ok) console.log(`desktop: transcribed → "${(result.text || "").slice(0, 80)}"`);
    else console.error("desktop: transcription error:", result?.error);
    return result;
  } catch (e) {
    console.error("desktop: transcribeChunk exception:", e.message);
    return { ok: false, error: e.message };
  }
});

// Renderer sends final transcribed text to daemon
ipcMain.handle("send-message", async (_event, { text, previousMessages }) => {
  console.log(`desktop: send-message → "${text.slice(0, 80)}"`);
  return sendMessageToDaemon(text, previousMessages || []);
});

// Renderer requests cancel
ipcMain.handle("cancel", async () => {
  if (wsConn && wsConn.readyState === 1) {
    wsConn.send(JSON.stringify({ type: "cancel" }));
  }
  stopRecording();
});

// Renderer requests close/hide (legacy "close-overlay" still accepted)
ipcMain.handle("close-desktop", async () => { hideOverlay(); });
ipcMain.handle("close-overlay", async () => { hideOverlay(); });

// Renderer queries the configured shortcut for display
ipcMain.handle("get-shortcut", () => getShortcut());
ipcMain.handle("get-theme",    () => getTheme());
ipcMain.handle("get-position", () => getPosition());

// Renderer asks main to grow/shrink the window to fit its content.
// Clamped to [WIN_H_MIN, WIN_H_MAX]; same anchor (top edge stays put).
ipcMain.on("resize-window", (_e, { height }) => {
  if (!mainWindow) return;
  const h = Math.max(WIN_H_MIN, Math.min(WIN_H_MAX, Math.ceil(height) || WIN_H_MIN));
  const [w, currentH] = mainWindow.getSize();
  if (h === currentH) return;
  mainWindow.setSize(w, h, /* animate */ false);
});

// Renderer asks for TTS playback of the agent reply. We synthesize via the
// daemon and pipe the audio path back as a daemon-event the renderer already
// knows how to consume (tts-ready { url, duration } / tts-failed).
ipcMain.handle("request-tts", async (_e, { text }) => {
  if (!text || !text.trim()) {
    mainWindow?.webContents.send("daemon-event", { type: "tts-failed" });
    return;
  }
  try {
    const result = await daemonTtsSay(text);
    if (result?.ok && result.audio_path) {
      // Expose the local file via file:// — preload's contextIsolation lets
      // the renderer's <audio> tag fetch it directly.
      const url = "file://" + result.audio_path;
      mainWindow?.webContents.send("daemon-event", {
        type: "tts-ready",
        url,
        duration: result.duration_s || 0,
      });
    } else {
      mainWindow?.webContents.send("daemon-event", { type: "tts-failed", error: result?.error || "no audio" });
    }
  } catch (e) {
    mainWindow?.webContents.send("daemon-event", { type: "tts-failed", error: e.message });
  }
});

// Check if the whisper server is running and the model is loaded
ipcMain.handle("check-whisper-ready", () => {
  return new Promise((resolve) => {
    const options = {
      hostname: "127.0.0.1",
      port: WHISPER_PORT,
      path: "/health",
      method: "GET",
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({ ready: json.ok && json.loaded === true });
        } catch {
          resolve({ ready: false });
        }
      });
    });
    req.on("error", () => resolve({ ready: false }));
    req.setTimeout(800, () => { req.destroy(); resolve({ ready: false }); });
    req.end();
  });
});

// Renderer requests recording toggle (ESC cancels, shortcut toggles)
ipcMain.handle("toggle-recording", async () => {
  if (isRecording) stopRecording(); else startRecording();
});

// ---------------------------------------------------------------------------
// Whisper chunk transcription — proxied through the daemon (auto-starts whisper server)
// ---------------------------------------------------------------------------

function transcribeChunk(buf, format, language) {
  return new Promise((resolve, reject) => {
    const token = readToken();
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/transcribe/chunk",
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": buf.length,
        "X-Audio-Format": format,
        "X-Language": language,
        // Overlay is real-time → local whisper only. Never fall back to OpenAI.
        "X-Provider": "local",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("bad json from daemon")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("transcription timeout")); });
    req.write(buf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Daemon communication
// ---------------------------------------------------------------------------

function connectDaemon() {
  // Lazy-load ws from the APX node_modules (co-located)
  let WS;
  try {
    WS = require("ws");
  } catch {
    console.warn("desktop: 'ws' module not found — WebSocket disabled. Install with: npm install ws");
    return;
  }

  const token = readToken();
  const url = `ws://${DAEMON_HOST}:${DAEMON_PORT}/desktop/ws`;

  function connect() {
    try {
      wsConn = new WS(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      wsConn.on("open", () => {
        console.log("desktop: connected to daemon");
        resetReconnectDelay();
        mainWindow?.webContents.send("daemon-connected");
      });

      wsConn.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        // Forward all daemon events to the renderer
        mainWindow?.webContents.send("daemon-event", msg);
      });

      wsConn.on("close", () => {
        wsConn = null;
        mainWindow?.webContents.send("daemon-disconnected");
        scheduleReconnect();
      });

      wsConn.on("error", (e) => {
        console.warn("desktop ws error:", e.message);
      });
    } catch (e) {
      console.warn("desktop: connect failed —", e.message);
      scheduleReconnect();
    }
  }

  // Exponential backoff with cap: 1s → 2s → 4s → … → 30s. Resets to 1s
  // after a successful open() (see below).
  let reconnectDelay = 1000;
  function scheduleReconnect() {
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    setTimeout(connect, delay);
  }
  function resetReconnectDelay() { reconnectDelay = 1000; }

  connect();
}

async function sendMessageToDaemon(text, previousMessages) {
  const token = readToken();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, previousMessages });
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/desktop/message",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: true }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Call POST /tts/say { text } → { ok, audio_path, duration_s, provider }.
// Returns { ok:false, error } if TTS is not configured or the request fails.
function daemonTtsSay(text) {
  const token = readToken();
  return new Promise((resolve) => {
    const body = JSON.stringify({ text });
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/tts/say",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && json.audio_path) {
            resolve({ ok: true, ...json });
          } else {
            resolve({ ok: false, error: json.error || `HTTP ${res.statusCode}` });
          }
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(60_000, () => { req.destroy(); resolve({ ok: false, error: "tts timeout" }); });
    req.write(body);
    req.end();
  });
}
