// Computer use on macOS, lent to the core as the "computer" capability once the owner turns it on (Config › Desktop).
// Every look starts by finding the window in front, on whichever screen it is, and pictures that window alone. The app
// in front, its window's elements, a click and typing go through System Events (the Accessibility permission); the
// picture comes from Electron (Screen Recording). Values reach AppleScript as arguments, never inside its text.
import { execFile } from "node:child_process";
import { desktopCapturer, type NativeImage, screen, shell, systemPreferences } from "electron";
import type { AgentCursor } from "./cursor.ts";

const OSA_MS = 15_000;
/** The longest side of the picture sent to the core, and of a live frame for the panel. */
const SHOT_MAX = 1600;
const FRAME_MAX = 900;

type Bounds = { x: number; y: number; width: number; height: number };
type Target = { app: string; window: string; bounds: Bounds | undefined };
export type ComputerActivity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };

function osa(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script, ...args], { timeout: OSA_MS, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      err ? reject(new Error(String(err.message).slice(0, 300))) : resolve(out.trimEnd()),
    );
  });
}

const ACTIVATE = `
on run argv
  tell application (item 1 of argv) to activate
  delay 0.4
  try
    tell application "System Events" to tell process (item 1 of argv) to perform action "AXRaise" of window 1
  end try
  delay 0.4
end run`;

/** The app in front, its front window's name and bounds, then its useful elements: role, name, description, value, x,y. */
const LOOK = `
on run argv
  set withElements to (item 1 of argv) is "1"
  tell application "System Events"
    set p to first application process whose frontmost is true
    set out to (name of p) & linefeed
    try
      set w to front window of p
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

const CLICK = `
on run argv
  tell application "System Events"
    set frontName to name of first application process whose frontmost is true
    if frontName is not (item 1 of argv) then error "the app in front is " & frontName & ", not " & (item 1 of argv)
    tell process frontName to click at {(item 2 of argv) as integer, (item 3 of argv) as integer}
    return frontName
  end tell
end run`;

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

const parseBounds = (line: string | undefined): Bounds | undefined => {
  const [x, y, width, height] = (line ?? "").split(",").map(Number);
  return [x, y, width, height].every((n) => Number.isFinite(n)) && (width ?? 0) > 0 && (height ?? 0) > 0
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : undefined;
};

/** The window in front, wherever it is: its app, name and bounds, and (when asked) its elements. */
async function front(withElements: boolean): Promise<Target & { lines: string[] }> {
  const [app = "", window = "", bounds, ...lines] = (await osa(LOOK, [withElements ? "1" : "0"])).split("\n");
  // AppleScript says "missing value" for an attribute an element does not have.
  const clean = lines.filter(Boolean).map((l) => l.replaceAll("missing value", ""));
  return { app, window, bounds: parseBounds(bounds), lines: clean };
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

export function createComputer(o: { cursor: AgentCursor; onActivity(a: ComputerActivity): void }) {
  /** The window an agent is working on: what the panel's live view follows. */
  let target: Target | undefined;

  async function look(app?: string) {
    if (app) await osa(ACTIVATE, [app]).catch(() => {});
    const f = await front(true);
    target = { app: f.app, window: f.window, bounds: f.bounds };
    const img = await picture(f.bounds, SHOT_MAX);
    const where = f.bounds
      ? `window at ${f.bounds.x},${f.bounds.y}, ${f.bounds.width}x${f.bounds.height} points`
      : "the main screen";
    const header = `${where}; positions are screen points, centers to click\nrole\tname\tdescription\tvalue\tx,y`;
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
      const p = (params ?? {}) as { x?: number; y?: number; app?: string; text?: string };
      if (method === "computer.snapshot") return look(p.app);
      if (method === "computer.click") {
        const x = Number(p.x);
        const y = Number(p.y);
        // The owner sees where it is about to click before it does.
        await o.cursor.moveTo(x, y, p.app ?? "");
        const app = await osa(CLICK, [String(p.app ?? ""), String(x), String(y)]);
        o.cursor.pulse();
        o.onActivity({ kind: "click", app, window: target?.window ?? "", x, y });
        return { app };
      }
      if (method === "computer.type") {
        o.cursor.label("⌨");
        const app = await osa(TYPE, [String(p.app ?? ""), String(p.text ?? "")]);
        o.onActivity({ kind: "type", app, window: target?.window ?? "" });
        return { app };
      }
      throw new Error(`unknown method ${method}`);
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
