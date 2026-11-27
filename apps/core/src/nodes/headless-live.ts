// The owner watching and driving a tab of the core's own browser: a screencast the panel pulls one frame at a time,
// and their pointer, wheel and keys dispatched to the page as input. Frames run only while someone asks for them.
import type { LiveInput } from "@apx/protocol";

type Send = <T>(method: string, params?: object) => Promise<T>;

/** No frame asked for this long: the screencast stops. */
const IDLE_MS = 8_000;
/** Frames are acknowledged at most this often (about 12 a second), which is what paces Chrome. */
const MIN_FRAME_MS = 80;
/** The first picture, taken as the screencast starts; a page that paints nothing gives up after this. */
const STILL_MS = 3_000;
const QUALITY = 60;

export type LiveFrame = { seq: number; data?: string; width: number; height: number };
type Frame = Required<LiveFrame>;
type Timers = {
  set(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(t: ReturnType<typeof setTimeout>): void;
  now(): number;
};
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t), now: Date.now };

export function createLiveTab(
  send: Send,
  opts: { commandModifier: number; timers?: Timers; activate?: () => Promise<unknown> },
) {
  const timers = opts.timers ?? realTimers;
  let latest: Frame | undefined;
  let seq = 0;
  let width = 0;
  let casting: { maxWidth: number } | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let lastAck = Number.NEGATIVE_INFINITY;
  let pressed = 0;
  const waiters = new Set<() => void>();

  const publish = (frame: Omit<Frame, "seq">) => {
    latest = { ...frame, seq: ++seq };
    for (const w of [...waiters]) w();
  };
  const stopCast = () => {
    if (idle) timers.clear(idle);
    idle = undefined;
    if (!casting) return;
    casting = undefined;
    void send("Page.stopScreencast").catch(() => {});
  };
  /** The page's visible size in CSS pixels: what fractions of the frame map onto. */
  const viewport = async (): Promise<{ width: number; height: number }> => {
    if (latest) return latest;
    const m = await send<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>(
      "Page.getLayoutMetrics",
    );
    return { width: m.cssVisualViewport?.clientWidth ?? 1280, height: m.cssVisualViewport?.clientHeight ?? 900 };
  };
  const still = async () => {
    const size = await viewport();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shot = await Promise.race([
      send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: QUALITY }),
      new Promise<undefined>((resolve) => {
        timer = timers.set(() => resolve(undefined), STILL_MS);
      }),
    ]).finally(() => timer && timers.clear(timer));
    if (shot) publish({ data: shot.data, ...size });
  };
  const start = async (maxWidth: number) => {
    if (casting && maxWidth <= casting.maxWidth * 1.2) return;
    const fresh = !casting;
    if (casting) await send("Page.stopScreencast").catch(() => {});
    casting = { maxWidth };
    width = maxWidth;
    if (fresh) {
      // A tab in the background paints nothing: the one watched becomes the active one, and a picture taken right away
      // both shows it at once and gets Chrome painting the screencast's frames (macOS sends none without it).
      await (opts.activate?.() ?? send("Page.bringToFront")).catch(() => {});
      await still().catch(() => {});
    }
    await send("Page.startScreencast", {
      format: "jpeg",
      quality: QUALITY,
      maxWidth,
      maxHeight: maxWidth * 2,
      everyNthFrame: 1,
    });
  };
  const wait = (ms: number, after: number) =>
    new Promise<void>((resolve) => {
      if (latest && latest.seq > after) return resolve();
      const done = () => {
        timers.clear(timer);
        waiters.delete(done);
        resolve();
      };
      const timer = timers.set(done, ms);
      waiters.add(done);
    });
  const point = async (x: number, y: number) => {
    const v = await viewport();
    return { x: Math.round(x * v.width), y: Math.round(y * v.height) };
  };
  const mods = (m: number) => (m & 4 && opts.commandModifier !== 4 ? (m & ~4) | opts.commandModifier : m);

  return {
    /** A frame Chrome painted; acknowledging it is what lets the next one come. */
    onFrame(params: unknown): void {
      const p = params as {
        data: string;
        sessionId: number;
        metadata?: { deviceWidth?: number; deviceHeight?: number };
      };
      publish({ data: p.data, width: p.metadata?.deviceWidth ?? width, height: p.metadata?.deviceHeight ?? 0 });
      const ack = () => {
        lastAck = timers.now();
        if (casting) void send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      };
      const due = MIN_FRAME_MS - (timers.now() - lastAck);
      if (due > 0) timers.set(ack, due);
      else ack();
    },
    /** The next frame after `after` (or, once `waitMs` passes, the same seq again without its picture). */
    async frame(after: number, maxWidth: number, waitMs: number): Promise<LiveFrame> {
      if (idle) timers.clear(idle);
      idle = timers.set(stopCast, IDLE_MS);
      await start(maxWidth);
      await wait(waitMs, after);
      // Still nothing painted (a busy machine): the picture is tried again, which also gets the frames going.
      if (!latest) await still().catch(() => {});
      if (!latest) return { seq: 0, ...(await viewport()) };
      if (latest.seq > after) return latest;
      return { seq: latest.seq, width: latest.width, height: latest.height };
    },
    /** The owner's events, in order. Coordinates are fractions of the visible page. */
    async input(events: readonly LiveInput[]): Promise<void> {
      for (const e of events) {
        if (e.type === "text") {
          await send("Input.insertText", { text: e.text });
          continue;
        }
        if (e.type === "key") {
          await send("Input.dispatchKeyEvent", keyEvent(e, mods(e.modifiers)));
          continue;
        }
        const at = await point(e.x, e.y);
        if (e.type === "wheel") {
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            ...at,
            deltaX: e.dx,
            deltaY: e.dy,
            modifiers: mods(e.modifiers),
          });
          continue;
        }
        const bit = BUTTON_BITS[e.button];
        if (e.action === "down") pressed |= bit;
        if (e.action === "up") pressed &= ~bit;
        await send("Input.dispatchMouseEvent", {
          type: e.action === "down" ? "mousePressed" : e.action === "up" ? "mouseReleased" : "mouseMoved",
          ...at,
          button: e.action === "move" ? buttonOf(pressed) : e.button,
          buttons: pressed,
          clickCount: e.action === "move" ? 0 : e.clicks,
          modifiers: mods(e.modifiers),
        });
      }
    },
    stop(): void {
      stopCast();
      for (const w of [...waiters]) w();
    },
  };
}

