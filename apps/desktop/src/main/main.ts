// The window is the APX panel (web). The panel reserves a slot for the browser and reports its bounds;
// the active tab's native view is positioned over that slot. Tab views are siblings of the panel, so a
// panel reload never kills tabs.
import fs from "node:fs";
import path from "node:path";
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell,
  type WebContents,
  WebContentsView,
} from "electron";
import { showAbout } from "./about.ts";
import { registerAppScheme, serveAppScheme, webDist } from "./app-scheme.ts";
import { installedBrowsers, isWebUrl, openExternal } from "./browser/external.ts";
import { BrowserHost, blockAppOrigins } from "./browser/host.ts";
import { type Bounds, createPopout } from "./browser/popout.ts";
import { createConnector } from "./connector.ts";
import { itemName, memoryReport, memoryText, memoryWatch, size } from "./memory.ts";
import { startNodeLink } from "./node-link.ts";
import { createQuick, type DesktopPrefs } from "./quick.ts";
import { createDesktopUpdater } from "./updater.ts";

const CORE_URL = process.env.APX_URL ?? "http://127.0.0.1:7440";
const WEB_URL = process.env.APX_WEB_URL ?? "http://127.0.0.1:7441";
const DIST = import.meta.dirname;

/** Past this, APX tells the owner how much it takes and what takes the most. */
const MEMORY_LIMIT_MB = 4096;

// The app is APX (menus, notifications, About), keeping the data folder it always had (its browser sessions and
// imported cookies live there). APX_DESKTOP_DATA gives a copy its own (a test run): its own sessions and its own
// single-instance lock, so it never meets the owner's running APX.
app.setPath("userData", process.env.APX_DESKTOP_DATA ?? path.join(app.getPath("appData"), "@apx", "desktop"));
app.setName("APX");

registerAppScheme();

// One APX at a time: opening it again brings the running one forward.
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

