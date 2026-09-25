// `apx setup` closing summary — the daemon URL it prints.
//
// Regression guard: the wizard printed a literal http://127.0.0.1:7430 after
// starting the daemon, so a setup run with APX_PORT pointing elsewhere (a
// second, isolated install) told the user to open a port nothing of theirs was
// listening on — or worse, the port of a different install. It now prints the
// CLI client's own baseUrl(), which is where it just started the daemon.
// Before the fix the source assertion below failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-setup-url-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.APX_PORT = "7499";

const { http } = await import("#interfaces/cli/http.js");

const SETUP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/interfaces/cli/commands/setup.js"
);

test("the CLI client's baseUrl honors APX_PORT", () => {
  assert.equal(http.baseUrl(), "http://127.0.0.1:7499");
});

test("apx setup prints the daemon URL from baseUrl(), never a literal port", () => {
  const src = fs.readFileSync(SETUP, "utf8");
  assert.doesNotMatch(src, /127\.0\.0\.1:7430/);
  assert.match(src, /Daemon:.*daemonHttp\.baseUrl\(\)/);
});
