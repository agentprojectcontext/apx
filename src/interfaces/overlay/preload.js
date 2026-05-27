// Preload — context bridge between Electron main and renderer.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("apx", {
  // Recording control
  onRecordingStart: (fn) => ipcRenderer.on("recording-start", fn),
  onRecordingStop: (fn) => ipcRenderer.on("recording-stop", fn),
  toggleRecording: () => ipcRenderer.invoke("toggle-recording"),
  cancel: () => ipcRenderer.invoke("cancel"),
  close: () => ipcRenderer.invoke("close-overlay"),

  // Transcription
  transcribeChunk: (buffer, format, language) =>
    ipcRenderer.invoke("transcribe-chunk", { buffer, format, language }),

  // Check if the whisper model is loaded (false = still loading)
  checkWhisperReady: () => ipcRenderer.invoke("check-whisper-ready"),

  // Send final text to daemon
  sendMessage: (text, previousMessages) =>
    ipcRenderer.invoke("send-message", { text, previousMessages }),

  // Daemon events (tokens, tools, done, error)
  onDaemonEvent: (fn) => ipcRenderer.on("daemon-event", (_e, msg) => fn(msg)),
  onDaemonConnected: (fn) => ipcRenderer.on("daemon-connected", fn),
  onDaemonDisconnected: (fn) => ipcRenderer.on("daemon-disconnected", fn),

  // Platform info
  platform: process.platform,

  // Query configured shortcut for display in hint bar
  getShortcut: () => ipcRenderer.invoke("get-shortcut"),
});
