// The menu-bar icon and its quick chat: a small window under the icon (or centered, from the global shortcut) with
// the super-agent's chat. It hides when it loses focus, like any menu-bar app.
import path from "node:path";
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, nativeTheme, screen, Tray } from "electron";
import { setLaunchAtLogin } from "./autostart.ts";
import { quickPlacement } from "./quick-placement.ts";

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
  let pending: ReturnType<typeof setTimeout> | undefined;
  let dismiss: ReturnType<typeof setTimeout> | undefined;
  let menuPoint: Electron.Point | undefined;
  let unreadCount = 0;
  let pressedVisible: boolean | undefined;

  function trayImage(): Electron.NativeImage {
    const attention = unreadCount > 0;
    const name =
      process.platform === "darwin"
        ? attention && nativeTheme.shouldUseDarkColors
          ? "tray-white"
          : "trayTemplate"
        : "tray-color";
    const image = nativeImage.createFromPath(
      path.join(opts.assets, `${name}${unreadCount > 0 ? "-attention" : ""}.png`),
    );
    // Template tinting would turn the orange badge into the system's monochrome color.
    if (process.platform === "darwin") image.setTemplateImage(!attention);
    return process.platform === "win32" ? image.resize({ width: 16 }) : image;
  }

  function updateBadge(): void {
    const text = unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : "";
    tray?.setImage(trayImage());
    if (process.platform === "darwin") tray?.setTitle(text, { fontType: "monospacedDigit" });
    const suffix = app.getLocale().startsWith("es") ? "avisos pendientes" : "unread notifications";
    tray?.setToolTip(unreadCount > 0 ? `APX · ${unreadCount} ${suffix}` : "APX");
    app.dock?.setBadge(text);
  }

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
      // A native tray click blurs the popup before its click event reaches Electron.
      clearTimeout(dismiss);
      if (pressedVisible !== undefined) return;
      if (tray && process.platform !== "linux") {
        const point = screen.getCursorScreenPoint();
        const bounds = tray.getBounds();
        if (
          bounds.width > 0 &&
          bounds.height > 0 &&
          point.x >= bounds.x &&
          point.x < bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y < bounds.y + bounds.height
        )
          return;
      }
      dismiss = setTimeout(() => {
        dismiss = undefined;
        if (!win?.isFocused() && !win?.webContents.isDevToolsOpened()) win?.hide();
      }, DOUBLE_CLICK_MS + 50);
    });
    win.on("focus", () => clearTimeout(dismiss));
    void win.loadURL(`${opts.url()}/?quick=1`);
    return win;
  }

  /** Capture the clicked display before the double-click delay or a context menu moves the pointer. */
  function placement(fromTray: boolean, point = screen.getCursorScreenPoint(), bounds?: Electron.Rectangle) {
    const display = screen.getDisplayNearestPoint(point);
    const center =
      bounds && bounds.width > 0 && bounds.height > 0
        ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
        : undefined;
    const anchor = fromTray
      ? center && screen.getDisplayNearestPoint(center).id === display.id
        ? center
        : point
      : undefined;
    return { area: display.workArea, anchor };
  }

  function toggle(fromTray: boolean, target = placement(fromTray)): void {
    clearTimeout(dismiss);
    const w = window();
    if (w.isVisible()) {
      w.hide();
      return;
    }
    const [width = WIDTH, height = HEIGHT] = w.getSize();
    w.setBounds(quickPlacement(target.area, { width, height }, target.anchor));
    w.show();
    w.focus();
  }

  return {
    start(): void {
      tray = new Tray(trayImage());
      updateBadge();
      if (process.platform === "darwin") nativeTheme.on("updated", updateBadge);
      if (process.platform === "darwin") {
        // Mouse-down precedes mouse-up's click, even when a secondary display reports stale tray bounds.
        tray.on("mouse-down", () => {
          clearTimeout(dismiss);
          pressedVisible = Boolean(win?.isVisible());
        });
        tray.on("mouse-leave", () => {
          if (pressedVisible === undefined) return;
          pressedVisible = undefined;
          if (!win?.isFocused() && !win?.webContents.isDevToolsOpened()) win?.hide();
        });
      }
      // One click opens the quick chat; a double click opens APX. The click waits a moment so a double click does
      // not flash the quick chat first.
      tray.on("click", (_event, bounds, point) => {
        clearTimeout(dismiss);
        const wasVisible = pressedVisible ?? win?.isVisible();
        pressedVisible = undefined;
        if (process.platform === "linux" && pending) {
          clearTimeout(pending);
          pending = undefined;
          win?.hide();
          opts.openMain();
          return;
        }
        clearTimeout(pending);
        // Cocoa reports a local point and Linux can report (0, 0); capture the screen cursor before waiting.
        const clickPoint =
          process.platform === "win32" ? (point ?? screen.getCursorScreenPoint()) : screen.getCursorScreenPoint();
        const target = placement(true, clickPoint, bounds);
        pending = setTimeout(() => {
          pending = undefined;
          if (wasVisible) win?.hide();
          else toggle(true, target);
        }, DOUBLE_CLICK_MS);
      });
      tray.on("double-click", () => {
        pressedVisible = undefined;
        clearTimeout(dismiss);
        clearTimeout(pending);
        pending = undefined;
        win?.hide();
        opts.openMain();
      });
      const text = app.getLocale().startsWith("es") ? MENU.es : MENU.en;
      const menu = Menu.buildFromTemplate([
        {
          label: text.open,
          click: () => {
            win?.hide();
            opts.openMain();
          },
        },
        { label: text.quick, click: () => toggle(true, placement(true, menuPoint)) },
        { type: "separator" },
        { label: text.quit, role: "quit" },
      ]);
      // Left click keeps opening the quick chat; the menu is on the right click.
      if (process.platform === "linux") tray.setContextMenu(menu);
      else
        tray.on("right-click", () => {
          pressedVisible = undefined;
          clearTimeout(dismiss);
          clearTimeout(pending);
          pending = undefined;
          menuPoint = screen.getCursorScreenPoint();
          tray?.popUpContextMenu(menu);
        });
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
      setLaunchAtLogin(prefs.launchAtLogin);
      return error;
    },
    hide(): void {
      clearTimeout(pending);
      pending = undefined;
      clearTimeout(dismiss);
      pressedVisible = undefined;
      win?.hide();
    },
    /** Opens it (centered under the top of the screen) or hides it when it is in front. */
    toggle,
    /** Shows an integrated indicator, a macOS menu-bar count and the Dock badge. */
    badge(unread: number): void {
      const count = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
      if (count === unreadCount) return;
      unreadCount = count;
      updateBadge();
    },
    /** Its renderer process, for the memory report (none until it was first opened). */
    processId(): number | undefined {
      return win && !win.isDestroyed() ? win.webContents.getOSProcessId() : undefined;
    },
    isQuick(sender: Electron.WebContents): boolean {
      return Boolean(win && !win.isDestroyed() && sender === win.webContents);
    },
    stop(): void {
      clearTimeout(pending);
      clearTimeout(dismiss);
      globalShortcut.unregisterAll();
      nativeTheme.off("updated", updateBadge);
      tray?.destroy();
    },
  };
}
