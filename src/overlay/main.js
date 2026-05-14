// APX Overlay — Electron main process.
// Provides: system tray icon, configurable global shortcut, transparent
// floating chat window, WebSocket connection to APX daemon.
//
// Default shortcut: Cmd+Shift+\ (Mac) / Ctrl+Shift+\ (Win/Linux).
// Override in ~/.apx/config.json:  "overlay": { "shortcut": "CommandOrControl+Shift+Space" }
//
// Launch via: electron src/overlay/main.js [--port 7430] [--shortcut <accel>]
// Or via:     apx overlay start

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

// Default shortcut: Cmd/Ctrl + Shift + \  (backslash — rarely used by other apps)
// User can override via config overlay.shortcut or --shortcut CLI arg.
const DEFAULT_SHORTCUT = "CommandOrControl+G";

function readApxConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

function getShortcut() {
  const fromArg = getArg("--shortcut");
  if (fromArg) return fromArg;
  const cfg = readApxConfig();
  return cfg?.overlay?.shortcut || DEFAULT_SHORTCUT;
}

function readToken() {
  try { return fs.readFileSync(TOKEN_PATH, "utf8").trim(); } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Window size + position helpers
// ---------------------------------------------------------------------------

const WIN_W = 420;
const WIN_H = 560;

function getWindowPosition() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const isMac = process.platform === "darwin";
  if (isMac) {
    // Top-right, below menu bar (workArea.y already accounts for it)
    return { x: workArea.x + workArea.width - WIN_W - 12, y: workArea.y + 8 };
  }
  // Windows/Linux: bottom-right, above taskbar
  return {
    x: workArea.x + workArea.width - WIN_W - 12,
    y: workArea.y + workArea.height - WIN_H - 12,
  };
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

// On macOS, don't show in the dock — it's a tray-only utility
if (process.platform === "darwin") app.dock?.hide();

app.whenReady().then(() => {
  console.log(`overlay: starting — daemon ${DAEMON_HOST}:${DAEMON_PORT} — pid ${process.pid}`);
  try { createTray();        console.log("overlay: tray created"); }
  catch (e) { console.error("overlay: createTray failed:", e.message); }
  try { createWindow();      console.log("overlay: window created"); }
  catch (e) { console.error("overlay: createWindow failed:", e.message); }
  try { registerShortcut(); }
  catch (e) { console.error("overlay: registerShortcut failed:", e.message); }
  connectDaemon();
});

process.on("uncaughtException", (e) => {
  console.error("overlay: uncaught exception:", e.stack || e.message);
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

// Minimal valid 16x16 transparent PNG (base64).
// macOS requires a real PNG for Tray — raw RGBA buffers are not accepted.
// We use setTitle() to display the visible symbol in the menu bar.
const ICON_TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCS" +
  "VQICAgIfAhkiAAAAAlwSFlzAAALEwAACxMBAJqcGAAAABl0RVh0U29" +
  "mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAOSURBVDiNY2Bg" +
  "YPgPAAEEAQABZQMuAAAAAElFTkSuQmCC";

// Red dot PNG for recording state (16x16 solid red circle).
const ICON_RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAASUlEQVQ4" +
  "y2NgYGD4z0ABYBpFkKoFVAMDA8N/CiygWgMDA8N/qgygWgMDA8N/og" +
  "ygSgMDA8N/igygWgMDA8N/BgYGBgCZJCULAAAAAElFTkSuQmCC";

function buildTrayIcon(recording) {
  const b64 = recording ? ICON_RED_PNG : ICON_TRANSPARENT_PNG;
  const img = nativeImage.createFromDataURL(`data:image/png;base64,${b64}`);
  // Template image: macOS auto-adapts colour to dark/light menu bar
  if (process.platform === "darwin") img.setTemplateImage(!recording);
  return img;
}

function createTray() {
  const icon = buildTrayIcon(false);
  tray = new Tray(icon);

  // On macOS, setTitle shows text right in the menu bar (most visible approach)
  if (process.platform === "darwin") tray.setTitle(" ◉");

  tray.setToolTip("APX Voice Overlay — click to toggle, right-click for menu");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show / Hide",    click: toggleWindow },
    { label: "Start Recording", click: startRecording },
    { type: "separator" },
    { label: "Quit APX Overlay", click: () => app.exit(0) },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", toggleWindow);
}

function updateTrayRecording(rec) {
  if (!tray) return;
  tray.setImage(buildTrayIcon(rec));
  if (process.platform === "darwin") tray.setTitle(rec ? " ⏺" : " ◉");
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const pos = getWindowPosition();
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow getUserMedia for microphone access
      allowRunningInsecureContent: false,
    },
  });

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
  const pos = getWindowPosition();
  mainWindow.setPosition(pos.x, pos.y);
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
  const shortcut = getShortcut();
  const ok = globalShortcut.register(shortcut, () => {
    if (!overlayVisible) {
      showOverlay();
      // Auto-start recording when opening via shortcut
      setTimeout(startRecording, 150);
    } else if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
  if (!ok) {
    console.error(`overlay: failed to register shortcut "${shortcut}". Try a different shortcut in ~/.apx/config.json: overlay.shortcut`);
  } else {
    console.log(`overlay: shortcut registered: ${shortcut}`);
  }
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
    console.log(`overlay: transcribe chunk — ${buffer.byteLength}b ${format}`);
    const result = await transcribeChunk(Buffer.from(buffer), format || "webm", language || "auto");
    if (result?.ok) console.log(`overlay: transcribed → "${(result.text || "").slice(0, 80)}"`);
    else console.error("overlay: transcription error:", result?.error);
    return result;
  } catch (e) {
    console.error("overlay: transcribeChunk exception:", e.message);
    return { ok: false, error: e.message };
  }
});

// Renderer sends final transcribed text to daemon
ipcMain.handle("send-message", async (_event, { text, previousMessages }) => {
  console.log(`overlay: send-message → "${text.slice(0, 80)}"`);
  return sendMessageToDaemon(text, previousMessages || []);
});

// Renderer requests cancel
ipcMain.handle("cancel", async () => {
  if (wsConn && wsConn.readyState === 1) {
    wsConn.send(JSON.stringify({ type: "cancel" }));
  }
  stopRecording();
});

// Renderer requests close/hide
ipcMain.handle("close-overlay", async () => {
  hideOverlay();
});

// Renderer queries the configured shortcut for display
ipcMain.handle("get-shortcut", () => getShortcut());

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
    console.warn("overlay: 'ws' module not found — WebSocket disabled. Install with: npm install ws");
    return;
  }

  const token = readToken();
  const url = `ws://${DAEMON_HOST}:${DAEMON_PORT}/overlay/ws`;

  function connect() {
    try {
      wsConn = new WS(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      wsConn.on("open", () => {
        console.log("overlay: connected to daemon");
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
        console.warn("overlay ws error:", e.message);
      });
    } catch (e) {
      console.warn("overlay: connect failed —", e.message);
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
      path: "/overlay/message",
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
