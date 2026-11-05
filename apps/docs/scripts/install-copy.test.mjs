import assert from "node:assert/strict";
import { test } from "node:test";
import { bindInstallationCopy, copyInstallation } from "../src/components/install-copy.mjs";

function copyButton(original = "Copy", done = "Copied") {
  const label = { textContent: original };
  let click;
  const written = [];
  const events = [];
  const button = {
    dispatchEvent: (event) => events.push(event),
    dataset: { copy: "example command", done },
    querySelector: () => label,
    addEventListener: (_type, handler) => {
      click = handler;
    },
  };
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const win = {
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options.bubbles;
      }
    },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    },
    setTimeout: (callback, ms) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  bindInstallationCopy(win, button);
  return { label, written, events, win, click: () => click(), advance };
}

for (const [original, done] of [
  ["Copy", "Copied"],
  ["Copiar", "Copiado"],
]) {
  test(`two rapid copies restore the original ${original} label`, async () => {
    const fixture = copyButton(original, done);
    await fixture.click();
    assert.equal(fixture.label.textContent, done);
    fixture.advance(500);
    await fixture.click();
    assert.equal(fixture.label.textContent, done);
    fixture.advance(1000);
    assert.equal(fixture.label.textContent, done);
    fixture.advance(500);
    assert.equal(fixture.label.textContent, original);
    assert.deepEqual(fixture.written, ["example command", "example command"]);
    assert.equal(fixture.events.length, 2);
  });
}

for (const unavailable of [false, true]) {
  test(`an ${unavailable ? "unavailable" : "unsuccessful"} clipboard never shows success`, async () => {
    const fixture = copyButton();
    if (unavailable) fixture.win.navigator.clipboard = undefined;
    else
      fixture.win.navigator.clipboard.writeText = async () => {
        throw Error("denied");
      };
    await fixture.click();
    assert.equal(fixture.label.textContent, "Copy");
    fixture.advance(2000);
    assert.equal(fixture.label.textContent, "Copy");
    assert.deepEqual(fixture.written, []);
    assert.deepEqual(fixture.events, []);
  });
}

test("copy buttons keep their feedback independent", async () => {
  const first = copyButton();
  const second = copyButton("Copiar", "Copiado");
  await first.click();
  assert.equal(second.label.textContent, "Copiar");
  await second.click();
  first.advance(1500);
  assert.equal(first.label.textContent, "Copy");
  assert.equal(second.label.textContent, "Copiado");
  second.advance(1500);
  assert.equal(second.label.textContent, "Copiar");
});

test("copy success waits for the write and never includes command content", async () => {
  const fixture = copyButton();
  let finish;
  fixture.win.navigator.clipboard.writeText = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const copying = copyInstallation(fixture.win, {
    dataset: { copy: "synthetic private command" },
    dispatchEvent: (event) => fixture.events.push(event),
  });
  assert.deepEqual(fixture.events, []);
  finish();
  assert.equal(await copying, true);
  assert.equal(fixture.events[0].type, "apx:install-copied");
  assert.equal(fixture.events[0].bubbles, true);
  assert.ok(!JSON.stringify(fixture.events).includes("synthetic private command"));
});
