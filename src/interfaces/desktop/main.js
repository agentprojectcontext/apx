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
const { app, BrowserWindow, Tray, globalShortcut, ipcMain, nativeImage, screen, Menu, shell } = require("electron");
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

// Voice-capture timing for the listening capsule. Overridable in config.json:
//   "desktop": { "silence_ms": 1200, "voice_rms": 0.025 }
// silence_ms — quiet after speech before auto-send. voice_rms — RMS above
// which audio counts as voice (lower = more sensitive).
function getVoiceTiming() {
  const cfg = readApxConfig();
  const d = cfg?.desktop || cfg?.overlay || {};
  const num = (v, def) => (typeof v === "number" && isFinite(v) ? v : def);
  return {
    silence_ms: Math.max(400, num(d.silence_ms, 1200)),
    voice_rms:  Math.max(0,   num(d.voice_rms,  0.025)),
  };
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

const WIN_W   = 540;      // wider capsule + conv card (was 480 — felt cramped)
const WIN_H_MIN = 88;     // just the capsule + top/bottom padding (idle, no conv)
const WIN_MARGIN = 14;    // edge padding (matches .float-root inset in CSS)

// Cap window height at ~80% of the primary work area so the buttons never
// clip and it always fits in the upper portion of any laptop screen.
// Computed lazily — screen.getPrimaryDisplay() is only valid after app.ready.
function getMaxWindowHeight() {
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    return Math.max(600, Math.min(1200, Math.round(wa.height * 0.8)));
  } catch { return 820; }
}

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
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {}
  // "system" follows the OS appearance (the renderer resolves it via
  // prefers-color-scheme). It's the default so a fresh install matches the
  // user's macOS/Windows light/dark setting out of the box.
  return "system";
}

// Resolve the agent's display name from ~/.apx/identity.json + config.
// identity.agent_name is the display name ("Roby"); super_agent.name is an
// internal slug ("apx"). Show the human one first. Falls back to
// "Superagente" only if nothing is configured at all.
const IDENTITY_PATH = path.join(os.homedir(), ".apx", "identity.json");
function getAgentName() {
  try {
    const id = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
    if (id?.agent_name) return String(id.agent_name);
  } catch {}
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (cfg?.super_agent?.name) return String(cfg.super_agent.name);
  } catch {}
  return "Superagente";
}

// ── Mascot (blob pet) config ────────────────────────────────────────────────
// Which blob the pet wears: the shared super-agent avatar, then the legacy
// desktop-only override, then the default. The web picker writes the shared key.
function getMascotBlob() {
  const cfg = readApxConfig();
  const key = cfg?.super_agent?.icon || cfg?.desktop?.blob;
  return (typeof key === "string" && key.trim()) ? key.trim() : "noche";
}

// The pet is on by default — the user asked for it. Disable with
//   "desktop": { "mascot": false }
function getMascotEnabled() {
  const cfg = readApxConfig();
  return cfg?.desktop?.mascot !== false;
}

// Message sounds are on by default. The checkbox in the native context menus
// persists this setting independently from the mascot visibility toggle.
function getMascotSoundEnabled() {
  const cfg = readApxConfig();
  return cfg?.desktop?.mascot_sound !== false;
}

// Saved pet position ({x,y} in screen coords), or null for the default corner.
function getMascotPos() {
  const cfg = readApxConfig();
  const p = cfg?.desktop?.mascot_pos;
  if (p && typeof p.x === "number" && typeof p.y === "number") return p;
  return null;
}

// Persist a partial patch into config.json's `desktop` block, preserving every
// other field. Best-effort — a write failure just means the pet forgets where
// it was left, which is harmless.
function patchDesktopConfig(patch) {
  try {
    const cfg = readApxConfig();
    cfg.desktop = { ...(cfg.desktop || {}), ...patch };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn("desktop: could not persist mascot config —", e.message);
  }
}

function toggleMascotSound() {
  patchDesktopConfig({ mascot_sound: !getMascotSoundEnabled() });
}

