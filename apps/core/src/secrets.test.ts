import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecrets } from "./secrets.ts";

test("secrets resolve by reference, list names only, and live in a 0600 file with the file backend", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-secrets-"));
  try {
    const s = createSecrets(home, "file", { MY_KEY: "from-env" });
    s.set("gemini", "k-123");
    assert.equal(s.resolve("secret://gemini"), "k-123");
    assert.equal(s.resolve("env:MY_KEY"), "from-env");
    assert.equal(s.resolve("k-123"), undefined, "a bare value is never a reference");
    assert.deepEqual(
      s.list().map((x) => x.name),
      ["gemini"],
    );
    assert.equal(fs.statSync(path.join(home, "secrets.json")).mode & 0o777, 0o600);
    s.set("gemini", null);
    assert.equal(s.resolve("secret://gemini"), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
