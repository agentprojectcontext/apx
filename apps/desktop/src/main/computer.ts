// Computer use on macOS, lent to the core as the "computer" capability only when the owner turned it on for this
// computer (APX_COMPUTER_USE=1 while it is a spike). A picture of the screen comes from Electron; the app in front,
// its window's elements, a click and typing go through System Events, which needs the Accessibility permission.
// Values reach AppleScript as arguments, never inside the script's text.
import { execFile } from "node:child_process";
import { desktopCapturer, screen } from "electron";

const OSA_MS = 15_000;
/** The longest side of the screen picture sent to the core. */
const SHOT_MAX = 1600;

export const computerUseOn = () => process.platform === "darwin" && process.env.APX_COMPUTER_USE === "1";

function osa(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script, ...args], { timeout: OSA_MS, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      err ? reject(new Error(String(err.message).slice(0, 300))) : resolve(out.trimEnd()),
    );
  });
}

/** The window in front and its useful elements, one per line: role, name, description, value, center x,y. */
const ELEMENTS = `
on run argv
  tell application "System Events"
    set p to first application process whose frontmost is true
    set out to (name of p) & linefeed
    try
      set w to front window of p
      set out to out & (name of w) & linefeed
      set wanted to {"AXButton", "AXCheckBox", "AXRadioButton", "AXTextField", "AXTextArea", "AXPopUpButton", "AXMenuButton", "AXSlider", "AXSwitch", "AXStaticText", "AXLink", "AXTab", "AXRow"}
      set n to 0
      repeat with e in (entire contents of w)
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

async function snapshot() {
  const d = screen.getPrimaryDisplay();
  const scale = Math.min(1, SHOT_MAX / Math.max(d.size.width, d.size.height));
  const [src] = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) },
  });
  if (!src || src.thumbnail.isEmpty())
    throw new Error("no picture of the screen: allow Screen Recording for APX in System Settings › Privacy");
  const [app = "", window = "", ...lines] = (await osa(ELEMENTS)).split("\n");
  const header = `screen ${d.size.width}x${d.size.height} points; positions are centers to click\nrole\tname\tdescription\tvalue\tx,y`;
  return {
    mime: "image/jpeg",
    data: src.thumbnail.toJPEG(70).toString("base64"),
    app,
    window,
    elements: [header, ...lines].join("\n"),
  };
}

/** Answers the core's computer.* calls; anything else is not this module's. */
export async function handleComputer(method: string, params: unknown): Promise<unknown> {
  const p = (params ?? {}) as { x?: number; y?: number; app?: string; text?: string };
  if (method === "computer.snapshot") return snapshot();
  if (method === "computer.click") {
    const app = await osa(CLICK, [String(p.app ?? ""), String(p.x ?? -1), String(p.y ?? -1)]);
    return { app };
  }
  if (method === "computer.type") {
    const app = await osa(TYPE, [String(p.app ?? ""), String(p.text ?? "")]);
    return { app };
  }
  throw new Error(`unknown method ${method}`);
}