function getWindowOrigin(_height) {
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
let mascotWindow = null; // the draggable blob pet (separate always-on-top window)
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
  try { if (getMascotEnabled()) { createMascotWindow(); console.log("desktop: mascot created"); } }
  catch (e) { console.error("desktop: createMascotWindow failed:", e.message); }
  try { registerShortcut(); }
  catch (e) { console.error("desktop: registerShortcut failed:", e.message); }
  connectDaemon();
  connectEventsFeed();
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
  tray.setToolTip("APX Desktop — click para abrir, click derecho para el menú");

  // Built fresh on each right-click so the "Blob mascota" checkbox reflects the
  // pet's live on/off state.
  const buildMenu = () => Menu.buildFromTemplate([
    { label: "Mostrar / ocultar",  click: toggleWindow },
    { label: "Grabar",             click: () => { showOverlay(); startRecording(); } },
    { type: "separator" },
    {
      label: "Blob mascota",
      type: "checkbox",
      checked: !!mascotWindow,
      click: toggleMascot,
    },
    {
      label: "Sonido de mensajes",
      type: "checkbox",
      checked: getMascotSoundEnabled(),
      click: toggleMascotSound,
    },
    { type: "separator" },
    { label: "Salir de APX Desktop", click: () => app.exit(0) },
  ]);

  // IMPORTANT on macOS: do NOT call tray.setContextMenu(contextMenu).
  // When a context menu is attached, ANY click (left or right) opens it
  // AND fires the `click` event, so toggleWindow + the menu both trigger
  // at once. Wire each button explicitly instead:
  //   left-click  → toggle the floating window
  //   right-click → pop up the context menu
  tray.on("click",       () => toggleWindow());
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
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
    maxHeight: getMaxWindowHeight(),
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

// Soft-restart the floating window: re-read ~/.apx/config.json, move the window
// to the (possibly new) configured position, and reload the renderer so it
// re-applies theme/position/shortcut. Triggered by the web admin's Restart
// button via a "reload" WS event — far cheaper than killing + relaunching the
// Electron process (which would drop the tray + global shortcut). Recreates the
// window if it was closed.
function reloadDesktopWindow() {
  try {
    if (!mainWindow) { createWindow(); showOverlay(); return; }
    const [, currentH] = mainWindow.getSize();
    const origin = getWindowOrigin(currentH);
    mainWindow.setPosition(origin.x, origin.y);
    mainWindow.webContents.reload();
    showOverlay();
  } catch (e) {
    console.warn("desktop: reload failed —", e.message);
  }
}

// ---------------------------------------------------------------------------
// Mascot (blob pet) window
// ---------------------------------------------------------------------------
//
// A second, tiny, transparent, always-on-top window that hosts just the blob
// avatar. It is draggable anywhere on screen, click-through over its
// transparent pixels (only the blob + bubble opt back into the mouse), and
// floats notification bubbles relayed from the daemon. Clicking it toggles the
// voice HUD. Kept fully separate from the voice window so neither disturbs the
// other.

const MASCOT_W = 240;
const MASCOT_H = 210;
const MASCOT_MARGIN = 16;

function getMascotOrigin() {
  const saved = getMascotPos();
  const { workArea } = screen.getPrimaryDisplay();
  if (saved) {
    // Clamp a stale saved position back onto the visible work area.
    const x = Math.min(Math.max(saved.x, workArea.x), workArea.x + workArea.width - MASCOT_W);
    const y = Math.min(Math.max(saved.y, workArea.y), workArea.y + workArea.height - MASCOT_H);
    return { x: Math.round(x), y: Math.round(y) };
  }
  // Default: bottom-right corner, above the dock/taskbar.
  return {
    x: workArea.x + workArea.width - MASCOT_W - MASCOT_MARGIN,
    y: workArea.y + workArea.height - MASCOT_H - MASCOT_MARGIN,
  };
}

function createMascotWindow() {
  if (mascotWindow) return;
  const origin = getMascotOrigin();
  mascotWindow = new BrowserWindow({
    width: MASCOT_W,
    height: MASCOT_H,
    x: origin.x,
    y: origin.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,     // a pet never steals keyboard focus
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "mascot-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // Follow the user across spaces / full-screen apps, and float above them.
  try {
    mascotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mascotWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {}

  // Start click-through; the renderer re-enables the mouse only over the blob.
  mascotWindow.setIgnoreMouseEvents(true, { forward: true });

  mascotWindow.loadFile(path.join(__dirname, "mascot.html"));
  mascotWindow.once("ready-to-show", () => mascotWindow.showInactive());
  mascotWindow.on("closed", () => { mascotWindow = null; });
}

function destroyMascotWindow() {
  if (!mascotWindow) return;
  try { mascotWindow.close(); } catch {}
  mascotWindow = null;
}

function toggleMascot() {
  if (mascotWindow) {
    destroyMascotWindow();
    patchDesktopConfig({ mascot: false });
  } else {
    patchDesktopConfig({ mascot: true });
    createMascotWindow();
  }
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

// Renderer requests close/hide
ipcMain.handle("close-desktop", async () => { hideOverlay(); });

// Renderer queries the configured shortcut for display
ipcMain.handle("get-shortcut", () => getShortcut());
ipcMain.handle("get-theme",    () => getTheme());
ipcMain.handle("get-position", () => getPosition());
ipcMain.handle("get-agent-name", () => getAgentName());
ipcMain.handle("get-voice-timing", () => getVoiceTiming());

// ── Mascot (blob pet) IPC ───────────────────────────────────────────────────
ipcMain.handle("mascot-get-config", () => ({
  blob: getMascotBlob(),
  name: getAgentName(),
  theme: getTheme(),
  sound: getMascotSoundEnabled(),
}));

ipcMain.handle("mascot-get-bounds", () => {
  if (!mascotWindow) return { x: 0, y: 0, width: MASCOT_W, height: MASCOT_H };
  return mascotWindow.getBounds();
});

ipcMain.on("mascot-set-pos", (_e, { x, y }) => {
  if (!mascotWindow) return;
  if (typeof x !== "number" || typeof y !== "number") return;
  mascotWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on("mascot-save-pos", () => {
  if (!mascotWindow) return;
  const [x, y] = mascotWindow.getPosition();
  patchDesktopConfig({ mascot_pos: { x, y } });
});

// A clean click on the blob toggles the voice HUD.
ipcMain.handle("mascot-poke", () => { toggleWindow(); });

// Right-click on the blob → a native context menu at the cursor. Mirrors the
// tray menu, plus a shortcut to open the full chat in the browser.
ipcMain.handle("mascot-menu", () => {
  const menu = Menu.buildFromTemplate([
    { label: "Abrir chat en el navegador", click: openWebChat },
    { type: "separator" },
    { label: "Mostrar / ocultar voz", click: toggleWindow },
    { label: "Grabar", click: () => { showOverlay(); startRecording(); } },
    { label: "Probar notificación", click: testMascotNotify },
    { type: "separator" },
    { label: "Blob mascota", type: "checkbox", checked: !!mascotWindow, click: toggleMascot },
    { label: "Sonido de mensajes", type: "checkbox", checked: getMascotSoundEnabled(), click: toggleMascotSound },
    { type: "separator" },
    { label: "Salir", click: () => app.exit(0) },
  ]);
  menu.popup({ window: mascotWindow || undefined });
});

// Fire a sample bubble on the pet — lets you preview notifications without
// sending a real message through a channel.
function testMascotNotify() {
  if (!mascotWindow) return;
  mascotWindow.webContents.send("mascot-notify", {
    text: "Nuevo mensaje en Telegram",
    sound: getMascotSoundEnabled(),
  });
}

// Open the APX web chat in the user's default browser. The daemon serves the
// web UI at its own host:port.
function openWebChat() {
  const url = `http://${DAEMON_HOST}:${DAEMON_PORT}/`;
  shell.openExternal(url).catch((e) => console.warn("desktop: openWebChat failed —", e.message));
}

// Click-through toggling — ignore the mouse over transparent pixels, capture it
// over the blob/bubble. `forward:true` keeps move events flowing so the
// renderer can tell when the pointer re-enters an interactive region.
ipcMain.on("mascot-set-ignore", (_e, { ignore }) => {
  if (!mascotWindow) return;
  mascotWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// Renderer asks main to grow/shrink the window to fit its content.
// Clamped to [WIN_H_MIN, getMaxWindowHeight()]; same anchor (top edge stays put).
ipcMain.on("resize-window", (_e, { height }) => {
  if (!mainWindow) return;
  const h = Math.max(WIN_H_MIN, Math.min(getMaxWindowHeight(), Math.ceil(height) || WIN_H_MIN));
  const [w, currentH] = mainWindow.getSize();
  if (h === currentH) return;
  mainWindow.setSize(w, h, /* animate */ false);
});

// Renderer asks for TTS playback of the agent reply. We synthesize via the
// daemon and pipe the audio path back as a daemon-event the renderer already
// knows how to consume (tts-ready { url, duration } / tts-failed).
// Speech is generated a sentence at a time so the first one can start playing
// while the rest is still being made. The engine runs at roughly 0.85x real
// time, which means every sentence finishes generating before the one ahead of
// it finishes playing — so the reply comes out continuous, but Roby starts
// talking after the first sentence instead of after the whole answer. Measured
// on a two-sentence reply: first audio at 2.0s instead of 4.8s, and the gap
// grows with the length of the answer.
//
// The limit mirrors the engine's own chunking. Past ~80 characters the model
// stops finding its end token and the audio degrades, so there is nothing to
// gain by sending it more in one go.
function splitForSpeech(text, { min = 12, limit = 80 } = {}) {
  const out = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  const add = (piece) => {
    if (!piece) return;
    if (cur && cur.length + 1 + piece.length > limit) flush();
    cur = cur ? `${cur} ${piece}` : piece;
    // Cut as soon as there is enough to say. Packing sentences up to the limit
    // would undo the point of this: two sentences that fit in one chunk get
    // generated together, and the listener waits for both before hearing
    // either. `min` only exists so a two-word sentence doesn't become a
    // generation of its own, and it is deliberately small: a short greeting
    // degrades the whole chunk it is folded into. "¡Hola Manu!" alone is
    // bounded to about a second of possible damage, but merged ahead of a full
    // sentence it took the pair from 13 chars/s down to 8.
    if (cur.length >= min) flush();
  };
  for (const sentence of String(text).trim().split(/(?<=[.!?…])\s+/)) {
    if (sentence.length <= limit) { add(sentence); continue; }
    // A sentence too long on its own: break it at clauses, then words.
    for (const clause of sentence.split(/(?<=[,;:—–])\s+/)) {
      if (clause.length <= limit) { add(clause); continue; }
      for (const word of clause.split(" ")) add(word);
    }
  }
  flush();
  return out.length ? out : [String(text)];
}

// Speech generated ahead of the request for it, keyed by the exact chunk text.
// The renderer kicks this the moment the first sentence has streamed in, so the
// voice engine works during the model's remaining tokens instead of after them
// — the single longest stretch of dead time in a voice turn. A key that never
// gets claimed just means one small wasted synthesis, never wrong audio: only
// an exact text match is ever served from here.
const ttsAhead = new Map();   // chunk text -> Promise<{ok, audio_path, ...}>

ipcMain.handle("prewarm-tts", async (_e, { text }) => {
  const first = splitForSpeech(text || "")[0];
  // splitForSpeech packs sentences shorter than its `min` together with the
  // next one, so a short opener would be pre-made as the wrong chunk. The
  // renderer already filters those out; this is the backstop.
  if (!first || first !== (text || "").trim() || ttsAhead.has(first)) return;
  if (ttsAhead.size > 4) ttsAhead.clear();   // a turn never needs more than one
  const t0 = Date.now();
  ttsAhead.set(first, daemonTtsSay(first)
    .then((r) => {
      console.log(`desktop: speech-ahead ready in ${Date.now() - t0}ms — "${first.slice(0, 48)}"`);
      return r;
    })
    .catch(() => ({ ok: false })));
});

ipcMain.handle("request-tts", async (_e, { text, seg }) => {
  const send = (msg) => mainWindow?.webContents.send("daemon-event", msg);
  if (!text || !text.trim()) {
    send({ type: "tts-failed", seg });
    return;
  }
  const chunks = splitForSpeech(text);
  let delivered = 0;
  try {
    for (const chunk of chunks) {
      const ahead = ttsAhead.get(chunk);
      if (ahead) ttsAhead.delete(chunk);
      if (delivered === 0) {
        console.log(`desktop: first chunk ${ahead ? "claimed from speech-ahead" : "synthesized on demand"}`);
      }
      const result = ahead ? await ahead : await daemonTtsSay(chunk);
      if (result?.ok && result.audio_path) {
        // Expose the local file via file:// — preload's contextIsolation lets
        // the renderer's <audio> tag fetch it directly. `seg` ties this audio
        // to the bubble that asked for it.
        send({
          type: "tts-part",
          seg,
          url: "file://" + result.audio_path,
          duration: result.duration_s || 0,
        });
        delivered++;
      } else if (!delivered) {
        // Nothing has played yet and the engine is refusing: stop asking. A
        // whole reply of failures would otherwise cost one full timeout each.
        send({ type: "tts-failed", seg, error: result?.error || "no audio" });
        return;
      }
      // A later chunk failing is survivable — the bubble keeps what it has.
    }
    // Anything still sitting here was pre-made for a sentence this reply never
    // asked for (the model revised it, or a tag/emoji changed the chunk).
    ttsAhead.clear();
    // Tells the renderer no more audio is coming, so a player waiting on the
    // next sentence knows it has reached the end instead of stalling.
    send({ type: "tts-end", seg, parts: delivered });
    if (!delivered) send({ type: "tts-failed", seg, error: "no audio" });
  } catch (e) {
    if (delivered) send({ type: "tts-end", seg, parts: delivered });
    else send({ type: "tts-failed", seg, error: e.message });
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

// Renderer asks to keep STT warm. Routed through the daemon (not whisper
// directly) so it both LOADS the model if it idled out and resets the idle
// watchdog. Fire-and-forget from the renderer's side.
ipcMain.handle("warmup-stt", async () => {
  return new Promise((resolve) => {
    const token = readToken();
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/api/transcribe/warmup",
      method: "GET",
      headers: { ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    // Cold model load can take ~30s; give it room. (Renderer fires this
    // fire-and-forget, so a long warm-up never blocks the UI.)
    req.setTimeout(45000, () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
});

// Same idea as warmup-stt, for the other half of the round trip. Fired when
// the mic opens: the user then spends a few seconds speaking, and the voice
// engine spends them getting its weights back into RAM instead of making the
// reply wait afterwards.
ipcMain.handle("warmup-tts", async () => {
  return new Promise((resolve) => {
    const token = readToken();
    const req = http.request({
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/api/tts/warmup",
      method: "GET",
      headers: { ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.setTimeout(120000, () => { req.destroy(); resolve({ ok: false }); });
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
      path: "/api/transcribe/chunk",
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": buf.length,
        "X-Audio-Format": format,
        "X-Language": language,
        // No X-Provider override: the desktop honours the configured STT engine
        // (transcription.provider in ~/.apx/config.json) — local faster-whisper,
        // OpenAI cloud, or a custom OpenAI-compatible server (mlx-audio / a
        // Radeon/NVIDIA box on the LAN). Set it in the web admin → /m/voice.
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

  const url = `ws://${DAEMON_HOST}:${DAEMON_PORT}/api/desktop/ws`;

  function connect() {
    // Re-read the token on EVERY attempt — the daemon regenerates
    // ~/.apx/daemon.token on each restart, so a token captured once at
    // startup goes stale the moment the daemon is restarted (e.g. after a
    // pull / `apx daemon restart`) and every reconnect 401s forever. Reading
    // it fresh here lets the desktop self-heal: the next retry picks up the
    // new token and reconnects on its own.
    const token = readToken();
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
        // "reload" is a control event from the web admin's Restart button (POST
        // /desktop/restart). Re-read config, reposition, and soft-reload the
        // renderer so theme/position changes apply without killing the process.
        if (msg && msg.type === "reload") { reloadDesktopWindow(); return; }
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

// ---------------------------------------------------------------------------
// Cross-channel event feed → mascot notifications
// ---------------------------------------------------------------------------
//
// A SECOND socket, to /api/events/ws (distinct from the desktop conversation
// socket above). It carries a signal-only "the channel X moved" feed. The
// daemon already decided which bursts are news (`notifications: string[]`):
// an agent's launched final on Telegram / group / A2A, plus delivery
// headlines. The owner's own send is NOT news — it used to bubble here
// because the filter watched `direction: "in"`. Only meaningful while the
// pet is on.

function connectEventsFeed() {
  let WS;
  try { WS = require("ws"); } catch { return; } // already warned in connectDaemon

  const url = `ws://${DAEMON_HOST}:${DAEMON_PORT}/api/events/ws`;
  let conn = null;
  let reconnectDelay = 1000;

  function scheduleReconnect() {
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    setTimeout(connect, delay);
  }

  function pushBubble(text) {
    if (!text || !mascotWindow) return;
    mascotWindow.webContents.send("mascot-notify", { text, sound: getMascotSoundEnabled() });
  }

  function handleFrame(msg) {
    const avatar = msg?.settings?.super_agent?.icon;
    if ((msg?.type === "hello" || msg?.type === "settings") && typeof avatar === "string") {
      mascotWindow?.webContents.send("mascot-avatar", avatar);
    }
    if (!msg || msg.type !== "messages") return;
    if (!mascotWindow) return; // pet off → nothing to notify

    // The daemon computes the copy. An empty array means "this burst is not
    // news" (the owner sending) and must not fall through to a local guess.
    if (Array.isArray(msg.notifications)) {
      for (const text of msg.notifications) pushBubble(text);
      return;
    }

    // Older daemon without the field: still skip the owner's send, only
    // bubble an agent's launched final on Telegram / group / A2A plus the
    // delivery headlines the previous local filter already knew about.
    const events = Array.isArray(msg.events) ? msg.events : [];
    for (const ev of events) {
      if (ev?.via === "mobility_delivery" && ev.notify) pushBubble(ev.notify);
    }
    const byAgent = new Map();
    for (const ev of events) {
      if (!ev || ev.via !== "routine_delivery" || ev.channel !== "web") continue;
      if (!ev.agent_slug || ev.agent_slug === "super_agent") continue;
      byAgent.set(ev.agent_slug, ev.notify || byAgent.get(ev.agent_slug) || "");
    }
    for (const [agent, notify] of byAgent) {
      pushBubble(notify ? `${agent}: ${notify}` : `${agent} te dejó un mensaje`);
    }
    const finals = new Map();
    for (const ev of events) {
      if (!ev || ev.direction !== "out") continue;
      if (ev.type && ev.type !== "agent") continue;
      if (ev.channel !== "telegram" && ev.channel !== "group" && ev.channel !== "a2a") continue;
      if (ev.streamed === true) continue;
      if (ev.via === "routine_delivery" || ev.via === "mobility_delivery") continue;
      const agent = (ev.author && ev.author !== "user" && ev.author !== "owner")
        ? ev.author
        : (ev.agent_slug || "agente");
      const label = ev.channel === "telegram" ? "Telegram" : ev.channel === "group" ? "Grupo" : "A2A";
      finals.set(`${ev.channel}|${agent}`, `${agent} respondió en ${label}`);
    }
    for (const text of finals.values()) pushBubble(text);
  }

  function connect() {
    const token = readToken();
    try {
      conn = new WS(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      conn.on("open", () => { reconnectDelay = 1000; console.log("desktop: events feed connected"); });
      conn.on("message", (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        handleFrame(msg);
      });
      conn.on("close", () => { conn = null; scheduleReconnect(); });
      conn.on("error", (e) => { console.warn("desktop events-feed ws error:", e.message); });
    } catch (e) {
      console.warn("desktop: events feed connect failed —", e.message);
      scheduleReconnect();
    }
  }

  connect();
}

async function sendMessageToDaemon(text, previousMessages) {
  const token = readToken();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, previousMessages });
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/api/desktop/message",
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
// POST /tts/say once with the daemon's configured provider (chain). If that
// errors out (e.g. the user's gemini key isn't TTS-enabled and the daemon's
// chain-fallback bug returns the first error instead of trying the next
// engine), retry once with `provider: "mock"` so the renderer at least gets
// a duration + scrubber instead of hanging. The user can plug a real TTS
// engine in via the Voices web admin to get audible speech.
// The daemon's chain already tries every configured engine, so there is nothing
// left to retry here. It used to fall back to the `mock` engine, which returns
// a silent WAV of about the right length: the bubble grew a working-looking
// player, the progress bar ran to the end, and no sound ever came out. A turn
// with no voice should say so, not mime one — so a mock result is reported as
// a failure and the bubble simply stays text.
function daemonTtsSay(text) {
  return _ttsRequest(text, /* explicitProvider */ null).then((r) => {
    if (r.ok && r.provider === "mock") {
      return { ok: false, error: "no TTS engine answered (silent placeholder)" };
    }
    return r;
  });
}

function _ttsRequest(text, explicitProvider) {
  const token = readToken();
  return new Promise((resolve) => {
    const payload = { text };
    if (explicitProvider) payload.provider = explicitProvider;
    const body = JSON.stringify(payload);
    const options = {
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: "/api/tts/say",
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
    // Generous on purpose. A sentence normally comes back in a second or two,
    // but the first one after the engine starts pays for loading a
    // multi-gigabyte model, and 30s was cutting that off — the reply lost its
    // voice for the one reason the user can do nothing about. Waiting is worse
    // than instant; silence is worse than waiting.
    req.setTimeout(120_000, () => { req.destroy(); resolve({ ok: false, error: "tts timeout" }); });
    req.write(body);
    req.end();
  });
}
