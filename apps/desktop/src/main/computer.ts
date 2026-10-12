// Computer use, lent to the core as the "computer" capability once the owner turns it on (Config › Desktop), on macOS
// and Windows. Every look starts by finding the window in front, on whichever screen it is, and pictures that window
// alone. The picture comes from Electron; the window, its elements, a click and typing come from the platform's driver.
import { desktopCapturer, type NativeImage, screen, shell, systemPreferences } from "electron";
import type { Bounds, ComputerDriver } from "./computer-driver.ts";
import { macDriver } from "./computer-mac.ts";
import { windowsDriver } from "./computer-win.ts";
import type { AgentCursor } from "./cursor.ts";
import { refusedKeys } from "./keys.ts";

/** The platforms computer use works on. */
export const COMPUTER_PLATFORMS: readonly string[] = ["darwin", "win32"];

/** The longest side of the picture sent to the core, and of a live frame for the panel. */
const SHOT_MAX = 1600;
const FRAME_MAX = 900;

type Target = { app: string; window: string; bounds: Bounds | undefined };
export type ComputerActivity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };

/**
 * A picture of `bounds` (a window) from the screen it is on, or of the main screen when there are none: each screen
 * is looked up again every time, so a window moved to another monitor is still found.
 */
async function picture(bounds: Bounds | undefined, max: number): Promise<NativeImage> {
  const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  // One size for every screen's thumbnail: big enough for the largest one at its own density.
  const width = Math.max(...all.map((d) => d.size.width * d.scaleFactor));
  const height = Math.max(...all.map((d) => d.size.height * d.scaleFactor));
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty())
    throw new Error(
      process.platform === "darwin"
        ? "no picture of the screen: allow Screen Recording for APX in System Settings › Privacy"
        : "no picture of the screen",
    );
  let img = src.thumbnail;
  const size = img.getSize();
  // The thumbnail keeps the screen's proportions inside the size asked: scale points to its pixels.
  const k = size.width / display.size.width;
  if (bounds) {
    const x = Math.max(0, Math.round((bounds.x - display.bounds.x) * k));
    const y = Math.max(0, Math.round((bounds.y - display.bounds.y) * k));
    const w = Math.min(size.width - x, Math.round(bounds.width * k));
    const h = Math.min(size.height - y, Math.round(bounds.height * k));
    if (w > 0 && h > 0) img = img.crop({ x, y, width: w, height: h });
  }
  const s = img.getSize();
  const scale = Math.min(1, max / Math.max(s.width, s.height));
  return scale < 1 ? img.resize({ width: Math.round(s.width * scale), quality: "good" }) : img;
}

/** Browsers, by their app names (and Windows' process names): their pages are read from the picture. */
const BROWSERS =
  /^(google chrome|chrome|safari|zen|firefox|arc|microsoft edge|msedge|brave browser|brave|opera|vivaldi|chromium)$/i;

/** What an action already on its way hears when the owner pulls the emergency stop. */
const STOPPED = "the owner pulled the emergency stop: this action was dropped; end the turn";
/** Long enough for an action already on its way to be dropped; the core ends the turns themselves. */
const STOP_HOLD_MS = 3_000;

/** The owner's screens, numbered as they are now (main first), and which one holds `bounds`. */
function screensText(bounds?: Bounds): string {
  const main = screen.getPrimaryDisplay();
  const all = [main, ...screen.getAllDisplays().filter((d) => d.id !== main.id)];
  const list = all
    .map(
      (d, i) =>
        `${i + 1}${i === 0 ? " (main)" : ""} at ${d.bounds.x},${d.bounds.y} ${d.bounds.width}x${d.bounds.height}`,
    )
    .join("; ");
  const on = bounds ? all.findIndex((d) => d.id === screen.getDisplayMatching(bounds).id) + 1 : 0;
  return `${all.length} screen${all.length === 1 ? "" : "s"}: ${list}${on ? `. This window is on screen ${on}` : ""}`;
}

