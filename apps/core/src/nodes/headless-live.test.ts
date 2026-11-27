import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveTab, keyEvent, virtualKey } from "./headless-live.ts";

/** Timers a test runs by hand: nothing here waits on the clock. */
function manualTimers() {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        due.set(++id, { at: now + ms, fn });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clear: (t: ReturnType<typeof setTimeout>) => void due.delete(t as unknown as number),
      now: () => now,
    },
    advance(ms: number) {
      now += ms;
      for (const [k, t] of [...due].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now && due.delete(k)) t.fn();
    },
  };
}

function fakePage() {
  const sent: Array<{ method: string; params?: object }> = [];
  const send = async <T>(method: string, params?: object): Promise<T> => {
    sent.push({ method, ...(params ? { params } : {}) });
    if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } } as T;
    if (method === "Page.captureScreenshot") return { data: "still" } as T;
    return {} as T;
  };
  return { sent, send, methods: () => sent.map((s) => s.method) };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("frames come only while the owner asks for them, paced by acknowledgements", async () => {
  const clock = manualTimers();
  const page = fakePage();
  const live = createLiveTab(page.send, { commandModifier: 2, timers: clock.timers });
  // A picture first, at once: the page shows before anything on it moves.
  assert.deepEqual(await live.frame(0, 800, 5000), { seq: 1, data: "still", width: 1000, height: 500 });
  assert.ok(page.methods().indexOf("Page.captureScreenshot") < page.methods().indexOf("Page.startScreencast"));
  const first = live.frame(1, 800, 5000);
  await settle();
  live.onFrame({ data: "a", sessionId: 1, metadata: { deviceWidth: 1280, deviceHeight: 900 } });
  assert.deepEqual(await first, { seq: 2, data: "a", width: 1280, height: 900 });
  // The first frame is acknowledged at once; the next one waits its turn (about 12 a second).
  assert.equal(page.methods().filter((m) => m === "Page.screencastFrameAck").length, 1);
  live.onFrame({ data: "b", sessionId: 2, metadata: { deviceWidth: 1280, deviceHeight: 900 } });
  assert.equal(page.methods().filter((m) => m === "Page.screencastFrameAck").length, 1);
  clock.advance(80);
  assert.equal(page.methods().filter((m) => m === "Page.screencastFrameAck").length, 2);

  // Nothing new before the wait ends: the same seq again, without the picture.
  const same = live.frame(3, 800, 5000);
  await settle();
  clock.advance(5000);
  assert.deepEqual(await same, { seq: 3, width: 1280, height: 900 });
  // Nobody asks any more: the screencast stops.
  clock.advance(8000);
  assert.ok(page.methods().includes("Page.stopScreencast"));
});

test("a page that never paints does not hold the owner's view: the first picture gives up and frames still start", async () => {
  const clock = manualTimers();
  const page = fakePage();
  const send = async <T>(method: string, params?: object): Promise<T> =>
    method === "Page.captureScreenshot" ? new Promise<T>(() => {}) : page.send<T>(method, params);
  const live = createLiveTab(send, { commandModifier: 2, timers: clock.timers });
  const first = live.frame(0, 800, 5000);
  await settle();
  clock.advance(3000);
  await settle();
  assert.ok(page.methods().includes("Page.startScreencast"));
  live.onFrame({ data: "a", sessionId: 1, metadata: { deviceWidth: 1280, deviceHeight: 900 } });
  assert.deepEqual(await first, { seq: 1, data: "a", width: 1280, height: 900 });
  live.stop();
});

test("the owner's pointer lands where they point on the page, and their keys type", async () => {
  const page = fakePage();
  const live = createLiveTab(page.send, { commandModifier: 2 });
  await live.input([
    { type: "mouse", action: "down", x: 0.5, y: 0.2, button: "left", clicks: 1, modifiers: 0 },
    { type: "mouse", action: "move", x: 0.6, y: 0.2, button: "left", clicks: 1, modifiers: 0 },
    { type: "mouse", action: "up", x: 0.6, y: 0.2, button: "left", clicks: 1, modifiers: 0 },
    { type: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 120, modifiers: 0 },
    { type: "text", text: "ada" },
    { type: "key", action: "down", key: "a", code: "KeyA", modifiers: 4 },
  ]);
  const mouse = page.sent.filter((s) => s.method === "Input.dispatchMouseEvent").map((s) => s.params);
  assert.deepEqual(mouse[0], {
    type: "mousePressed",
    x: 500,
    y: 100,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: 0,
  });
  // Dragging keeps the button down until it is released.
  assert.equal((mouse[1] as { buttons: number }).buttons, 1);
  assert.equal((mouse[2] as { buttons: number }).buttons, 0);
  assert.equal((mouse[3] as { type: string }).type, "mouseWheel");
  assert.deepEqual(page.sent.find((s) => s.method === "Input.insertText")?.params, { text: "ada" });
  // Cmd+A from a Mac panel selects all on a Linux server's Chrome (Ctrl), and types nothing.
  const key = page.sent.find((s) => s.method === "Input.dispatchKeyEvent")?.params as Record<string, unknown>;
  assert.equal(key.modifiers, 2);
  assert.equal(key.type, "rawKeyDown");
  assert.equal(key.text, undefined);
});

test("keys Chrome acts on carry their virtual codes; printable ones and Enter type their text", () => {
  assert.equal(virtualKey("Backspace", "Backspace"), 8);
  assert.equal(virtualKey("ñ", ""), 0);
  assert.equal(virtualKey("q", "KeyQ"), 81);
  assert.equal(virtualKey("7", "Digit7"), 55);
  assert.equal(virtualKey("F5", "F5"), 116);
  assert.deepEqual(keyEvent({ type: "key", action: "down", key: "Enter", code: "Enter", modifiers: 0 }, 0), {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 0,
    text: "\r",
    unmodifiedText: "\r",
  });
  assert.equal(
    keyEvent({ type: "key", action: "down", key: "ArrowLeft", code: "", modifiers: 0 }, 0).type,
    "rawKeyDown",
  );
  assert.equal(keyEvent({ type: "key", action: "up", key: "x", code: "KeyX", modifiers: 0 }, 0).type, "keyUp");
});
