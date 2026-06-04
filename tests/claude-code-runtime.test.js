import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeClaudeProjectPath,
  resolveClaudeSessionPath,
} from "../src/host/daemon/runtimes/claude-code.js";

test("encodeClaudeProjectPath matches Claude Code project directory naming", () => {
  assert.equal(
    encodeClaudeProjectPath("/Users/wizardgpt/.apx/projects/default"),
    "-Users-wizardgpt--apx-projects-default"
  );
  assert.equal(
    encodeClaudeProjectPath("/Volumes/SSDT7Shield/proyectos_varios/nicho-apps"),
    "-Volumes-SSDT7Shield-proyectos-varios-nicho-apps"
  );
});

test("resolveClaudeSessionPath finds a moved or differently encoded transcript", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-claude-home-"));
  try {
    const sessionId = "5b4e6600-a116-4b36-9ef2-83daf869eabc";
    const dir = path.join(home, ".claude", "projects", "custom-dir");
    fs.mkdirSync(dir, { recursive: true });
    const transcript = path.join(dir, `${sessionId}.jsonl`);
    fs.writeFileSync(transcript, "{}\n");

    assert.equal(
      resolveClaudeSessionPath({
        cwd: "/Users/wizardgpt/.apx/projects/default",
        sessionId,
        home,
      }),
      transcript
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