export function createComputer(o: {
  cursor: AgentCursor;
  driver?: ComputerDriver;
  onActivity(a: ComputerActivity): void;
  onStopped(stopped: boolean): void;
}) {
  const d = o.driver ?? (process.platform === "win32" ? windowsDriver : macDriver);
  const front = d.front;
  /** The window an agent is working on: what the panel's live view follows. */
  let target: Target | undefined;
  /** Just after the emergency stop: what was on its way does not reach the screen. */
  let stopped = false;
  const go = () => {
    if (stopped) throw new Error(STOPPED);
  };

  async function look(app?: string, note?: string) {
    if (app) await d.activate(app).catch(() => {});
    // A browser's page is read from its picture: its elements take seconds and say less. Elsewhere a busy window
    // (a long list) can also take longer to read than to see: then the picture goes alone.
    const quick = await front(false);
    const f = BROWSERS.test(quick.app)
      ? { ...quick, lines: ["(a browser: read the page from the picture)"] }
      : await front(true).catch(() => ({
          ...quick,
          lines: ["(this window's elements took too long to read: look at the picture)"],
        }));
    target = { app: f.app, window: f.window, bounds: f.bounds };
    // What it is doing, by the window it looks at (the pointer never shows in the picture).
    const b0 = f.bounds;
    if (b0) void o.cursor.moveTo(b0.x + b0.width / 2, b0.y + 40, note || "👀");
    const img = await picture(f.bounds, SHOT_MAX);
    const where = f.bounds
      ? `window at ${f.bounds.x},${f.bounds.y}, ${f.bounds.width}x${f.bounds.height} points`
      : "the main screen";
    // The picture shows what is on screen: say so when another window covers this one.
    const b = f.bounds;
    const over = b ? await d.topAt(b.x + b.width / 2, b.y + b.height / 2).catch(() => undefined) : undefined;
    const covered =
      over && over.pid !== f.pid ? `; covered by a window of ${over.name}: the picture shows that one` : "";
    // How a point in the picture maps to the screen, to click what only the picture shows.
    const size = img.getSize();
    const scale = b ? b.width / size.width : 1;
    const map = b
      ? `; the picture is ${size.width}x${size.height} px: its pixel (px,py) is the screen point (${b.x} + px*${scale.toFixed(3)}, ${b.y} + py*${scale.toFixed(3)})`
      : "";
    const header = `${screensText(b)}.\n${where}${covered}${map}; positions are screen points, centers to click\nrole\tname\tdescription\tvalue\tx,y`;
    o.onActivity({ kind: "look", app: f.app, window: f.window });
    return {
      mime: "image/jpeg",
      data: img.toJPEG(70).toString("base64"),
      app: f.app,
      window: f.window,
      elements: [header, ...f.lines].join("\n"),
    };
  }

  return {
    async handle(method: string, params: unknown): Promise<unknown> {
      go();
      const p = (params ?? {}) as {
        x?: number;
        y?: number;
        app?: string;
        text?: string;
        keys?: string;
        url?: string;
        note?: string;
      };
      if (method === "computer.snapshot") return look(p.app, p.note);
      if (method === "computer.open") {
        o.cursor.say(p.note || (p.url ? new URL(p.url).host : (p.app ?? "")));
        await d.open(p.app, p.url);
        const app = p.app ?? "the default browser";
        // Closed before, it takes a moment to start: wait for its window to come up, and say on which screen.
        let where: string | undefined;
        if (p.app) {
          const wanted = p.app.toLowerCase();
          for (let i = 0; i < 24 && !where; i++) {
            const f = await front(false).catch(() => undefined);
            const shown = f?.app.toLowerCase() ?? "";
            if (f?.bounds && shown && (shown === wanted || wanted.includes(shown) || shown.includes(wanted))) {
              target = { app: f.app, window: f.window, bounds: f.bounds };
              where = `${screensText(f.bounds)}; its window "${f.window}" is at ${f.bounds.x},${f.bounds.y} ${f.bounds.width}x${f.bounds.height}`;
            } else await new Promise((r) => setTimeout(r, 250));
          }
        }
        o.onActivity({ kind: "look", app, window: p.url ?? "" });
        return where ? { app, where } : { app };
      }
      if (method === "computer.key") {
        const keys = String(p.keys ?? "")
          .toLowerCase()
          .replace(/\s+/g, "");
        if (refusedKeys(keys, process.platform))
          throw new Error(`${p.keys} closes or quits things: ask the owner to do it`);
        if (!d.canPress(keys))
          throw new Error(`cannot press "${p.keys}": use names like enter, tab, esc, cmd+l, arrows`);
        go();
        o.cursor.say(p.note || `⌨ ${p.keys}`);
        // Keys go to the app in front: browsers ignore keys sent to them in the background.
        await d.activate(String(p.app ?? "")).catch(() => {});
        const app = await d.key(String(p.app ?? ""), keys);
        o.onActivity({ kind: "type", app, window: target?.window ?? "" });
        return { app };
      }
      if (method === "computer.click") {
        const x = Number(p.x);
        const y = Number(p.y);
        await o.cursor.moveTo(x, y, p.note || p.app || "");
        // The stop may come while the pointer glides there: then no click.
        go();
        const name = String(p.app ?? "");
        // Pressed through accessibility when it can (the owner's pointer stays where it is); else a real click that
        // puts their pointer straight back.
        const done = await d.press(name, x, y).catch((e: unknown) => `none: ${errorText(e)}`);
        let how = done;
        if (done.startsWith("none")) {
          await d.activate(name).catch(() => {});
          await d.click(name, x, y);
          how = `a real click (nothing there takes a press: ${done.replace(/^none:? ?/, "")})`;
        }
        const app = String(p.app ?? "");
        o.cursor.pulse();
        o.onActivity({ kind: "click", app, window: target?.window ?? "", x, y });
        return { app, how };
      }
      if (method === "computer.type") {
        go();
        o.cursor.say(p.note || "⌨");
        const name = String(p.app ?? "");
        const text = String(p.text ?? "");
        if (!(await d.insert(name, text))) {
          await d.activate(name).catch(() => {});
          await d.paste(name, text);
        }
        const app = String(p.app ?? "");
        o.onActivity({ kind: "type", app, window: target?.window ?? "" });
        return { app };
      }
      throw new Error(`unknown method ${method}`);
    },
    /**
     * The emergency stop, for this time only: drops what is on its way, takes the pointer off the screen and tells the
     * core, which ends the turns that were using the computer. The next request works as usual.
     */
    stop() {
      if (stopped) return;
      stopped = true;
      o.cursor.hide();
      o.onStopped(true);
      setTimeout(() => {
        stopped = false;
        o.onStopped(false);
      }, STOP_HOLD_MS);
    },
    /** A live frame of the window an agent is working on (found again on its screen), for the panel only. */
    async frame(): Promise<{ data: string; bounds?: Bounds; app: string; window: string } | undefined> {
      if (!target) return undefined;
      try {
        const f = await front(false);
        // Follow the same app; if the owner brought another one forward, keep the last place known.
        if (f.app === target.app) target = { app: f.app, window: f.window, bounds: f.bounds };
      } catch {}
      const img = await picture(target.bounds, FRAME_MAX);
      return {
        data: `data:image/jpeg;base64,${img.toJPEG(60).toString("base64")}`,
        ...(target.bounds ? { bounds: target.bounds } : {}),
        app: target.app,
        window: target.window,
      };
    },
  };
}

/** What macOS lets APX do: see the screen, and drive other apps (Accessibility). Windows asks for neither. */
export function computerPermissions() {
  if (process.platform === "win32") return { screen: "granted", accessibility: true };
  if (process.platform !== "darwin") return { screen: "unsupported", accessibility: false };
  return {
    screen: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

/** Opens the pane of System Settings where the owner grants it (Accessibility also shows macOS's own prompt). */
export function openPrivacy(kind: "screen" | "accessibility"): void {
  if (kind === "accessibility") systemPreferences.isTrustedAccessibilityClient(true);
  void shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${kind === "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility"}`,
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
