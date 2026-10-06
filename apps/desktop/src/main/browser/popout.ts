// The browser in a window of its own: a small APX panel (?browser) with the tab strip and the toolbar, and the shown
// tab's native view laid over its slot, the same way the main window does it. Closing it brings the tab back.
import { BaseWindow, type WebContents, WebContentsView } from "electron";

export type Bounds = { x: number; y: number; width: number; height: number };

export function createPopout(opts: {
  url: () => string;
  preload: string;
  partition: string;
  /** Opened or closed: the main window re-lays the tab and tells its panel. */
  changed: (open: boolean) => void;
  /** Its slot moved or its window resized. */
  layout: () => void;
}) {
  let win: BaseWindow | undefined;
  let panel: WebContentsView | undefined;
  let slot: Bounds | null = null;

  const fit = () => {
    if (!win || !panel) return;
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width, height });
  };

  return {
    /** Opens it on `tab` (the one the side panel shows), or brings it forward. */
    open(title: string, tab?: string): void {
      if (win) {
        win.show();
        win.focus();
        return;
      }
      win = new BaseWindow({ width: 1100, height: 820, minWidth: 480, minHeight: 360, title });
      panel = new WebContentsView({
        webPreferences: {
          partition: opts.partition,
          sandbox: true,
          preload: opts.preload,
          backgroundThrottling: false,
        },
      });
      win.contentView.addChildView(panel);
      fit();
      win.on("resize", () => {
        fit();
        opts.layout();
      });
      const closing = win;
      const view = panel;
      // Hand the tab back before the window goes: a view left inside a closed window is gone with it.
      closing.on("close", () => {
        for (const child of closing.contentView.children)
          if (child !== view) closing.contentView.removeChildView(child);
        win = undefined;
        panel = undefined;
        slot = null;
        opts.changed(false);
      });
      closing.on("closed", () => view.webContents.close());
      const on = tab ? `&tab=${encodeURIComponent(tab)}` : "";
      void panel.webContents.loadURL(`${opts.url()}/?browser=1${on}`);
      opts.changed(true);
    },
    close(): void {
      win?.close();
    },
    window: (): BaseWindow | undefined => win,
    /** Where the tab goes in it; null while its panel has no page area on screen. */
    slot: (): Bounds | null => slot,
    setSlot(b: Bounds | null): void {
      slot = b;
      opts.layout();
    },
    setTitle(title: string): void {
      win?.setTitle(title);
    },
    isPanel: (sender: WebContents): boolean => Boolean(panel && sender === panel.webContents),
    processId: (): number | undefined => panel?.webContents.getOSProcessId(),
    panel: (): WebContents | undefined => panel?.webContents,
  };
}
