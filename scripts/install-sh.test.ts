import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { coreBundleName, platformOf } from "../packages/protocol/src/releases.ts";

const script = path.resolve(import.meta.dirname, "install/install.sh");

/** A bundle with only what install.sh checks: apx/node/bin/node, executable. */
function bundle(dir: string, version: string): string {
  const platform = platformOf(process.platform, process.arch);
  assert.ok(platform);
  const src = path.join(dir, `src-${version}`);
  fs.mkdirSync(path.join(src, "apx", "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(src, "apx", "node", "bin", "node"), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  const name = coreBundleName(version, platform);
  execFileSync("tar", ["-czf", name, "apx"], { cwd: src });
  return path.join(src, name);
}

test("installing over an existing APX makes the new version current", async () => {
  // install.sh is the Linux and macOS installer; Windows runs install.ps1, which swaps a junction instead.
  if (process.platform === "win32") return;
  await using dir = tempDir("apx-install-sh-");
  const home = path.join(dir.path, "home");
  const app = path.join(dir.path, "app");
  // Stand-ins for what the APX v1 cleanup calls, so the test never stops or removes anything on this machine.
  const bin = path.join(dir.path, "bin");
  fs.mkdirSync(bin);
  for (const tool of ["pkill", "launchctl", "systemctl", "npm", "loginctl"])
    fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const env = { HOME: home, APX_APP: app, PATH: `${bin}:/usr/bin:/bin` };
  const install = (version: string) =>
    execFileSync("bash", [script, "--file", bundle(dir.path, version), "--no-service"], { env, stdio: "pipe" });

  install("2.12.1");
  assert.equal(fs.readlinkSync(path.join(app, "current")), path.join("versions", "2.12.1"));
  install("2.12.2");
  assert.equal(fs.readlinkSync(path.join(app, "current")), path.join("versions", "2.12.2"));
  assert.equal(execFileSync(path.join(app, "current", "node", "bin", "node"), { encoding: "utf8" }).trim(), "2.12.2");
  assert.deepEqual(fs.readdirSync(path.join(app, "versions", "2.12.1")), ["node"]);
});
