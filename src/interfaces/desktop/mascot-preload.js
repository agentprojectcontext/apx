// Preload for the mascot (blob) window — a tiny, separate surface from the
// main voice HUD. Exposes only what the pet needs: its blob preset + name,
// window-drag helpers, click-through toggling, and a stream of notifications.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mascot", {
  // First paint — which blob to wear, the agent's name, the resolved theme.
  getConfig: () => ipcRenderer.invoke("mascot-get-config"),

  // Free-drag support: renderer computes a grab offset from the live bounds,
  // then streams absolute screen positions while the pointer moves.
  getBounds: () => ipcRenderer.invoke("mascot-get-bounds"),
  setPos: (x, y) => ipcRenderer.send("mascot-set-pos", { x, y }),
  savePos: () => ipcRenderer.send("mascot-save-pos"),

  // Click on the blob (no drag) toggles the voice HUD.
  poke: () => ipcRenderer.invoke("mascot-poke"),

  // Right-click on the blob opens a native context menu (built in main).
  menu: () => ipcRenderer.invoke("mascot-menu"),

  // Click-through: ignore the mouse over transparent pixels, re-enable it over
  // the blob/bubble so they stay draggable and clickable.
  setIgnore: (ignore) => ipcRenderer.send("mascot-set-ignore", { ignore }),

  // Notifications relayed from the cross-channel event feed in main.
  onNotify: (fn) => ipcRenderer.on("mascot-notify", (_e, msg) => fn(msg)),

  // Avatar updates use the same authenticated event feed as notifications.
  onAvatar: (fn) => ipcRenderer.on("mascot-avatar", (_e, key) => fn(key)),
});
