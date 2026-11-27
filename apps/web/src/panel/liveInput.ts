// The owner's hand on a server tab, as the panel sends it: where on the page a point falls, which keys go as keys
// (the rest arrive as typed text), and a queue that keeps their order while folding moves and wheel turns together.
import type { LiveInput } from "@apx/protocol";

type Box = { left: number; top: number; width: number; height: number };

/**
 * Where a point of the screen falls on the page shown in `box` (scaled to fit, centred across, from the top), as
 * fractions 0–1; undefined outside the picture.
 */
export function pageAt(
  box: Box,
  natural: { width: number; height: number },
  client: { x: number; y: number },
): { x: number; y: number } | undefined {
  if (!natural.width || !natural.height || !box.width || !box.height) return undefined;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const w = natural.width * scale;
  const h = natural.height * scale;
  const x = (client.x - box.left - (box.width - w) / 2) / w;
  const y = (client.y - box.top) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

/** Alt 1, Ctrl 2, Meta 4, Shift 8: how the page's browser counts them. */
export function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const KEYS = new Set([
  "Enter",
  "Backspace",
  "Tab",
  "Escape",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

/**
 * Whether a key goes to the page as a key: editing and moving keys, and shortcuts. Plain characters arrive as typed
 * text instead (which carries accents and IME input), and paste brings the owner's own clipboard.
 */
export function sendsAsKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (KEYS.has(e.key)) return true;
  const command = e.ctrlKey || e.metaKey;
  return command && e.key.length === 1 && e.key.toLowerCase() !== "v";
}

const BUTTONS = ["left", "middle", "right"] as const;
export const buttonOf = (button: number) => BUTTONS[button] ?? "left";

/**
 * Sends the owner's events in order, one call at a time. While a call is out, moves fold into the latest and wheel
 * turns add up, so a slow link gets fewer, larger steps instead of a growing backlog.
 */
export function inputQueue(send: (events: LiveInput[]) => Promise<unknown>, max = 50) {
  let pending: LiveInput[] = [];
  let busy = false;
  const flush = async () => {
    if (busy || !pending.length) return;
    busy = true;
    const batch = pending.slice(0, max);
    pending = pending.slice(max);
    try {
      await send(batch);
    } catch {
      // The owner lost the tab (an agent took it back, it closed): what they did meanwhile does not apply.
      pending = [];
    }
    busy = false;
    void flush();
  };
  return {
    push(e: LiveInput) {
      const last = pending.at(-1);
      if (e.type === "mouse" && e.action === "move" && last?.type === "mouse" && last.action === "move")
        pending[pending.length - 1] = e;
      else if (e.type === "wheel" && last?.type === "wheel")
        pending[pending.length - 1] = { ...e, dx: clamp(last.dx + e.dx), dy: clamp(last.dy + e.dy) };
      else pending.push(e);
      void flush();
    },
    clear() {
      pending = [];
    },
  };
}

const clamp = (n: number) => Math.max(-5000, Math.min(5000, n));
