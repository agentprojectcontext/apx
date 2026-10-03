// The menu-bar icon and its quick chat: a small window under the icon (or centered, from the global shortcut) with
// the super-agent's chat. It hides when it loses focus, like any menu-bar app.
import path from "node:path";
import { app, BrowserWindow, globalShortcut, Menu, screen, Tray } from "electron";

const WIDTH = 400;
/** How long a click on the menu-bar icon waits to see whether it is a double click. */
const DOUBLE_CLICK_MS = 250;
const HEIGHT = 600;

export type DesktopPrefs = { shortcut: string; launchAtLogin: boolean };

/** The menu-bar icon's right-click menu, in the system's language (the main process has no panel i18n). */
const MENU = {
  en: { open: "Open APX", quick: "Quick chat", quit: "Quit APX" },
  es: { open: "Abrir APX", quick: "Chat rápido", quit: "Salir de APX" },
};

export function createQuick(opts: {
  url: () => string;
  preload: string;
  partition: string;
  assets: string;
  /** Brings the main window back (it hides when closed). */
  openMain: () => void;
}) {
  let win: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let shortcut: string | undefined;

  function window(): BrowserWindow {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: true,
      minWidth: 320,
      minHeight: 360,
      skipTaskbar: true,
      fullscreenable: false,
      alwaysOnTop: true,
      vibrancy: "popover",
      webPreferences: {
        partition: opts.partition,
        sandbox: true,
        preload: opts.preload,
        backgroundThrottling: false,
      },
    });
    // Without skipTransformProcessType, macOS turns the whole app into a menu-bar-only one: no Dock icon.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.on("blur", () => {
      if (!win?.webContents.isDevToolsOpened()) win?.hide();
    });
    void win.loadURL(`${opts.url()}/?quick=1`);
    return win;
  }

  /** Under the menu-bar icon when opened from it; top-center of the screen with the pointer otherwise. */
  function place(w: BrowserWindow, fromTray: boolean): void {
    const b = fromTray ? tray?.getBounds() : undefined;
    const display = screen.getDisplayNearestPoint(b ? { x: b.x, y: b.y } : screen.getCursorScreenPoint());
    const area = display.workArea;
    const [width = WIDTH] = w.getSize();
    const x = b ? Math.round(b.x + b.width / 2 - width / 2) : Math.round(area.x + area.width / 2 - width / 2);
    w.setPosition(Math.min(Math.max(x, area.x + 8), area.x + area.width - width - 8), area.y + 6);
  }

  function toggle(fromTray: boolean): void {
    const w = window();
    if (w.isVisible() && w.isFocused()) {
      w.hide();
      return;
    }
    place(w, fromTray);
    w.show();
    w.focus();
  }

  return {
    start(): void {
      tray = new Tray(path.join(opts.assets, "trayTemplate.png"));
      tray.setToolTip("APX");
      // One click opens the quick chat; a double click opens APX. The click waits a moment so a double click does
      // not flash the quick chat first.
      let pending: ReturnType<typeof setTimeout> | undefined;
      tray.on("click", () => {
        clearTimeout(pending);
        pending = setTimeout(() => toggle(true), DOUBLE_CLICK_MS);
      });
      tray.on("double-click", () => {
        clearTimeout(pending);
        win?.hide();
        opts.openMain();
      });
      const text = app.getLocale().startsWith("es") ? MENU.es : MENU.en;
      const menu = Menu.buildFromTemplate([
        { label: text.open, click: () => opts.openMain() },
        { label: text.quick, click: () => toggle(true) },
        { type: "separator" },
        { label: text.quit, role: "quit" },
      ]);
      // Left click keeps opening the quick chat; the menu is on the right click.
      tray.on("right-click", () => tray?.popUpContextMenu(menu));
      // Load it once now so the first open is instant.
      window();
    },
    /** Re-registers the global shortcut and the start-at-login setting. */
    apply(prefs: DesktopPrefs): string | undefined {
      if (shortcut) globalShortcut.unregister(shortcut);
      shortcut = undefined;
      let error: string | undefined;
      try {
        if (prefs.shortcut && globalShortcut.register(prefs.shortcut, () => toggle(false))) shortcut = prefs.shortcut;
        else if (prefs.shortcut) error = `the shortcut ${prefs.shortcut} is taken by another app`;
      } catch {
        error = `${prefs.shortcut} is not a valid shortcut`;
      }
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.launchAtLogin });
      return error;
    },
    hide(): void {
      win?.hide();
    },
    /** How many things wait for the owner, next to the menu-bar icon and on the Dock. */
    badge(unread: number): void {
      const text = unread > 0 ? String(Math.min(unread, 99)) : "";
      tray?.setTitle(text);
      app.dock?.setBadge(text);
    },
    /** Its renderer process, for the memory report (none until it was first opened). */
    processId(): number | undefined {
      return win && !win.isDestroyed() ? win.webContents.getOSProcessId() : undefined;
    },
    isQuick(sender: Electron.WebContents): boolean {
      return Boolean(win && !win.isDestroyed() && sender === win.webContents);
    },
    stop(): void {
      globalShortcut.unregisterAll();
      tray?.destroy();
    },
  };
}
