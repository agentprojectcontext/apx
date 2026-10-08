// Computer use on macOS, lent to the core as the "computer" capability once the owner turns it on (Config › Desktop).
// Every look starts by finding the window in front, on whichever screen it is, and pictures that window alone. The app
// in front, its window's elements, a click and typing go through System Events (the Accessibility permission); the
// picture comes from Electron (Screen Recording). Values reach AppleScript as arguments, never inside its text.
import { execFile } from "node:child_process";
import { desktopCapturer, type NativeImage, screen, shell, systemPreferences } from "electron";
import type { AgentCursor } from "./cursor.ts";
import { parseKeys, REFUSED_KEYS } from "./keys.ts";

const OSA_MS = 15_000;
/** Reading every element of a window, within the core's deadline for a look (the picture still has to follow). */
const ELEMENTS_MS = 4_000;
/** The longest side of the picture sent to the core, and of a live frame for the panel. */
const SHOT_MAX = 1600;
const FRAME_MAX = 900;

type Bounds = { x: number; y: number; width: number; height: number };
type Target = { app: string; window: string; bounds: Bounds | undefined };
export type ComputerActivity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };

function osa(script: string, args: string[] = [], language = "AppleScript", timeout = OSA_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", language, "-e", script, ...args],
      { timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, out, stderr) => {
        if (!err) return resolve(out.trimEnd());
        if (err.killed) return reject(new Error("timed out"));
        // osascript's own words ("execution error: … (-1743)"), not the script it ran.
        const why =
          String(stderr)
            .trim()
            .split("\n")
            .at(-1)
            ?.replace(/^.*execution error: /, "") || "failed";
        reject(new Error(why.slice(0, 300)));
      },
    );
  });
}

/** Brings an app forward, only when it is not there already (most actions find it in front). */
const ACTIVATE = `
on run argv
  set target to item 1 of argv
  tell application "System Events" to set frontName to name of first application process whose frontmost is true
  if frontName is target then return
  tell application target to activate
  delay 0.2
  try
    tell application "System Events" to tell process target to perform action "AXRaise" of window 1
  end try
  delay 0.1
end run`;

/** The app in front, its front window's name and bounds, then its useful elements: role, name, description, value, x,y. */
const LOOK = `
on run argv
  set withElements to (item 1 of argv) is "1"
  tell application "System Events"
    set p to first application process whose frontmost is true
    set out to (name of p) & tab & (unix id of p) & linefeed
    try
      set w to front window of p
      -- The app's main window, not a small popup in front of it (an extension's, a palette).
      try
        repeat with cand in (windows of p)
          set {cw, ch} to size of cand
          if cw is greater than or equal to 300 and ch is greater than or equal to 200 then
            set w to contents of cand
            exit repeat
          end if
        end repeat
      end try
      set {wx, wy} to position of w
      set {ww, wh} to size of w
      set out to out & (name of w) & linefeed & wx & "," & wy & "," & ww & "," & wh & linefeed
      if withElements then
        set wanted to {"AXButton", "AXCheckBox", "AXRadioButton", "AXTextField", "AXTextArea", "AXPopUpButton", "AXMenuButton", "AXSlider", "AXSwitch", "AXStaticText", "AXLink", "AXTab", "AXRow", "AXComboBox", "AXSearchField"}
        set n to 0
        try
          set everything to entire contents of w
        on error msg
          return out & "error" & tab & msg
        end try
        repeat with e in everything
          if n > 400 then exit repeat
          try
            set r to role of e
            if wanted contains r then
              set {px, py} to position of e
              set {sx, sy} to size of e
              set nm to ""
              try
                set nm to (name of e) as text
              end try
              set ds to ""
              try
                set ds to (description of e) as text
              end try
              set vl to ""
              try
                set vl to (value of e) as text
              end try
              set out to out & r & tab & nm & tab & ds & tab & vl & tab & ((px + sx / 2) as integer) & "," & ((py + sy / 2) as integer) & linefeed
              set n to n + 1
            end if
          end try
        end repeat
      end if
    on error msg
      set out to out & linefeed & linefeed & "error" & tab & msg
    end try
    return out
  end tell
end run`;