export type LiveTab = ReturnType<typeof createLiveTab>;

const BUTTON_BITS = { none: 0, left: 1, right: 2, middle: 4 } as const;
const buttonOf = (bits: number) => (bits & 1 ? "left" : bits & 2 ? "right" : bits & 4 ? "middle" : "none");

/** Windows virtual key codes Chrome needs to act on a key that types nothing (Backspace, arrows, Enter…). */
const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  Meta: 91,
};

export function virtualKey(key: string, code: string): number {
  const fixed = VIRTUAL_KEYS[key];
  if (fixed) return fixed;
  const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? (/^[a-z]$/i.test(key) ? key.toUpperCase() : undefined);
  if (letter) return letter.charCodeAt(0);
  const digit = /^Digit(\d)$/.exec(code)?.[1] ?? (/^\d$/.test(key) ? key : undefined);
  if (digit) return 48 + Number(digit);
  const f = /^F(\d{1,2})$/.exec(key)?.[1];
  return f && Number(f) <= 12 ? 111 + Number(f) : 0;
}

/** A key as CDP takes it: printable keys and Enter type their text; the rest are raw. Ctrl or Meta types nothing. */
export function keyEvent(e: Extract<LiveInput, { type: "key" }>, modifiers: number) {
  const command = (modifiers & (2 | 4)) !== 0;
  const text = command ? undefined : e.key === "Enter" ? "\r" : e.key.length === 1 ? e.key : undefined;
  return {
    type: e.action === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown",
    key: e.key,
    code: e.code,
    windowsVirtualKeyCode: virtualKey(e.key, e.code),
    modifiers,
    ...(e.action === "down" && text ? { text, unmodifiedText: text } : {}),
  };
}
