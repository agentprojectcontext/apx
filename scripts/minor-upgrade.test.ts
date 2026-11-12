import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { samePath } from "../apps/core/src/paths.ts";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { upgradeArgs } from "./minor-upgrade.ts";
import { checkedArtifact, command, isolatedHomeEnv, releaseFixture } from "./upgrade-fixture.ts";

const args = ["--previous", "2.13.4", "--target", "2.14.0", "--candidate", "out", "--report", "out/proof.json"];

test("matrix arguments are explicit, increasing and reject unknown or duplicate input", () => {
  const parsed = upgradeArgs(args);
  assert.equal(parsed.previous, "2.13.4");
  assert.equal(parsed.target, "2.14.0");
  assert.equal(parsed.repo, "agentprojectcontext/apx");
  assert.throws(() => upgradeArgs([]), /missing/);
  assert.throws(() => upgradeArgs([...args, "--skip-native", "true"]), /Usage/);
  assert.throws(() => upgradeArgs([...args, "--target", "2.15.0"]), /Usage/);
  assert.throws(() => upgradeArgs(args.map((v) => (v === "2.14.0" ? "2.13.3" : v))), /increasing/);
  assert.throws(() => upgradeArgs(args.map((v) => (v === "2.14.0" ? "v2.14.0" : v))), /increasing/);
});

test("fixture home isolates external app discovery and does not inherit a live connection or token", async () => {
  await using home = tempDir();
  const env = isolatedHomeEnv(home.path, {
    HOME: "/unrelated",
    APX_APPS_HOME: "/unrelated",
    APX_HOME: "/unrelated",
    APX_URL: "http://127.0.0.1:7440",
    APX_TOKEN: "fixture-token",
  });
  assert.ok(samePath(env.HOME, home.path));
  assert.ok(samePath(env.APX_HOME, home.path));
  assert.ok(samePath(env.APX_APPS_HOME, home.path));
  assert.equal(env.APX_URL, undefined);
  assert.equal(env.APX_TOKEN, undefined);
});

function artifact(home: string, name: string) {
  const bytes = Buffer.from(`Fixture bytes for ${name}`);
  fs.writeFileSync(path.join(home, name), bytes);
  fs.writeFileSync(path.join(home, `${name}.sha256`), `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
}

test("candidate feed serves exactly the verified files and checksum corruption fails closed", async () => {
  await using home = tempDir();
  const names = ["apx-core-2.14.0-mac-arm64.tar.gz", "APX-2.14.0-mac-arm64.zip", "APX-2.14.0-mac-arm64.dmg"];
  for (const name of names) artifact(home.path, name);
  const fixture = await releaseFixture(home.path, "2.14.0");
  try {
    assert.equal(fixture.assets.length, 3);
    const releases = (await fetch(`${fixture.url}/releases?per_page=100`).then((r) => r.json())) as {
      assets: { name: string }[];
    }[];
    assert.equal(releases[0]?.assets.length, 6);
    const name = names[0];
    assert.ok(name);
    assert.equal(await fetch(`${fixture.url}/${name}`).then((r) => r.text()), `Fixture bytes for ${name}`);
    assert.equal((await fetch(`${fixture.url}/not-an-artifact`)).status, 404);
    fs.writeFileSync(path.join(home.path, name), "Corrupted bytes");
    assert.throws(() => checkedArtifact(home.path, name), /checksum/);
  } finally {
    await fixture.close();
  }
});

test("matrix process failures remain failures rather than successful proof", async () => {
  const out = await command(process.execPath, ["-e", "console.log('fixture completed')"]);
  assert.match(out, /fixture completed/);
  await assert.rejects(command(process.execPath, ["-e", "process.exitCode=7"]), /failed \(7\)/);
});
