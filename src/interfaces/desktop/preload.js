// Preload — context bridge between Electron main and renderer.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("apx", {
  // Recording control
  onRecordingStart: (fn) => ipcRenderer.on("recording-start", fn),
  onRecordingStop:  (fn) => ipcRenderer.on("recording-stop",  fn),
  onFocusInput:     (fn) => ipcRenderer.on("focus-input",     fn),
  toggleRecording:  () => ipcRenderer.invoke("toggle-recording"),
  cancel:           () => ipcRenderer.invoke("cancel"),
  close:            () => ipcRenderer.invoke("close-desktop"),

  // Transcription
  transcribeChunk: (buffer, format, language) =>
    ipcRenderer.invoke("transcribe-chunk", { buffer, format, language }),

  // Check if the whisper model is loaded (false = still loading)
  checkWhisperReady: () => ipcRenderer.invoke("check-whisper-ready"),

  // Keep STT warm (loads the model if idle + resets the idle timer). Called
  // while the window is open / on mic-open so the first decode isn't cold.
  warmupStt: () => ipcRenderer.invoke("warmup-stt").catch(() => ({ ok: false })),

  // Send final text to daemon
  sendMessage: (text, previousMessages) =>
    ipcRenderer.invoke("send-message", { text, previousMessages }),

  // Ask main to synthesize TTS for one segment. `seg` correlates the resulting
  // tts-ready/tts-failed event back to the bubble that requested it (each
  // assistant message has its own audio). Returns true optimistically.
  requestTts: (text, seg) => {
    ipcRenderer.invoke("request-tts", { text, seg }).catch(() => {});
    return true; // optimistic; renderer waits for the event either way
  },

  // Daemon events (tokens, tools, done, error, tts-ready/failed)
  onDaemonEvent:        (fn) => ipcRenderer.on("daemon-event", (_e, msg) => fn(msg)),
  onDaemonConnected:    (fn) => ipcRenderer.on("daemon-connected",    fn),
  onDaemonDisconnected: (fn) => ipcRenderer.on("daemon-disconnected", fn),

  // Platform info
  platform: process.platform,

  // Config probes for first paint (theme, position, shortcut)
  getShortcut:  () => ipcRenderer.invoke("get-shortcut"),
  getTheme:     () => ipcRenderer.invoke("get-theme"),
  getPosition:  () => ipcRenderer.invoke("get-position"),
  getAgentName: () => ipcRenderer.invoke("get-agent-name"),
  getVoiceTiming: () => ipcRenderer.invoke("get-voice-timing"),

  // Renderer asks main to resize the BrowserWindow to the rendered height
  resize: (height) => ipcRenderer.send("resize-window", { height }),
});
