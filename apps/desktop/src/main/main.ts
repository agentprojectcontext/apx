// Window = APX panel (left) + browser chrome and the active tab (right). The tab views are siblings, never
// children of the panel, so a panel reload does not kill tabs.
import path from "node:path";
import { app, BaseWindow, ipcMain, WebContentsView } from "electron";
import { BrowserHost } from "./browser/host.ts";
import { startNodeLink } from "./node-link.ts";

const CORE_URL = process.env.APX_URL ?? "http://127.0.0.1:7440";
const WEB_URL = process.env.APX_WEB_URL ?? "http://127.0.0.1:7441";
const CHROME_H = 84;
const DIST = import.meta.dirname;

app.whenReady().then(() => {
  const win = new BaseWindow({ width: 1480, height: 920, minWidth: 980, minHeight: 600, title: "APX" });
  const host = new BrowserHost();
  let core: "connected" | "offline" = "offline";

  // The panel and the browser chrome never share a partition with web tabs.
  const panel = new WebContentsView({ webPreferences: { partition: "persist:apx-ui", sandbox: true } });
  const chrome = new WebContentsView({
    webPreferences: { partition: "apx-chrome", sandbox: true, preload: path.join(DIST, "chrome-preload.cjs") },
  });
  win.contentView.addChildView(panel);
  win.contentView.addChildView(chrome);
  let shown: WebContentsView | undefined;

  const layout = () => {
    const { width, height } = win.getContentBounds();
    const left = Math.max(380, Math.round(width * 0.4));
    panel.setBounds({ x: 0, y: 0, width: left, height });
    chrome.setBounds({ x: left, y: 0, width: width - left, height: CHROME_H });
    shown?.setBounds({ x: left, y: CHROME_H, width: width - left, height: height - CHROME_H });
  };
  host.onShow = (view) => {
    if (shown && shown !== view) win.contentView.removeChildView(shown);
    shown = view;
    if (view) win.contentView.addChildView(view);
    layout();
  };
  win.on("resize", layout);
  layout();

  void panel.webContents
    .loadURL(WEB_URL)
    .catch(() =>
      panel.webContents.loadURL(
        `data:text/html,<body style="font:14px system-ui;padding:24px;color:#555">APX panel not running at ${WEB_URL}.<br>Start it with <code>pnpm --filter @apx/web dev</code>.</body>`,
      ),
    );
  void chrome.webContents.loadFile(path.join(DIST, "chrome.html"));

  const pushState = () => {
    if (chrome.webContents.isDestroyed()) return;
    chrome.webContents.send("state", { tabs: host.list(), active: host.active, core });
  };
  host.on("changed", pushState);
  chrome.webContents.on("did-finish-load", pushState);

  // The chrome UI is the human's hand: these are user actions, never agent ones.
  ipcMain.handle("chrome:new", (_e, url: string) =>
    host
      .open(url || "https://example.com", "shared", { kind: "user", since: new Date().toISOString() })
      .then(() => undefined),
  );
  ipcMain.handle("chrome:select", (_e, id: string) => host.select(id));
  ipcMain.handle("chrome:close", (_e, id: string) => host.close(id));
  ipcMain.handle("chrome:navigate", (_e, id: string, url: string) => host.userNavigate(id, url));
  ipcMain.handle("chrome:take", (_e, id: string) => host.takeControl(id));
  ipcMain.handle("chrome:give", (_e, id: string) => host.giveBack(id));

  startNodeLink(host, CORE_URL, (s) => {
    core = s;
    pushState();
  });
});

app.on("window-all-closed", () => app.quit());
