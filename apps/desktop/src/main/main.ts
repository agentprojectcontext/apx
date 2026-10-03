// The window is the APX panel (web). The panel reserves a slot for the browser and reports its bounds;
// the active tab's native view is positioned over that slot. Tab views are siblings of the panel, so a
// panel reload never kills tabs.
import path from "node:path";
import { app, BaseWindow, ipcMain, Notification, WebContentsView } from "electron";
import { BrowserHost, blockAppOrigins } from "./browser/host.ts";
import { startNodeLink } from "./node-link.ts";
import { createQuick, type DesktopPrefs } from "./quick.ts";

const CORE_URL = process.env.APX_URL ?? "http://127.0.0.1:7440";
const WEB_URL = process.env.APX_WEB_URL ?? "http://127.0.0.1:7441";
const DIST = import.meta.dirname;

type Bounds = { x: number; y: number; width: number; height: number };

// The app is APX (menus, notifications, About), keeping the data folder it always had (its browser sessions and
// imported cookies live there).
app.setPath("userData", path.join(app.getPath("appData"), "@apx", "desktop"));
app.setName("APX");

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
  const win = new BaseWindow({ width: 1480, height: 920, minWidth: 980, minHeight: 600, title: "APX" });
  const openMain = () => {
    if (win.isMinimized()) win.restore();
    win.show();
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
  let shown: WebContentsView | undefined;
  let slot: Bounds | null = null;

  const layout = () => {
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width, height });
    if (!shown) return;
    const visible = Boolean(slot && slot.width > 0 && slot.height > 0);
    // Hidden tabs sit behind the panel at a real size instead of setVisible(false): an invisible view stops
    // painting, and the agent still needs screenshots and layout of the page it is driving.
    win.contentView.removeChildView(shown);
    if (visible && slot) {
      win.contentView.addChildView(shown);
      shown.setBounds(slot);
    } else {
      win.contentView.addChildView(shown, 0);
      shown.setBounds({ x: 0, y: 0, width: Math.min(width, 1280), height });
    }
  };
  host.onShow = (view) => {
    if (shown && shown !== view) win.contentView.removeChildView(shown);
    shown = view;
    layout();
  };
  host.onAttention = (message) => {
    openMain();
    if (Notification.isSupported()) new Notification({ title: "APX", body: message }).show();
  };
  win.on("resize", layout);
  layout();

  ipcMain.on("panel:browser-bounds", (e, b: Bounds | null) => {
    if (e.sender !== panel.webContents) return;
    slot =
      b && Number.isFinite(b.x)
        ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
        : null;
    layout();
  });

  ipcMain.on("panel:browser-tab", (e, tab: unknown) => {
    if (e.sender !== panel.webContents || typeof tab !== "string") return;
    try {
      host.select(tab);
    } catch {
      // unknown tab: the panel's list is stale; the next tabs event corrects it
    }
  });

  // The quick chat loads from wherever the panel did (the dev server or the core).
  let base = CORE_URL;
  const quick = createQuick({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:apx-ui",
    assets: DIST,
    openMain,
  });

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
  ipcMain.on("desktop:attention", (e, unread: unknown) => {
    if (e.sender !== panel.webContents || typeof unread !== "number") return;
    quick.badge(unread);
  });
  app.on("will-quit", () => quick.stop());

  const loadPanel = async () => {
    for (const url of [WEB_URL, CORE_URL]) {
      try {
        await panel.webContents.loadURL(url);
        base = url;
        quick.start();
        return;
      } catch {}
    }
    await panel.webContents.loadURL(
      `data:text/html,<body style="font:14px system-ui;padding:24px;color:#555">APX core not reachable at ${CORE_URL}. Start it with <code>pnpm dev</code>.</body>`,
    );
  };
  void loadPanel();

  // Dev-only: `kill -USR2 <pid>` writes the panel, the visible tab and the slot so a script can compose them.
  const captureDir = process.env.APX_CAPTURE_DIR;
  if (captureDir) {
    process.on("SIGUSR2", async () => {
      const fs = await import("node:fs");
      fs.mkdirSync(captureDir, { recursive: true });
      fs.writeFileSync(path.join(captureDir, "panel.png"), (await panel.webContents.capturePage()).toPNG());
      if (shown && slot)
        fs.writeFileSync(path.join(captureDir, "tab.png"), (await shown.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(captureDir, "slot.json"), JSON.stringify({ slot, at: Date.now() }));
    });
  }

  startNodeLink(host, CORE_URL, () => {});
});

app.on("window-all-closed", () => app.quit());
