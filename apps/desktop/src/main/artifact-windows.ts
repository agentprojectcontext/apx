// An artifact in a window of its own: the panel at ?artifact=<id>, one window per artifact, brought back when asked again.
import { BrowserWindow, type WebContents } from "electron";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createArtifactWindows(opts: {
  url: () => string;
  preload: string;
  partition: string;
  /** Web links from the artifact's page go to the system browser, as from the panel. */
  links: (wc: WebContents) => void;
  /** The panel hears when one opens or closes, so it shows a note where the app was. */
  changed: (id: string, open: boolean) => void;
}) {
  const open = new Map<string, BrowserWindow>();
  return {
    open(id: string, title: string): void {
      if (!ID.test(id)) return;
      const cur = open.get(id);
      if (cur && !cur.isDestroyed()) {
        if (cur.isMinimized()) cur.restore();
        cur.focus();
        return;
      }
      const win = new BrowserWindow({
        width: 1200,
        height: 820,
        minWidth: 360,
        minHeight: 320,
        title: title.slice(0, 120) || "APX",
        show: false,
        webPreferences: { partition: opts.partition, sandbox: true, preload: opts.preload },
      });
      opts.links(win.webContents);
      win.once("ready-to-show", () => win.show());
      win.on("closed", () => {
        open.delete(id);
        opts.changed(id, false);
      });
      open.set(id, win);
      opts.changed(id, true);
      void win.loadURL(`${opts.url()}/?artifact=${encodeURIComponent(id)}`);
    },
    close(id: string): void {
      const w = open.get(id);
      if (w && !w.isDestroyed()) w.close();
    },
    /** Each open window's page, for the memory report and its artifact frames. */
    pages(): { title: string; contents: WebContents }[] {
      return [...open.values()]
        .filter((w) => !w.isDestroyed())
        .map((w) => ({ title: w.getTitle(), contents: w.webContents }));
    },
    /** Whether a sender is one of these windows (it may read the core's token, like the panel). */
    owns(sender: WebContents): boolean {
      for (const w of open.values()) if (!w.isDestroyed() && w.webContents === sender) return true;
      return false;
    },
  };
}
