// Computer use on macOS: the app in front, its window's elements, a click and typing go through System Events and
// accessibility (the Accessibility permission). Values reach AppleScript as arguments, never inside its text.
import { execFile } from "node:child_process";
import type { Bounds, ComputerDriver, Front } from "./computer-driver.ts";
import { parseKeys } from "./keys.ts";

const OSA_MS = 15_000;
/** Reading every element of a window, within the core's deadline for a look (the picture still has to follow). */
const ELEMENTS_MS = 4_000;
/**
 * A real click waits for the owner's mouse to rest this long, and gives up after the wait: long enough for them to
 * approve the click and let go (inside CLICK_MS, itself inside the core's deadline for a click).
 */
const MOUSE_IDLE_S = 0.5;
const MOUSE_WAIT_MS = 20_000;
const CLICK_MS = 25_000;

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
 * to where the owner had it. It waits for a pause in the owner's mouse first, since a click mixed with their movement
 * is lost. Refused if another app's window covers the point. argv = app, x, y.
 */
const CLICK = `
function idle() {
  let least = 1e9;
  for (const t of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDragged, $.kCGEventRightMouseDragged, $.kCGEventLeftMouseDown, $.kCGEventRightMouseDown, $.kCGEventScrollWheel])
    least = Math.min(least, $.CGEventSourceSecondsSinceLastEventType($.kCGEventSourceStateHIDSystemState, t));
  return least;
}
function run(argv) {
  ObjC.import("CoreGraphics");
  ObjC.import("Foundation");
  const until = Date.now() + ${MOUSE_WAIT_MS};
  while (idle() < ${MOUSE_IDLE_S}) {
    if (Date.now() > until) throw new Error("the owner kept using their mouse for ${MOUSE_WAIT_MS / 1000} seconds, so nothing was clicked: ask them to leave it still for a moment, then try again");
    delay(0.1);
  }
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

async function front(withElements: boolean): Promise<Front> {
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

export const macDriver: ComputerDriver = {
  front,
  activate: (app) => osa(ACTIVATE, [app]).then(() => {}),
  async topAt(x, y) {
    const [pid, name = ""] = (await osa(TOP_AT, [String(Math.round(x)), String(Math.round(y))], "JavaScript")).split(
      "\t",
    );
    return pid ? { pid: Number(pid), name } : undefined;
  },
  open: (app, url) => {
    const args = app ? ["-a", app, ...(url ? [url] : [])] : [String(url)];
    return new Promise<void>((resolve, reject) =>
      execFile("open", args, { timeout: OSA_MS }, (err) => (err ? reject(new Error("could not open it")) : resolve())),
    );
  },
  canPress: (keys) => parseKeys(keys) !== undefined,
  key(app, keys) {
    const k = parseKeys(keys);
    if (!k) throw new Error(`cannot press "${keys}"`);
    return osa(KEY, [app, String(k.code), String(k.flags)], "JavaScript");
  },
  press: (app, x, y) => osa(AX_PRESS, [app, String(x), String(y)], "JavaScript"),
  click: (app, x, y) => osa(CLICK, [app, String(x), String(y)], "JavaScript", CLICK_MS).then(() => {}),
  insert: (app, text) => osa(AX_TYPE, [app, text], "JavaScript").then((r) => r === "typed"),
  paste: (app, text) => osa(TYPE, [app, text], "JavaScript").then(() => {}),
};
