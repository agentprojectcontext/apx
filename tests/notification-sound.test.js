import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopAudio = path.join(ROOT, "src/interfaces/desktop/assets/notification.mp3");
const androidAudio = path.join(ROOT, "src/interfaces/android/app/src/main/res/raw/apx_notification.mp3");

test("desktop and Android ship the same valid notification sound", () => {
  const desktop = fs.readFileSync(desktopAudio);
  const android = fs.readFileSync(androidAudio);

  assert.ok(desktop.length > 1_000);
  assert.ok(desktop.subarray(0, 3).equals(Buffer.from("ID3")) || desktop[0] === 0xff);
  assert.deepEqual(desktop, android);
});

test("desktop notification sound is optional and exposed as checked menu item", () => {
  const main = fs.readFileSync(path.join(ROOT, "src/interfaces/desktop/main.js"), "utf8");
  const renderer = fs.readFileSync(path.join(ROOT, "src/interfaces/desktop/mascot.js"), "utf8");

  assert.match(main, /mascot_sound\s*!==\s*false/);
  assert.match(main, /label:\s*"Sonido de mensajes"[\s\S]*?type:\s*"checkbox"/);
  assert.match(renderer, /msg\.sound\s*!==\s*false/);
  assert.match(renderer, /notificationSound\.play\(\)/);
});
