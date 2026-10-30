import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { mirroredNetworking, wslTemplate } from "./wsl-seed.ts";

test("the WSL template keeps the guest's settings over the local seed instead of VM disk images", () => {
  const template = fs.readFileSync(path.join(import.meta.dirname, "guest", "lima.yaml"), "utf8");
  const yaml = wslTemplate(template, "C:\\Users\\Ada\\.apx\\computer\\debian-wsl.tar");
  assert.match(
    yaml,
    /^vmType: wsl2\nmountType: wsl2\nimages:\n {2}- location: "C:\/Users\/Ada\/\.apx\/computer\/debian-wsl\.tar"\n/,
  );
  assert.doesNotMatch(yaml, /qcow2/);
  // Lima's user comes first, before the desktop packages are set up for it.
  assert.match(
    yaml,
    /\nprovision:\n {2}- mode: system\n {4}script: \|\n {6}#!\/bin\/sh\n {6}set -eu\n {6}id "\$LIMA_CIDATA_USER"/,
  );
  assert.match(yaml, /\nuser:\n {2}name: apx\n/);
});

test("WSL's mirrored networking is recognised so the computer refuses it", async () => {
  const dir = tempDir("apx-wslconfig-").path;
  try {
    const file = path.join(dir, ".wslconfig");
    fs.writeFileSync(file, "[wsl2]\nmemory=8GB\n");
    assert.equal(mirroredNetworking(file), false);
    fs.writeFileSync(file, "[wsl2]\r\nnetworkingMode = mirrored\r\n");
    assert.equal(mirroredNetworking(file), true);
    assert.equal(mirroredNetworking(path.join(dir, "missing")), false);
  } finally {
    await removeDir(dir);
  }
});
