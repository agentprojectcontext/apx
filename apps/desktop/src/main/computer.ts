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

/**
 * Real keyboard events (CoreGraphics, in JavaScript for Automation): argv = app, key code, modifier flags. System
 * Events' keystroke is not used: macOS refuses it to helper processes even with Accessibility allowed.
 */
const KEY = `
function run(argv) {
  ObjC.import("CoreGraphics");
  const procs = Application("System Events").processes.whose({ name: argv[0] });
  if (!procs.length) throw new Error(argv[0] + " is not open: open it with screen_open");
  const pid = procs[0].unixId();
  const code = Number(argv[1]);
  const flags = Number(argv[2]);
  for (const down of [true, false]) {
    const e = $.CGEventCreateKeyboardEvent(null, code, down);
    if (flags) $.CGEventSetFlags(e, flags);
    $.CGEventPost($.kCGHIDEventTap, e);
    delay(0.02);
  }
  return argv[0];
}`;

/**
 * Acts on the element at a screen point through accessibility, in front or not, with no pointer moving: presses a
 * control (button, link, checkbox, tab, menu item…), or focuses a field. Chromium and Electron build their page tree
 * only when asked (AXManualAccessibility), so a first look that finds only the page itself waits and asks again.
 * argv = app, x, y. Returns "pressed <role> <name>", "focused <role> <name>", or "none".
 */
const AX_PRESS = `
function run(argv) {
  ObjC.import("ApplicationServices");
  const procs = Application("System Events").processes.whose({ name: argv[0] });
  if (!procs.length) throw new Error(argv[0] + " is not open: open it with screen_open");
  const app = $.AXUIElementCreateApplication(procs[0].unixId());
  // Electron builds its page tree for AXManualAccessibility, Chrome for AXEnhancedUserInterface (screen readers).
  $.AXUIElementSetAttributeValue(app, $("AXManualAccessibility"), $.kCFBooleanTrue);
  $.AXUIElementSetAttributeValue(app, $("AXEnhancedUserInterface"), $.kCFBooleanTrue);
  // A text attribute, or "": anything else (a number, a struct) never breaks the press.
  const str = (el, name) => {
    try {
      const r = Ref();
      if ($.AXUIElementCopyAttributeValue(el, $(name), r) !== 0 || !r[0]) return "";
      const v = ObjC.unwrap(ObjC.castRefToObject(r[0]));
      return typeof v === "string" ? v : "";
    } catch (e) {
      return "";
    }
  };
  const PRESS = ["AXButton", "AXLink", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem", "AXTab", "AXDisclosureTriangle", "AXCell", "AXRow", "AXImage", "AXStaticText"];
  const FIELD = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"];
  const at = () => {
    const ref = Ref();
    return $.AXUIElementCopyElementAtPosition(app, Number(argv[1]), Number(argv[2]), ref) === 0 ? ref[0] : null;
  };
  // Until the page tree is built, the point only finds the page's frame: ask again a few times.
  let el = at();
  for (let n = 0; n < 4 && el && ["AXWebArea", "AXScrollArea", "AXWindow", "AXApplication", "AXGroup", ""].indexOf(str(el, "AXRole")) >= 0; n++) {
    delay(0.35);
    el = at();
  }
  const seen = [];
  for (let i = 0; i < 6 && el; i++) {
    const role = str(el, "AXRole");
    seen.push(role || "?");
    const label = (str(el, "AXTitle") || str(el, "AXDescription")).slice(0, 40);
    if (FIELD.indexOf(role) >= 0) {
      if ($.AXUIElementSetAttributeValue(el, $("AXFocused"), $.kCFBooleanTrue) === 0) return "focused " + role + " " + label;
      return "none";
    }
    let actions = [];
    try {
      const a = Ref();
      if ($.AXUIElementCopyActionNames(el, a) === 0 && a[0]) actions = ObjC.deepUnwrap(ObjC.castRefToObject(a[0])) || [];
    } catch (e) {}
    if (PRESS.indexOf(role) >= 0 && actions && actions.indexOf("AXPress") >= 0)
      return $.AXUIElementPerformAction(el, $("AXPress")) === 0 ? "pressed " + role + " " + label : "none";
    if (["AXWebArea", "AXWindow", "AXApplication"].indexOf(role) >= 0) return "none: " + seen.join(" < ");
    try {
      const up = Ref();
      el = $.AXUIElementCopyAttributeValue(el, $("AXParent"), up) === 0 ? up[0] : null;
    } catch (e) {
      el = null;
    }
  }
  return "none: " + (seen.join(" < ") || "no element at that point");
}`;

