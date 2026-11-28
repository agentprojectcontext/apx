#!/usr/bin/env node
// `pnpm check:native`: the phone app's own native modules (apps/mobile/modules) are built from what git has. A source
// file git does not track (untracked, or caught by an ignore rule) never reaches the release build, which then ships
// without that module. See HISTORY.md#voice-module-sources
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = /\.(kt|java|xml|gradle|json)$/;

type Git = (args: string[]) => string;

/** What keeps each local module from being built from git, in words someone can act on. */
export function nativeProblems(mobile: string, git: Git): string[] {
  const dir = path.join(mobile, "modules");
  if (!fs.existsSync(dir)) return [];
  const problems: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const root = path.join(dir, name);
    const config = path.join(root, "expo-module.config.json");
    if (!fs.existsSync(config)) continue;
    const declared: string[] = JSON.parse(fs.readFileSync(config, "utf8")).android?.modules ?? [];
    const rel = path.relative(mobile, root);
    const tracked = new Set(git(["ls-files", "--", rel]).split("\n").filter(Boolean));
    const outside = git(["ls-files", "--others", "--", rel])
      .split("\n")
      .filter((f) => f.includes("/android/") && !/\/android\/(build|\.cxx|\.gradle)\//.test(f) && SOURCE.test(f));
    for (const f of outside) problems.push(`${f} is not in git: commit it (git add -f when an ignore rule hides it)`);
    for (const cls of declared) {
      const base = `${rel}/android/src/main/java/${cls.replaceAll(".", "/")}`;
      if (!tracked.has(`${base}.kt`) && !tracked.has(`${base}.java`)) {
        problems.push(`${name}: ${cls} is declared in expo-module.config.json but ${base}.kt is not in git`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/mobile");
  const problems = nativeProblems(mobile, (args) => execFileSync("git", args, { cwd: mobile, encoding: "utf8" }));
  for (const p of problems) console.error(`check:native: ${p}`);
  process.exitCode = problems.length ? 1 : 0;
}
