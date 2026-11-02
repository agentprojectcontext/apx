import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const electronURL = `data:text/javascript,${encodeURIComponent(`
export const windows = [];
export class BrowserWindow {
  destroyed = false;
  shown = 0;
  hidden = 0;
  scripts = [];
  constructor() {
    windows.push(this);
    this.loaded = new Promise((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
  }
  check() { if (this.destroyed) throw new TypeError('Object has been destroyed'); }
  isDestroyed() { return this.destroyed; }
  setIgnoreMouseEvents() { this.check(); }
  setAlwaysOnTop() { this.check(); }
  setBounds() { this.check(); }
  setVisibleOnAllWorkspaces() { this.check(); }
  setContentProtection() { this.check(); }
  loadURL() { return this.loaded; }
  showInactive() { this.check(); this.shown++; }
  getBounds() { this.check(); return { x: 0, y: 0 }; }
  hide() { this.check(); this.hidden++; }
  destroy() { this.check(); this.destroyed = true; }
  webContents = { executeJavaScript: async (script) => {
    this.check(); this.scripts.push(script);
  } };
}
const display = { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } };
export const screen = { getDisplayNearestPoint: () => display, getPrimaryDisplay: () => display };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: electronURL, shortCircuit: true };
    return next(specifier, context);
  },
});
const { createCursor } = await import("./cursor-electron.ts");
hooks.deregister();
const { windows } = (await import(electronURL)) as {
  windows: {
    destroyed: boolean;
    shown: number;
    hidden: number;
    scripts: string[];
    finish(): void;
    fail(error: Error): void;
    destroy(): void;
  }[];
};
function latestWindow() {
  const window = windows.at(-1);
  assert.ok(window);
  return window;
}

test("disconnect can hide and close an already destroyed cursor", async () => {
  const cursor = createCursor();
  const moving = cursor.moveTo(20, 30, "Test");
  const window = latestWindow();
  window.destroy();
  assert.doesNotThrow(() => cursor.hide());
  assert.doesNotThrow(() => cursor.pulse());
  assert.doesNotThrow(() => cursor.close());
  assert.doesNotThrow(() => cursor.close());
  window.finish();
  await moving;
  assert.equal(window.shown, 0);
});

test("stop while the cursor page loads prevents a late overlay", async () => {
  const cursor = createCursor();
  const moving = cursor.moveTo(20, 30, "Test");
  const window = latestWindow();
  cursor.hide();
  window.finish();
  await moving;
  assert.equal(window.shown, 0);
  assert.deepEqual(window.scripts, []);
  assert.equal(window.hidden, 1);
  cursor.close();
});

test("close during page load tolerates load rejection and prevents recreation", async () => {
  const cursor = createCursor();
  const moving = cursor.moveTo(20, 30, "Test");
  const window = latestWindow();
  const count = windows.length;
  cursor.close();
  window.fail(new Error("Window closed"));
  await moving;
  await cursor.moveTo(30, 40, "After close");
  cursor.say("After close");
  cursor.pulse();
  assert.equal(windows.length, count);
  assert.equal(window.shown, 0);
  assert.deepEqual(window.scripts, []);
});

test("overlapping cursor requests wait for the page and only the latest destination is shown", async () => {
  const cursor = createCursor();
  const first = cursor.moveTo(20, 30, "Earlier look");
  const window = latestWindow();
  const second = cursor.moveTo(240, 180, "Click target");
  assert.equal(window.shown, 0);
  assert.deepEqual(window.scripts, []);
  window.finish();
  await Promise.all([first, second]);
  assert.equal(window.shown, 1);
  assert.equal(window.scripts.length, 1);
  assert.match(window.scripts[0] ?? "", /moveTo\(240,180,"Click target"\)/);
  cursor.close();
});

test("an active cursor still reports a genuine page load error", async () => {
  const cursor = createCursor();
  const moving = cursor.moveTo(20, 30, "Test");
  const rejected = assert.rejects(moving, /Page failed/);
  const failed = latestWindow();
  failed.fail(new Error("Page failed"));
  await rejected;
  assert.equal(failed.destroyed, true);
  const retry = cursor.moveTo(40, 50, "Retry");
  const replacement = latestWindow();
  assert.notEqual(replacement, failed);
  replacement.finish();
  await retry;
  assert.equal(replacement.shown, 1);
  assert.equal(replacement.scripts.length, 1);
  assert.match(replacement.scripts[0] ?? "", /moveTo\(40,50,"Retry"\)/);
  cursor.close();
});