/**
 * A real mouse click, when nothing at the point takes a press: the pointer goes there, clicks and comes straight back
 * to where the owner had it. Refused if another app's window covers the point. argv = app, x, y.
 */
const CLICK = `
function run(argv) {
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  const procs = Application("System Events").processes.whose({ name: argv[0] });
  if (!procs.length) throw new Error(argv[0] + " is not open: open it with screen_open");
  const pid = procs[0].unixId();
  const x = Number(argv[1]);
  const y = Number(argv[2]);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  const top = list.find((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds && x >= w.kCGWindowBounds.X && x < w.kCGWindowBounds.X + w.kCGWindowBounds.Width && y >= w.kCGWindowBounds.Y && y < w.kCGWindowBounds.Y + w.kCGWindowBounds.Height);
  if (!top || top.kCGWindowOwnerPID !== pid) throw new Error("another window covers that point (" + (top ? top.kCGWindowOwnerName : "none") + "): take a new screen_snapshot");
  const back = $.CGEventGetLocation($.CGEventCreate(null));
  const p = $.CGPointMake(x, y);
  for (const type of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft));
    delay(0.03);
  }
  $.CGWarpMouseCursorPosition(back);
  $.CGAssociateMouseAndMouseCursorPosition(true);
  return argv[0];
}`;

/**
 * Types into the app's focused field through accessibility (inserted at the caret), in front or not. argv = app,
 * text. Returns "typed", or "no" when that field does not take it.
 */
const AX_TYPE = `
function run(argv) {
  ObjC.import("ApplicationServices");
  const procs = Application("System Events").processes.whose({ name: argv[0] });
  if (!procs.length) throw new Error(argv[0] + " is not open: open it with screen_open");
  const app = $.AXUIElementCreateApplication(procs[0].unixId());
  $.AXUIElementSetAttributeValue(app, $("AXManualAccessibility"), $.kCFBooleanTrue);
  $.AXUIElementSetAttributeValue(app, $("AXEnhancedUserInterface"), $.kCFBooleanTrue);
  const f = Ref();
  if ($.AXUIElementCopyAttributeValue(app, $("AXFocusedUIElement"), f) !== 0 || !f[0]) return "no";
  const sub = Ref();
  $.AXUIElementCopyAttributeValue(f[0], $("AXSubrole"), sub);
  if (sub[0] && ObjC.unwrap(ObjC.castRefToObject(sub[0])) === "AXSecureTextField")
    throw new Error("the focused field is a password field: the owner types it");
  return $.AXUIElementSetAttributeValue(f[0], $("AXSelectedText"), $(argv[1])) === 0 ? "typed" : "no";
}`;

const TYPE = `
function run(argv) {
  ObjC.import("AppKit");
  ObjC.import("CoreGraphics");
  const procs = Application("System Events").processes.whose({ name: argv[0] });
  if (!procs.length) throw new Error(argv[0] + " is not open: open it with screen_open");
  const proc = procs[0];
  const pid = proc.unixId();
  let sub = "";
  try {
    sub = proc.attributes.byName("AXFocusedUIElement").value().attributes.byName("AXSubrole").value();
  } catch (e) {}
  if (sub === "AXSecureTextField") throw new Error("the focused field is a password field: the owner types it");
  // Pasted, not typed key by key: fast, any language; the owner's clipboard is put back right after.
  const pb = $.NSPasteboard.generalPasteboard;
  // Everything it held (text, an image, files), item by item, to put back as it was.
  const saved = [];
  const items = pb.pasteboardItems;
  for (let i = 0; i < items.count; i++) {
    const item = items.objectAtIndex(i);
    const copy = $.NSPasteboardItem.alloc.init;
    for (let j = 0; j < item.types.count; j++) {
      const type = item.types.objectAtIndex(j);
      const data = item.dataForType(type);
      if (!data.isNil()) copy.setDataForType(data, type);
    }
    saved.push(copy);
  }
  pb.clearContents;
  pb.setStringForType($(argv[1]), $.NSPasteboardTypeString);
  for (const down of [true, false]) {
    const e = $.CGEventCreateKeyboardEvent(null, 9, down);
    $.CGEventSetFlags(e, 0x100000);
    $.CGEventPost($.kCGHIDEventTap, e);
    delay(0.02);
  }
  delay(0.25);
  pb.clearContents;
  if (saved.length) pb.writeObjects($(saved));
  return argv[0];
}`;

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
/**
 * The app's front window as the screen shows it (the window server's list, front to back, normal windows of a real
 * size): "x,y,w,h<TAB>title", or "" when it has none on screen. Accessibility's own list counts windows a browser
 * keeps hidden, which sent the picture to the wrong monitor. argv = pid.
 */