/** Keys in the app in front: argv = app, "code" or "text", the key code or character, the modifiers ("cmd shift"). */
const KEY = `
on run argv
  tell application "System Events"
    set frontName to name of first application process whose frontmost is true
    if frontName is not (item 1 of argv) then error "the app in front is " & frontName & ", not " & (item 1 of argv)
    set mods to {}
    if (item 4 of argv) contains "cmd" then set end of mods to command down
    if (item 4 of argv) contains "shift" then set end of mods to shift down
    if (item 4 of argv) contains "option" then set end of mods to option down
    if (item 4 of argv) contains "ctrl" then set end of mods to control down
    if (item 2 of argv) is "code" then
      key code ((item 3 of argv) as integer) using mods
    else
      keystroke (item 3 of argv) using mods
    end if
    return frontName
  end tell
end run`;

/**
 * A real mouse click (CoreGraphics events, in JavaScript for Automation): it moves the pointer there and presses, so
 * it works on any control, not only those with an accessibility action. Refused if another app is in front.
 */
const CLICK = `
function run(argv) {
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  const app = argv[0];
  const x = Number(argv[1]);
  const y = Number(argv[2]);
  const proc = Application("System Events").processes.whose({ frontmost: true })[0];
  const front = proc.name();
  if (front !== app) throw new Error("the app in front is " + front + ", not " + app);
  const pid = proc.unixId();
  // The window really on top at that point, front to back, among normal windows: it must be the approved app's.
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  const top = list.find((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds && x >= w.kCGWindowBounds.X && x < w.kCGWindowBounds.X + w.kCGWindowBounds.Width && y >= w.kCGWindowBounds.Y && y < w.kCGWindowBounds.Y + w.kCGWindowBounds.Height);
  if (!top || top.kCGWindowOwnerPID !== pid) throw new Error("another window covers that point (" + (top ? top.kCGWindowOwnerName : "none") + "): take a new screen_snapshot");
  const p = $.CGPointMake(x, y);
  for (const type of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft));
    delay(0.05);
  }
  return front;
}`;

const TYPE = `
on run argv
  tell application "System Events"
    set frontName to name of first application process whose frontmost is true
    if frontName is not (item 1 of argv) then error "the app in front is " & frontName & ", not " & (item 1 of argv)
    tell process frontName
      set f to value of attribute "AXFocusedUIElement"
      set sub to ""
      try
        set sub to value of attribute "AXSubrole" of f
      end try
      if sub is "AXSecureTextField" then error "the focused field is a password field: the owner types it"
    end tell
    keystroke (item 2 of argv)
    return frontName
  end tell
end run`;

/** Whose window is really on top at a screen point (normal windows only): "pid<TAB>name", or "" for none. */
const TOP_AT = `
function run(argv) {
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  const x = Number(argv[0]);
  const y = Number(argv[1]);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  const top = list.find((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds && x >= w.kCGWindowBounds.X && x < w.kCGWindowBounds.X + w.kCGWindowBounds.Width && y >= w.kCGWindowBounds.Y && y < w.kCGWindowBounds.Y + w.kCGWindowBounds.Height);
  return top ? top.kCGWindowOwnerPID + "\t" + top.kCGWindowOwnerName : "";
}`;

const parseBounds = (line: string | undefined): Bounds | undefined => {
  const [x, y, width, height] = (line ?? "").split(",").map(Number);
  return [x, y, width, height].every((n) => Number.isFinite(n)) && (width ?? 0) > 0 && (height ?? 0) > 0
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : undefined;
};

/** The window in front, wherever it is: its app, name and bounds, and (when asked) its elements. */
async function front(withElements: boolean): Promise<Target & { pid: number; lines: string[] }> {
  const [head = "", window = "", bounds, ...lines] = (
    await osa(LOOK, [withElements ? "1" : "0"], "AppleScript", withElements ? ELEMENTS_MS : OSA_MS)
  ).split("\n");
  const [app = "", pid = ""] = head.split("\t");
  // AppleScript says "missing value" for an attribute an element does not have.
  const clean = lines.filter(Boolean).map((l) => l.replaceAll("missing value", ""));
  return { app, pid: Number(pid), window, bounds: parseBounds(bounds), lines: clean };
}

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
    throw new Error("no picture of the screen: allow Screen Recording for APX in System Settings › Privacy");
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

