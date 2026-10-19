import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("curl-style setup opens desktop before installing any service; server and headless paths stay explicit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-install-shell-"));
  const fakebin = path.join(dir, "bin");
  const bundleDir = path.join(dir, "bundle/apx/node/bin");
  fs.mkdirSync(fakebin);
  fs.mkdirSync(bundleDir, { recursive: true });
  const executable = (file: string, body: string) => fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  executable(path.join(fakebin, "uname"), 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac');
  executable(path.join(fakebin, "pkill"), "exit 0");
  executable(path.join(fakebin, "npm"), "exit 1");
  executable(path.join(fakebin, "loginctl"), "echo yes");
  executable(path.join(bundleDir, "node"), 'printf "%s\\n" "$*" >> "$APX_INSTALL_LOG"');
  const archive = path.join(dir, "apx-core-2.9.1-linux-x64.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", path.join(dir, "bundle"), "apx"]);
  const bytes = fs.readFileSync(archive);
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/releases")) res.end(JSON.stringify([{ tag_name: "v2.9.1" }]));
    else if (req.url?.endsWith(".sha256")) res.end(createHash("sha256").update(bytes).digest("hex"));
    else res.end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const args of [
      ["--desktop", "--server"],
      ["--no-service", "--desktop"],
      ["--desktop", "--no-service"],
      ["--file", archive, "--desktop"],
      ["--desktop", "--file", archive],
    ]) {
      await assert.rejects(
        promisify(execFile)("bash", [path.resolve("scripts/install/install.sh"), ...args]),
        /cannot be combined/,
      );
    }
    const cases = [
      { name: "desktop", args: [], graphical: true, mode: "desktop" },
      { name: "server", args: ["--server"], graphical: true, mode: "server" },
      { name: "headless", args: [], graphical: false, mode: "server" },
      { name: "no-service", args: ["--no-service"], graphical: true, mode: "server" },
      { name: "existing", args: [], graphical: true, mode: "server", existing: true },
      { name: "existing-desktop", args: ["--desktop"], graphical: true, mode: "desktop", existing: true },
    ];
    for (const item of cases) {
      const home = path.join(dir, item.name);
      fs.mkdirSync(home);
      const app = path.join(home, ".apx/v2/app");
      const log = path.join(home, "calls");
      if (item.existing) {
        fs.mkdirSync(app, { recursive: true });
        fs.symlinkSync(path.join(dir, "bundle/apx"), path.join(app, "current"));
      }
      const result = await promisify(execFile)(
        "bash",
        [path.resolve("scripts/install/install.sh"), ...item.args, "--feed", `http://127.0.0.1:${address.port}`],
        {
          env: {
            ...process.env,
            HOME: home,
            APX_APP: app,
            APX_HOME: path.join(home, ".apx/v2"),
            APX_INSTALL_LOG: log,
            DISPLAY: item.graphical ? ":1" : "",
            WAYLAND_DISPLAY: "",
            SSH_CONNECTION: "",
            SSH_TTY: "",
            PATH: `${fakebin}${path.delimiter}${process.env.PATH}`,
          },
        },
      );
      assert.ok(result.stdout.includes(`Install mode: ${item.mode}`));
      const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
      if (item.mode === "desktop") {
        assert.match(calls, / desktop\n/);
        assert.doesNotMatch(calls, /service install/);
      } else if (item.name === "no-service") assert.doesNotMatch(calls, /service install| desktop/);
      else {
        assert.match(calls, /service install/);
        assert.doesNotMatch(calls, / desktop/);
      }
      if (item.name === "existing-desktop") {
        assert.equal(fs.existsSync(path.join(app, "install-mode")), false);
        assert.equal(fs.realpathSync(path.join(app, "current")), fs.realpathSync(path.join(dir, "bundle/apx")));
      } else assert.equal(fs.readFileSync(path.join(app, "install-mode"), "utf8").trim(), item.mode);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