const SHOWN_WINDOW = `
function run(argv) {
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  const pid = Number(argv[0]);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  const w = list.find((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width >= 300 && w.kCGWindowBounds.Height >= 200);
  if (!w) return "";
  const b = w.kCGWindowBounds;
  return [b.X, b.Y, b.Width, b.Height].map(Math.round).join(",") + "\t" + (w.kCGWindowName || "");
}`;

async function front(withElements: boolean): Promise<Target & { pid: number; lines: string[] }> {
  const [head = "", window = "", bounds, ...lines] = (
    await osa(LOOK, [withElements ? "1" : "0"], "AppleScript", withElements ? ELEMENTS_MS : OSA_MS)
  ).split("\n");
  const [app = "", pid = ""] = head.split("\t");
  // AppleScript says "missing value" for an attribute an element does not have.
  const clean = lines.filter(Boolean).map((l) => l.replaceAll("missing value", ""));
  // Where its window really is on screen, whatever monitor: the window server knows better than accessibility.
  const [shown = "", title = ""] = (await osa(SHOWN_WINDOW, [pid], "JavaScript").catch(() => "")).split("\t");
  const real = parseBounds(shown);
  return {
    app,
    pid: Number(pid),
    window: title || window,
    bounds: real ?? parseBounds(bounds),
    lines: clean,
  };
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

/** Browsers, by their process names: their pages are read from the picture. */
const BROWSERS = /^(google chrome|chrome|safari|zen|firefox|arc|microsoft edge|brave browser|opera|vivaldi|chromium)$/i;

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
        const args = p.app ? ["-a", p.app, ...(p.url ? [p.url] : [])] : [String(p.url)];
        o.cursor.say(p.note || (p.url ? new URL(p.url).host : (p.app ?? "")));
        await new Promise<void>((resolve, reject) =>
          execFile("open", args, { timeout: OSA_MS }, (err) =>
            err ? reject(new Error("could not open it")) : resolve(),
          ),
        );
        const app = p.app ?? "the default browser";
        // Closed before, it takes a moment to start: wait for its window to come up, and say on which screen.
        let where: string | undefined;
        if (p.app) {
          const wanted = p.app.toLowerCase();
          for (let i = 0; i < 24 && !where; i++) {
            const f = await front(false).catch(() => undefined);
            if (f?.bounds && (f.app.toLowerCase() === wanted || wanted.includes(f.app.toLowerCase()))) {
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
        if (REFUSED_KEYS.has(keys)) throw new Error(`${p.keys} closes or quits things: ask the owner to do it`);
        const k = parseKeys(keys);
        if (!k) throw new Error(`cannot press "${p.keys}": use names like enter, tab, esc, cmd+l, arrows`);
        go();
        o.cursor.say(p.note || `⌨ ${p.keys}`);
        // Keys go to the app in front: browsers ignore keys sent to them in the background.
        await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
        const app = await osa(KEY, [String(p.app ?? ""), String(k.code), String(k.flags)], "JavaScript");
        o.onActivity({ kind: "type", app, window: target?.window ?? "" });
        return { app };
      }
      if (method === "computer.click") {
        const x = Number(p.x);
        const y = Number(p.y);
        await o.cursor.moveTo(x, y, p.note || p.app || "");
        // The stop may come while the pointer glides there: then no click.
        go();
        const at = [String(p.app ?? ""), String(x), String(y)];
        // Pressed through accessibility when it can (the owner's pointer stays where it is); else a real click that
        // puts their pointer straight back.
        const done = await osa(AX_PRESS, at, "JavaScript").catch((e: unknown) => `none: ${errorText(e)}`);
        let how = done;
        if (done.startsWith("none")) {
          await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
          await osa(CLICK, at, "JavaScript");
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
        const typed = await osa(AX_TYPE, [String(p.app ?? ""), String(p.text ?? "")], "JavaScript");
        if (typed !== "typed") {
          await osa(ACTIVATE, [String(p.app ?? "")]).catch(() => {});
          await osa(TYPE, [String(p.app ?? ""), String(p.text ?? "")], "JavaScript");
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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
