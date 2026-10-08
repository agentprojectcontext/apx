// Keys an agent may press on the owner's computer: macOS virtual key codes (ANSI layout) and modifier flags, posted as
// real keyboard events (CoreGraphics), like a person pressing them.

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

/** "cmd+shift+t" → its key code and modifier flags; undefined for something it cannot press. */
export function parseKeys(keys: string): { code: number; flags: number } | undefined {
  const parts = keys
    .toLowerCase()
    .replaceAll("command", "cmd")
    .replaceAll("control", "ctrl")
    .replaceAll("alt", "option")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key || parts.some((m) => FLAGS[m] === undefined)) return undefined;
  const code = NAMED[key] ?? CHARS[key];
  if (code === undefined) return undefined;
  return { code, flags: parts.reduce((f, m) => f | (FLAGS[m] ?? 0), 0) };
}
