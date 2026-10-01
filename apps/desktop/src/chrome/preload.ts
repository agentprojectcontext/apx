// Sandboxed preload for the browser chrome only. Never loaded into web tabs.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("apxChrome", {
  onState: (cb: (state: unknown) => void) => ipcRenderer.on("state", (_e, s) => cb(s)),
  newTab: (url: string) => ipcRenderer.invoke("chrome:new", url),
  select: (id: string) => ipcRenderer.invoke("chrome:select", id),
  close: (id: string) => ipcRenderer.invoke("chrome:close", id),
  navigate: (id: string, url: string) => ipcRenderer.invoke("chrome:navigate", id, url),
  take: (id: string) => ipcRenderer.invoke("chrome:take", id),
  give: (id: string) => ipcRenderer.invoke("chrome:give", id),
});
