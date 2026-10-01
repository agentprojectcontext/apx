// The window is the APX panel (web). The panel reserves a slot for the browser and reports its bounds;
// the active tab's native view is positioned over that slot. Tab views are siblings of the panel, so a
// panel reload never kills tabs.
import path from "node:path";
import { app, BaseWindow, ipcMain, Notification, WebContentsView } from "electron";
import { BrowserHost } from "./browser/host.ts";
import { startNodeLink } from "./node-link.ts";

const CORE_URL = process.env.APX_URL ?? "http://127.0.0.1:7440";
const WEB_URL = process.env.APX_WEB_URL ?? "http://127.0.0.1:7441";
const DIST = import.meta.dirname;

type Bounds = { x: number; y: number; width: number; height: number };

app.whenReady().then(() => {
  const win = new BaseWindow({ width: 1480, height: 920, minWidth: 980, minHeight: 600, title: "APX" });
  const host = new BrowserHost();

  // The panel never shares a partition with web tabs; its preload only exposes the bounds bridge.
  const panel = new WebContentsView({
    webPreferences: { partition: "persist:apx-ui", sandbox: true, preload: path.join(DIST, "panel-preload.cjs") },
  });
  win.contentView.addChildView(panel);
  let shown: WebContentsView | undefined;
  let slot: Bounds | null = null;

  const layout = () => {
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width, height });
    if (!shown) return;
    if (slot && slot.width > 0 && slot.height > 0) {
      shown.setVisible(true);
      shown.setBounds(slot);
    } else {
      shown.setVisible(false);
    }
  };
  host.onShow = (view) => {
    if (shown && shown !== view) win.contentView.removeChildView(shown);
    shown = view;
    if (view) win.contentView.addChildView(view); // added last → drawn above the panel
    layout();
  };
  host.onAttention = (message) => {
    win.show();
    win.focus();
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

  const loadPanel = async () => {
    for (const url of [WEB_URL, CORE_URL]) {
      try {
        await panel.webContents.loadURL(url);
        return;
      } catch {}
    }
    await panel.webContents.loadURL(
      `data:text/html,<body style="font:14px system-ui;padding:24px;color:#555">APX core not reachable at ${CORE_URL}. Start it with <code>pnpm dev</code>.</body>`,
    );
  };
  void loadPanel();

  startNodeLink(host, CORE_URL, () => {});
});

app.on("window-all-closed", () => app.quit());
