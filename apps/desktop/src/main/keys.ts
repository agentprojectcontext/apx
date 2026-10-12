// Keys an agent may press on the owner's computer, posted as real keyboard events like a person pressing them: macOS
// virtual key codes (ANSI layout) and modifier flags, or Windows virtual-key codes, where cmd means ctrl.

const NAMED: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  esc: 53,
  escape: 53,
  space: 49,
  delete: 51,
  backspace: 51,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  pageup: 116,
  pagedown: 121,
  home: 115,
  end: 119,
};
// The keys' positions on an ANSI keyboard: shortcuts are pressed by position, as macOS reads them.
const CHARS: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  "`": 50,
};
/** CGEventFlags for each modifier. */
const FLAGS: Record<string, number> = { cmd: 0x100000, shift: 0x20000, option: 0x80000, ctrl: 0x40000 };

/** Shortcuts that close or quit things: an agent never presses them. */
export const REFUSED_KEYS = new Set([
  "cmd+q",
  "cmd+w",
  "cmd+shift+q",
  "cmd+option+esc",
  "cmd+option+escape",
  "cmd+shift+w",
]);

const splitKeys = (keys: string) =>
  keys
    .toLowerCase()
    .replaceAll("command", "cmd")
    .replaceAll("control", "ctrl")
    .replaceAll("alt", "option")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);

/** "cmd+shift+t" → its key code and modifier flags; undefined for something it cannot press. */
export function parseKeys(keys: string): { code: number; flags: number } | undefined {
  const parts = splitKeys(keys);
  const key = parts.pop();
  if (!key || parts.some((m) => FLAGS[m] === undefined)) return undefined;
  const code = NAMED[key] ?? CHARS[key];
  if (code === undefined) return undefined;
  return { code, flags: parts.reduce((f, m) => f | (FLAGS[m] ?? 0), 0) };
}

const WIN_NAMED: Record<string, number> = {
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  space: 0x20,
  delete: 0x08,
  backspace: 0x08,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  pageup: 0x21,
  pagedown: 0x22,
  home: 0x24,
  end: 0x23,
};
/** Punctuation by its US-layout key (VK_OEM_*); letters and digits are their own codes. */
const WIN_CHARS: Record<string, number> = {
  "=": 0xbb,
  "-": 0xbd,
  ",": 0xbc,
  ".": 0xbe,
  "/": 0xbf,
  ";": 0xba,
  "'": 0xde,
  "[": 0xdb,
  "]": 0xdd,
  "\\": 0xdc,
  "`": 0xc0,
};
/** Modifiers' virtual keys; cmd is the Mac name for what ctrl does in Windows shortcuts. */
const WIN_MODS: Record<string, number> = { cmd: 0x11, ctrl: 0x11, shift: 0x10, option: 0x12 };
/** Keys Windows sends as extended (the arrows and the navigation block): without the flag some apps read the keypad. */
const WIN_EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28]);

/** "cmd+l" on Windows → ctrl's and L's virtual keys; undefined for something it cannot press. */
export function parseWinKeys(keys: string): { vk: number; mods: number[]; extended: boolean } | undefined {
  const parts = splitKeys(keys);
  const key = parts.pop();
  if (!key || parts.some((m) => WIN_MODS[m] === undefined)) return undefined;
  const vk = WIN_NAMED[key] ?? WIN_CHARS[key] ?? (/^[a-z0-9]$/.test(key) ? key.toUpperCase().charCodeAt(0) : undefined);
  if (vk === undefined) return undefined;
  const mods = [...new Set(parts.map((m) => WIN_MODS[m] as number))];
  return { vk, mods, extended: WIN_EXTENDED.has(vk) };
}

/** Windows' shortcuts that close or quit things, in either name for ctrl. */
const WIN_REFUSED = new Set([
  "ctrl+w",
  "ctrl+q",
  "ctrl+shift+w",
  "ctrl+shift+q",
  "ctrl+f4",
  "option+f4",
  "ctrl+shift+esc",
]);

/** Whether `keys` closes or quits something on this platform: an agent never presses those. */
export function refusedKeys(keys: string, platform: string): boolean {
  const k = keys.toLowerCase().replace(/\s+/g, "");
  if (platform !== "win32") return REFUSED_KEYS.has(k);
  const norm = splitKeys(k)
    .map((m) => (m === "cmd" ? "ctrl" : m === "escape" ? "esc" : m))
    .join("+");
  return WIN_REFUSED.has(norm);
}
