import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { test } from "node:test";

class Contents {
  loaded: string[] = [];
  closed = false;
  loadURL(url: string) {
    this.loaded.push(url);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  getOSProcessId() {
    return 42;
  }
}
class View {
  webContents = new Contents();
  bounds: unknown;
  setBounds(bounds: unknown) {
    this.bounds = bounds;
  }
}
const windows: Window[] = [];
class Window extends EventEmitter {
  shown = 0;
  focused = 0;
  title = "";
  bounds = { width: 1100, height: 820 };
  contentView = {
    children: [] as View[],
    addChildView: (view: View) => this.contentView.children.push(view),
    removeChildView: (view: View) => {
      this.contentView.children = this.contentView.children.filter((item) => item !== view);
    },
  };
  constructor() {
    super();
    windows.push(this);
  }
  getContentBounds() {
    return this.bounds;
  }
  show() {
    this.shown++;
  }
  focus() {
    this.focused++;
  }
  setTitle(title: string) {
    this.title = title;
  }
  close() {
    this.emit("close");
    this.emit("closed");
  }
}
const key = Symbol.for("apx.test.popout");
Object.assign(globalThis, { [key]: { BaseWindow: Window, WebContentsView: View } });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.popout")]; export const BaseWindow = n.BaseWindow; export const WebContentsView = n.WebContentsView;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createPopout } = await import("./popout.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);

test("popout attaches its panel, encodes the tab, reuses the existing window and refits on resize", () => {
  const changed: boolean[] = [];
  let layouts = 0;
  const popout = createPopout({
    url: () => "http://127.0.0.1:7580",
    preload: "preload.js",
    partition: "test",
    changed: (open) => changed.push(open),
    layout: () => layouts++,
  });
  assert.equal(popout.window(), undefined);
  assert.equal(popout.panel(), undefined);
  assert.equal(popout.processId(), undefined);
  assert.equal(popout.isPanel({} as Parameters<typeof popout.isPanel>[0]), false);
  popout.open("Browser", "tab & 1");
  const win = windows.at(-1);
  assert.ok(win);
  const panel = win.contentView.children[0];
  assert.ok(panel);
  assert.deepEqual(panel.bounds, { x: 0, y: 0, width: 1100, height: 820 });
  assert.deepEqual(panel.webContents.loaded, ["http://127.0.0.1:7580/?browser=1&tab=tab%20%26%201"]);
  assert.deepEqual(changed, [true]);
  assert.equal(popout.isPanel(popout.panel() as NonNullable<ReturnType<typeof popout.panel>>), true);
  assert.equal(popout.processId(), 42);
  popout.open("Other");
  assert.equal(win.shown, 1);
  assert.equal(win.focused, 1);
  assert.equal(win.contentView.children.length, 1);
  win.bounds = { width: 800, height: 600 };
  win.emit("resize");
  assert.deepEqual(panel.bounds, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(layouts, 1);
  popout.setTitle("Northwind");
  assert.equal(win.title, "Northwind");
  popout.close();
});

test("popout returns borrowed native views before closing its own panel and clears slot state", () => {
  const changed: boolean[] = [];
  let layouts = 0;
  const popout = createPopout({
    url: () => "http://127.0.0.1:7580",
    preload: "preload.js",
    partition: "test",
    changed: (open) => changed.push(open),
    layout: () => layouts++,
  });
  popout.open("Browser");
  const win = windows.at(-1);
  assert.ok(win);
  const panel = win.contentView.children[0];
  assert.ok(panel);
  const borrowed = new View();
  win.contentView.addChildView(borrowed);
  const slot = { x: 1, y: 2, width: 400, height: 300 };
  popout.setSlot(slot);
  assert.deepEqual(popout.slot(), slot);
  assert.equal(layouts, 1);
  popout.close();
  assert.deepEqual(changed, [true, false]);
  assert.equal(win.contentView.children.includes(borrowed), false);
  assert.equal(borrowed.webContents.closed, false);
  assert.equal(panel.webContents.closed, true);
  assert.equal(popout.window(), undefined);
  assert.equal(popout.panel(), undefined);
  assert.equal(popout.slot(), null);
  popout.close();
  popout.setTitle("Closed");
  popout.open("Reopened");
  const next = windows.at(-1);
  assert.notEqual(next, win);
  assert.deepEqual(next?.contentView.children[0]?.webContents.loaded, ["http://127.0.0.1:7580/?browser=1"]);
  popout.close();
});
