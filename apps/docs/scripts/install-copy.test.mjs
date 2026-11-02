import assert from "node:assert/strict";
import { test } from "node:test";
import { bindInstallationCopy } from "../src/components/install-copy.mjs";

function copyButton(original = "Copy", done = "Copied") {
  const label = { textContent: original };
  let click;
  const written = [];
  const button = {
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
  return { label, written, win, click: () => click(), advance };
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
