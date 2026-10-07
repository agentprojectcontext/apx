// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences start with ESC
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[=>]/g;

/** A terminal's output without its escape codes (colors, cursor moves). */
export const plain = (s: string) => s.replace(ESCAPES, "");

/** What a terminal's output reads as on screen: no escapes, and a carriage return overwrites its line (progress bars). */
export function screenText(raw: string): string {
  return plain(raw)
    .replace(/\r+\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
}

/** The output ends on a prompt for a secret (sudo's "Password:"), which only the owner can type. */
export const asksSecret = (screen: string) => /(password|passphrase|contraseña|clave)[^\n]*:\s*$/i.test(screen);
