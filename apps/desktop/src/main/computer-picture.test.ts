import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { Bounds, ComputerDriver } from "./computer-driver.ts";

let display = {
  id: 2,
  bounds: { x: -1000, y: -800, width: 1000, height: 800 },
  size: { width: 1000, height: 800 },
  scaleFactor: 2,
};
let windowBounds: Bounds | undefined;
let thumbnailSize = { width: 2000, height: 1600 };
const crops: Bounds[] = [];
function image(width: number, height: number) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    crop: (bounds: Bounds) => {
      crops.push(bounds);
      return image(bounds.width, bounds.height);
    },
    resize: (size: { width: number }) => image(size.width, Math.round((height * size.width) / width)),
    toJPEG: () => Buffer.from(`${width}x${height}`),
  };
}
const electron = {
  systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => "granted" },
  desktopCapturer: {
    getSources: async () => [
      { display_id: String(display.id), thumbnail: image(thumbnailSize.width, thumbnailSize.height) },
    ],
  },
  screen: { getDisplayMatching: () => display, getPrimaryDisplay: () => display, getAllDisplays: () => [display] },
  shell: {},
  app: {},
};
Object.assign(globalThis, { [Symbol.for("apx.test.picture")]: electron });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('export const { systemPreferences, desktopCapturer, screen, shell, app } = globalThis[Symbol.for("apx.test.picture")];')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createComputer } = await import("./computer.ts");
hooks.deregister();

function setup(bounds?: Bounds) {
  windowBounds = bounds;
  crops.length = 0;
  const driver: ComputerDriver = {
    front: async () => ({ app: "Acme", pid: 1, window: "Test", bounds: windowBounds, lines: [] }),
    activate: async () => {},
    topAt: async () => undefined,
    open: async () => {},
    canPress: () => true,
    key: async () => "Acme",
    press: async () => "pressed",
    click: async () => {},
    insert: async () => true,
    paste: async () => {},
  };
  return createComputer({
    driver,
    cursor: { moveTo: async () => {}, hide: () => {}, pulse: () => {}, say: () => {}, close: () => {} },
    onActivity: () => {},
    onStopped: () => {},
  });
}
async function snapshot(computer: ReturnType<typeof setup>) {
  return (await computer.handle("computer.snapshot", {})) as { elements: string; data: string };
}

test("a window clipped at the left and top maps pixels from the visible intersection", async () => {
  const computer = setup({ x: -1100, y: -900, width: 500, height: 400 });
  const result = await snapshot(computer);
  assert.deepEqual(crops, [{ x: 0, y: 0, width: 800, height: 600 }]);
  assert.match(result.elements, /picture is 800x600 px.*\(-1000 \+ px\*0\.500, -800 \+ py\*0\.500\)/);
  assert.deepEqual((await computer.frame())?.bounds, { x: -1000, y: -800, width: 400, height: 300 });
});

test("a window clipped at the right and bottom maps only the captured area", async () => {
  const result = await snapshot(setup({ x: -300, y: -200, width: 500, height: 400 }));
  assert.deepEqual(crops, [{ x: 1400, y: 1200, width: 600, height: 400 }]);
  assert.match(result.elements, /picture is 600x400 px.*\(-300 \+ px\*0\.500, -200 \+ py\*0\.500\)/);
});

test("full display and resized screenshots retain the negative display origin", async () => {
  const result = await snapshot(setup());
  assert.match(result.elements, /picture is 1600x1280 px.*\(-1000 \+ px\*0\.625, -800 \+ py\*0\.625\)/);
  assert.equal(Buffer.from(result.data, "base64").toString(), "1600x1280");
  assert.deepEqual(crops, []);
});

test("rounding and unequal thumbnail axes use the actual crop origin and dimensions", async () => {
  display = { ...display, bounds: { x: 0, y: 0, width: 1000, height: 800 } };
  thumbnailSize = { width: 1500, height: 1000 };
  const result = await snapshot(setup({ x: 1, y: 2, width: 200, height: 100 }));
  assert.deepEqual(crops, [{ x: 2, y: 3, width: 300, height: 125 }]);
  assert.match(result.elements, /\(1\.3333333333333333 \+ px\*0\.667, 2\.4 \+ py\*0\.800\)/);
});
