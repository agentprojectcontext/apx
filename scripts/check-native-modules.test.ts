import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../apps/core/src/testkit/platform.ts";
import { nativeProblems } from "./check-native-modules.ts";

function repo() {
  const dir = tempDir("apx-native-").path;
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q"]);
  const write = (f: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  };
  write(
    "modules/voice/expo-module.config.json",
    JSON.stringify({ platforms: ["android"], android: { modules: ["dev.x.voice.VoiceModule"] } }),
  );
  write("modules/voice/android/src/main/java/dev/x/voice/VoiceModule.kt", "package dev.x.voice\n");
  write("modules/voice/android/src/main/java/dev/x/voice/Helper.kt", "package dev.x.voice\n");
  return { dir, git, write };
}

test("a module whose sources an ignore rule hides is caught", () => {
  const { dir, git, write } = repo();
  try {
    write(".gitignore", "android/\n");
    git(["add", "."]);
    const problems = nativeProblems(dir, git);
    assert.ok(problems.some((p) => p.includes("VoiceModule is declared")));
    assert.ok(problems.some((p) => p.includes("Helper.kt is not in git")));
  } finally {
    removeDir(dir);
  }
});

test("a module with every source in git passes", () => {
  const { dir, git } = repo();
  try {
    git(["add", "."]);
    assert.deepEqual(nativeProblems(dir, git), []);
  } finally {
    removeDir(dir);
  }
});
