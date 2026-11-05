import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { samePath } from "../apps/core/src/paths.ts";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { performanceProcess } from "./perf-process.ts";

test("performance launches the exact Node binary without discovering adjacent global CLIs", async () => {
  const dir = tempDir("perf-process-");
  try {
    const executable = path.join(dir.path, "global-bin", process.platform === "win32" ? "node.exe" : "node");
    const launch = performanceProcess(executable);
    assert.ok(samePath(launch.command, executable), "the measured process still uses the selected Node version");
    const search = launch.searchPath.split(path.delimiter);
    assert.ok(search.length > 0);
    assert.ok(
      !search.some((entry) => samePath(entry, path.dirname(executable))),
      "global CLI siblings stay undiscoverable",
    );
    assert.ok(
      search.every((entry) => path.isAbsolute(entry)),
      "system executables do not depend on the current folder",
    );
  } finally {
    await dir.remove();
  }
});
