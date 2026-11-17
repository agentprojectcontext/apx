import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { openedIn, openedQueue, readOpened } from "./opened-files.ts";

test("only APX files that exist count among a launch's arguments, flags and other files never", () => {
  const exists = (p: string) => !p.includes("missing");
  const argv = ["/Applications/APX.app/x", "--apx-adopt-local", "~/work/Pantry.APXART", "notes.txt", "missing.apxext"];
  assert.deepEqual(openedIn(argv, exists), [path.resolve("~/work/Pantry.APXART")]);
});

test("an opened file is read once by the panel; a huge or missing one says why instead", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-opened-"));
  try {
    const art = path.join(dir, "pantry.apxart");
    fs.writeFileSync(art, '{"format":"apx-artifact@1"}');
    assert.deepEqual(readOpened(art, 10), { name: "pantry.apxart", error: "too-big" });
    assert.deepEqual(readOpened(path.join(dir, "gone.apxart")), { name: "gone.apxart", error: "unreadable" });

    let told = 0;
    const q = openedQueue(() => told++);
    q.add([art, art, path.join(dir, "notes.txt")]);
    assert.equal(told, 1);
    assert.deepEqual(q.take(), [{ name: "pantry.apxart", text: '{"format":"apx-artifact@1"}' }]);
    assert.deepEqual(q.take(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an opened .apxext reaches the panel byte for byte: it is a zip, never read as text", async () => {
  await using dir = tempDir("apx-opened-ext-");
  const ext = path.join(dir.path, "Weather.APXEXT");
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80]);
  fs.writeFileSync(ext, bytes);
  const read = readOpened(ext);
  assert.equal(read.text, undefined);
  assert.deepEqual(Buffer.from(read.data ?? "", "base64"), bytes);
});