/** What an action already on its way hears when the owner pulls the emergency stop. */
const STOPPED = "the owner pulled the emergency stop: this action was dropped; end the turn";
/** Long enough for an action already on its way to be dropped; the core ends the turns themselves. */
const STOP_HOLD_MS = 3_000;

export function createComputer(o: {
  cursor: AgentCursor;
  onActivity(a: ComputerActivity): void;
  onStopped(stopped: boolean): void;
}) {
  /** The window an agent is working on: what the panel's live view follows. */
  let target: Target | undefined;
  /** Just after the emergency stop: what was on its way does not reach the screen. */
  let stopped = false;
  const go = () => {
    if (stopped) throw new Error(STOPPED);
  };

  async function look(app?: string, note?: string) {
    if (app) await osa(ACTIVATE, [app]).catch(() => {});
    // A busy window (a long list) can take longer to read than to see: then the picture goes alone.
    const f = await front(true).catch(async () => ({
      ...(await front(false)),
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
    const over = b
      ? await osa(
          TOP_AT,
          [String(Math.round(b.x + b.width / 2)), String(Math.round(b.y + b.height / 2))],
          "JavaScript",
        ).catch(() => "")
      : "";
    const [overPid, overName] = over.split("\t");
    const covered =
      over && Number(overPid) !== f.pid ? `; covered by a window of ${overName}: the picture shows that one` : "";
    const header = `${where}${covered}; positions are screen points, centers to click\nrole\tname\tdescription\tvalue\tx,y`;
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
        const args = p.app ? ["-a", p.app, ...(p.url ? [p.url] : [])] : [String(p.url)];
        o.cursor.say(p.note || (p.url ? new URL(p.url).host : (p.app ?? "")));
        await new Promise<void>((resolve, reject) =>
          execFile("open", args, { timeout: OSA_MS }, (err) =>
            err ? reject(new Error("could not open it")) : resolve(),
          ),
        );
        const app = p.app ?? "the default browser";
        o.onActivity({ kind: "look", app, window: p.url ?? "" });
        return { app };
      }
      if (method === "computer.key") {
        const keys = String(p.keys ?? "")
          .toLowerCase()
          .replace(/\s+/g, "");
        if (REFUSED_KEYS.has(keys)) throw new Error(`${p.keys} closes or quits things: ask the owner to do it`);
        const k = parseKeys(keys);
        if (!k) throw new Error(`cannot press "${p.keys}": use names like enter, tab, esc, cmd+l, arrows`);
        await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
        go();
        o.cursor.say(p.note || `⌨ ${p.keys}`);
        const app = await osa(KEY, [String(p.app ?? ""), k.kind, k.key, k.mods]);
        o.onActivity({ kind: "type", app, window: target?.window ?? "" });
        return { app };
      }
      if (method === "computer.click") {
        const x = Number(p.x);
        const y = Number(p.y);
        // Approved for this app: bring it back to the front (the owner may have switched), then show where it clicks.
        await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
        await o.cursor.moveTo(x, y, p.note || p.app || "");
        // The stop may come while the pointer glides there: then no click.
        go();
        const app = await osa(CLICK, [String(p.app ?? ""), String(x), String(y)], "JavaScript");
        o.cursor.pulse();
        o.onActivity({ kind: "click", app, window: target?.window ?? "", x, y });
        return { app };
      }
      if (method === "computer.type") {
        await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
        go();
        o.cursor.say(p.note || "⌨");
        const app = await osa(TYPE, [String(p.app ?? ""), String(p.text ?? "")]);
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

/** What macOS lets APX do: see the screen, and drive other apps (Accessibility). */
export function computerPermissions() {
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
