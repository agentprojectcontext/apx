import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withUsualDirs } from "./programs.ts";

test("a bare PATH gets the usual folders it lacks at its end, only those that exist and once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-programs-"));
  const brew = path.join(root, "homebrew", "bin");
  const local = path.join(root, ".local", "bin");
  fs.mkdirSync(brew, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  const missing = path.join(root, "nowhere", "bin");
  try {
    const bare = ["/usr/bin", "/bin"].join(path.delimiter);
    assert.equal(withUsualDirs(bare, [brew, missing, local], "darwin"), [bare, brew, local].join(path.delimiter));
    // A folder already on the PATH keeps its place: the owner's order wins.
    const own = [local, "/usr/bin"].join(path.delimiter);
    assert.equal(withUsualDirs(own, [brew, local], "linux"), [own, brew].join(path.delimiter));
    assert.equal(withUsualDirs("", [brew], "darwin"), brew);
    // Windows' PATH is the user's own already.
    assert.equal(withUsualDirs(bare, [brew], "win32"), bare);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