app.whenReady().then(() => {
  if (!single) return;
  // Run straight from Electron (not the APX bundle `pnpm app` makes), the Dock still shows APX's face.
  app.dock?.setIcon(path.join(DIST, "icon.png"));
  // One chrome bar: native window controls sit in the topbar (hidden title bar on every OS).
  const win = new BaseWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    title: "APX",
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#1a1a19", symbolColor: "#c8c8c8", height: 46 },
        }),
  });
  const openMain = () => {
    if (win.isMinimized()) win.restore();
    // Steal focus so a double-click on the tray brings APX above other apps on every display.
    if (process.platform === "darwin") app.focus({ steal: true });
    win.show();
    win.moveTop();
    win.focus();
  };
  // Closing the window hides it — its browser tabs and the core link stay alive; the Dock, the menu-bar icon or
  // opening APX again bring it back, and Quit ends it.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  app.on("activate", openMain);
  app.on("second-instance", openMain);
  serveAppScheme("persist:apx-ui", webDist(DIST));
  const host = new BrowserHost();
  blockAppOrigins([CORE_URL, WEB_URL]);

  // The panel never shares a partition with web tabs; its preload only exposes the bounds bridge.
  const panel = new WebContentsView({
    webPreferences: {
      partition: "persist:apx-ui",
      sandbox: true,
      preload: path.join(DIST, "panel-preload.cjs"),
      // The panel must keep applying live events while the window is behind others.
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(panel);
  externalLinks(panel.webContents);
  let shown: WebContentsView | undefined;
  let slot: Bounds | null = null;
  // The quick chat loads from wherever the panel did (the dev server or the core); so does the browser window.
  let base = CORE_URL;

  const popout = createPopout({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:apx-ui",
    changed: (open) => {
      const pw = popout.panel();
      if (open && pw) externalLinks(pw);
      panel.webContents.send("browser:popout", open);
      layout();
    },
    layout: () => layout(),
  });
  const unparent = (view: WebContentsView) => {
    for (const w of [win, popout.window()])
      if (w?.contentView.children.includes(view)) w.contentView.removeChildView(view);
  };
  // The tab is on screen in the browser window while it is open, else in the main window's slot.
  const stage = () => {
    const pw = popout.window();
    return pw ? { w: pw, slot: popout.slot() } : { w: win, slot };
  };
  const onScreen = () => {
    const s = stage().slot;
    return Boolean(s && s.width > 0 && s.height > 0);
  };

  const layout = () => {
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width, height });
    if (!shown) return;
    const { w, slot: at } = stage();
    // Hidden tabs sit behind the panel at a real size instead of setVisible(false): an invisible view stops
    // painting, and the agent still needs screenshots and layout of the page it is driving.
    unparent(shown);
    if (at && onScreen()) {
      w.contentView.addChildView(shown);
      shown.setBounds(at);
    } else {
      const area = w.getContentBounds();
      w.contentView.addChildView(shown, 0);
      shown.setBounds({ x: 0, y: 0, width: Math.min(area.width, 1280), height: area.height });
    }
  };
  host.onShow = (view) => {
    if (shown && shown !== view) unparent(shown);
    shown = view;
    layout();
  };
  host.on("changed", () => {
    const active = host.active ? host.list().find((t) => t.tab === host.active) : undefined;
    popout.setTitle(active?.title || "APX");
  });
  host.onAttention = (message) => {
    openMain();
    if (Notification.isSupported()) new Notification({ title: "APX", body: message }).show();
  };
  win.on("resize", layout);
  layout();

  ipcMain.on("panel:browser-bounds", (e, b: Bounds | null) => {
    const next =
      b && Number.isFinite(b.x)
        ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
        : null;
    if (popout.isPanel(e.sender)) return popout.setSlot(next);
    if (e.sender !== panel.webContents) return;
    slot = next;
    layout();
  });

  const ownBrowserPanel = (sender: WebContents) => sender === panel.webContents || popout.isPanel(sender);
  ipcMain.on("panel:browser-tab", (e, tab: unknown) => {
    if (!ownBrowserPanel(e.sender) || typeof tab !== "string") return;
    try {
      host.select(tab);
    } catch {
      // unknown tab: the panel's list is stale; the next tabs event corrects it
    }
  });

  // The browser in its own window (with its toolbar), or a page in one of the owner's own browsers.
  ipcMain.on("browser:popout", (e, open: unknown) => {
    if (!ownBrowserPanel(e.sender)) return;
    if (open === false) return popout.close();
    const active = host.active ? host.list().find((t) => t.tab === host.active) : undefined;
    popout.open(active?.title || "APX", active?.tab);
  });
  ipcMain.on("browser:popout-state", (e) => {
    e.returnValue = ownBrowserPanel(e.sender) && popout.window() != null;
  });
  ipcMain.handle("browser:installed", (e) =>
    ownBrowserPanel(e.sender) ? installedBrowsers().map(({ id, name }) => ({ id, name })) : [],
  );
  ipcMain.handle("browser:open-external", (e, url: unknown, browser: unknown) =>
    ownBrowserPanel(e.sender) ? openExternal(url, browser ?? undefined) : false,
  );

  const quick = createQuick({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:apx-ui",
    assets: DIST,
    openMain,
  });

  let linked = false;
  const connector = createConnector({
    panel: panel.webContents,
    coreUrl: CORE_URL,
    webUrl: WEB_URL,
    dist: DIST,
    isOwnWindow: (sender) => sender === panel.webContents || popout.isPanel(sender) || quick.isQuick(sender),
    opened: (url, node) => {
      base = url;
      quick.start();
      if (linked || !node) return;
      linked = true;
      startNodeLink(host, node.url, () => {}, node.token);
    },
  });
  app.on("will-quit", () => connector.stop());

  Menu.setApplicationMenu(
    appMenu(
      () => quick.toggle(false),
      () => void connector.change(),
    ),
  );

  ipcMain.on("quick:open-main", (e, threadId: unknown) => {
    if (!quick.isQuick(e.sender)) return;
    quick.hide();
    openMain();
    if (typeof threadId === "string") panel.webContents.send("nav:thread", threadId);
  });
  ipcMain.on("desktop:prefs", (e, prefs: DesktopPrefs) => {
    if (e.sender !== panel.webContents || typeof prefs?.shortcut !== "string") return;
    const error = quick.apply({ shortcut: prefs.shortcut, launchAtLogin: prefs.launchAtLogin === true });
    if (error && Notification.isSupported()) new Notification({ title: "APX", body: error }).show();
  });
  // The owner picks a folder (a project's) with the system's own dialog; only the panel may ask.
  ipcMain.handle("panel:pick-folder", async (e) => {
    if (e.sender !== panel.webContents) return undefined;
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? undefined : r.filePaths[0];
  });
  ipcMain.on("desktop:attention", (e, unread: unknown) => {
    if (e.sender !== panel.webContents || typeof unread !== "number") return;
    quick.badge(unread);
  });
  // Windows/Linux window-control overlay follows the panel theme (mac uses native traffic lights).
  ipcMain.on("desktop:titlebar", (e, mode: unknown) => {
    if (e.sender !== panel.webContents || process.platform === "darwin") return;
    if (mode !== "light" && mode !== "dark") return;
    win.setTitleBarOverlay(
      mode === "light"
        ? { color: "#f4f3f0", symbolColor: "#444444", height: 46 }
        : { color: "#1a1a19", symbolColor: "#c8c8c8", height: 46 },
    );
  });
  app.on("will-quit", () => quick.stop());

  // A newer APX: the panel shows it and asks for it; the app downloads and puts it in place.
  const updater = createDesktopUpdater({
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  ipcMain.handle("desktop:update-status", (e, check: unknown) => {
    if (e.sender !== panel.webContents) return undefined;
    return check === true ? updater.check() : updater.status();
  });
  ipcMain.handle("desktop:update-install", (e) => (e.sender === panel.webContents ? updater.install() : undefined));
  updater.start();
  app.on("will-quit", () => updater.stop());

  void connector.open();

  // Dev-only: `kill -USR2 <pid>` writes the panel, the visible tab and the slot so a script can compose them.
  const captureDir = process.env.APX_CAPTURE_DIR;
  if (captureDir) {
    process.on("SIGUSR2", async () => {
      const fs = await import("node:fs");
      fs.mkdirSync(captureDir, { recursive: true });
      fs.writeFileSync(path.join(captureDir, "panel.png"), (await panel.webContents.capturePage()).toPNG());
      if (shown && onScreen())
        fs.writeFileSync(path.join(captureDir, "tab.png"), (await shown.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(captureDir, "slot.json"), JSON.stringify({ slot, at: Date.now() }));
    });
  }

  // Every minute: tabs nobody uses close, and APX says when it takes too much memory (and what takes it).
  const report = () => {
    const owners = host.processOwners();
    owners.set(panel.webContents.getOSProcessId(), { kind: "panel" });
    const quickPid = quick.processId();
    if (quickPid) owners.set(quickPid, { kind: "quick" });
    const popoutPid = popout.processId();
    if (popoutPid) owners.set(popoutPid, { kind: "panel" });
    return memoryReport(app.getAppMetrics(), owners);
  };
  const memText = memoryText(app.getLocale());
  const memoryLog = path.join(app.getPath("logs"), "memory.log");
  const watch = memoryWatch({
    read: report,
    limitMb: MEMORY_LIMIT_MB,
    quietMs: 3_600_000,
    text: memText,
    warn: (message, r) => {
      const lines = r.items.map((i) => `  ${size(i.mb).padStart(8)}  ${itemName(i, memText)}`).join("\n");
      void fs.promises
        .mkdir(path.dirname(memoryLog), { recursive: true })
        .then(() => fs.promises.appendFile(memoryLog, `${new Date().toISOString()} ${message}\n${lines}\n`))
        .catch(() => {});
      if (Notification.isSupported()) new Notification({ title: "APX", body: message }).show();
    },
  });
  const tick = setInterval(() => {
    void host.closeIdle((view) => view === shown && onScreen());
    watch.check();
  }, 60_000);
  tick.unref();
  ipcMain.handle("desktop:memory", (e) => (e.sender === panel.webContents ? report() : undefined));
});

app.on("window-all-closed", () => app.quit());

/** APX's own pages never open child windows (they would carry the panel's preload): web links go to the system. */
function externalLinks(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

/** The system's own menus, plus "Quick chat" in Window: reachable from the keyboard and by name. */
function appMenu(openQuick: () => void, changeConnection: () => void): Menu {
  const es = app.getLocale().startsWith("es");
  const about = { id: "about", label: es ? "Acerca de APX" : "About APX", click: () => showAbout("persist:apx-ui") };
  const change = {
    id: "change-connection",
    label: es ? "Cambiar conexión…" : "Change connection…",
    click: changeConnection,
  };
  return Menu.buildFromTemplate([
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              about,
              { type: "separator" as const },
              change,
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : [{ label: "APX", submenu: [about, change, { type: "separator" as const }, { role: "quit" as const }] }]),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: es ? "Ventana" : "Window",
      role: "windowMenu",
      submenu: [
        { id: "quick", label: es ? "Chat rápido" : "Quick chat", click: openQuick },
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ]);
}
