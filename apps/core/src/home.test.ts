import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { moveLegacyHome } from "./home.ts";

test("the old home moves into ~/.apx/v2 once, leaving v1's files and an existing new home alone", () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), "apx-home-"));
  const legacy = path.join(user, ".apx2");
  const home = path.join(user, ".apx", "v2");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "apx.db"), "v2 state");
  fs.mkdirSync(path.join(user, ".apx"));
  fs.writeFileSync(path.join(user, ".apx", "config.json"), "v1 config");

  assert.equal(moveLegacyHome({ home, legacy, explicit: true }), "none", "a home the owner set is theirs");
  assert.equal(moveLegacyHome({ home, legacy, explicit: false }), "moved");
  assert.equal(fs.readFileSync(path.join(home, "apx.db"), "utf8"), "v2 state");
  assert.equal(fs.readFileSync(path.join(user, ".apx", "config.json"), "utf8"), "v1 config");
  assert.ok(!fs.existsSync(legacy));

  fs.mkdirSync(legacy);
  assert.equal(moveLegacyHome({ home, legacy, explicit: false }), "none", "the new home is never replaced");
  fs.rmSync(user, { recursive: true, force: true });
});
