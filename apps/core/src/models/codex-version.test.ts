import assert from "node:assert/strict";
import { test } from "node:test";
import { codexVersion } from "./codex-version.ts";

test("the plan catalog uses the verified client floor when Codex is old, absent or broken", async () => {
  for (const output of [undefined, "", "codex-cli 0.159.2", "codex-cli 0.160.0", "unrecognized"]) {
    assert.equal(await codexVersion(async () => output), "0.172.0");
  }
  assert.equal(
    await codexVersion(async () => {
      throw new Error("not installed");
    }),
    "0.172.0",
  );
});

test("each plan refresh detects an upgraded client and preserves newer versions numerically", async () => {
  let installed = "codex-cli 0.172.0";
  const read = async () => installed;
  assert.equal(await codexVersion(read), "0.172.0");
  installed = "codex-cli 0.173.0";
  assert.equal(await codexVersion(read), "0.173.0");
  installed = "codex-cli 0.1000.0";
  assert.equal(await codexVersion(read), "0.1000.0");
});
