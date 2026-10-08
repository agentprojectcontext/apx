// Keys an agent may press on the owner's computer, as macOS key codes or characters with their modifiers.

const KEY_CODES: Record<string, number> = {
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
/** Shortcuts that close or quit things: an agent never presses them. */
export const REFUSED_KEYS = new Set([
  "cmd+q",
  "cmd+w",
  "cmd+shift+q",
  "cmd+option+esc",
  "cmd+option+escape",
  "cmd+shift+w",
]);

/** "cmd+shift+t" → what KEY needs; undefined for something it cannot press. */
export function parseKeys(keys: string): { kind: "code" | "text"; key: string; mods: string } | undefined {
  const parts = keys
    .toLowerCase()
    .replaceAll("command", "cmd")
    .replaceAll("control", "ctrl")
    .replaceAll("alt", "option")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key || parts.some((m) => !["cmd", "shift", "option", "ctrl"].includes(m))) return undefined;
  const mods = parts.join(" ");
  if (KEY_CODES[key] !== undefined) return { kind: "code", key: String(KEY_CODES[key]), mods };
  return key.length === 1 ? { kind: "text", key, mods } : undefined;
}
