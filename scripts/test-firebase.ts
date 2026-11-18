import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../apps/core/src/testkit/platform.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
function firebaseCli(): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const file of [
      path.join(dir, "firebase"),
      path.join(dir, "node_modules/firebase-tools/lib/bin/firebase.js"),
    ]) {
      try {
        const resolved = fs.realpathSync(file);
        if (resolved.endsWith("firebase.js")) return resolved;
      } catch {}
    }
  }
  throw new Error("Install Firebase CLI before running pnpm test:firebase");
}
async function run(file: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${signal ?? code}): ${file}`)),
    );
  });
}
async function main() {
  const cli = firebaseCli();
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Run through pnpm test:firebase");
  await run(pnpm, ["build:web"]);
  await run(pnpm, ["--filter", "@apx/artifact-viewer", "build"]);
  await run(pnpm, ["--filter", "@apx/artifact-worker", "build"]);
  const temporary = tempDir("apx-firebase-gate-");
  try {
    fs.copyFileSync(path.join(root, "firebase/firestore.rules"), path.join(temporary.path, "firestore.rules"));
    const config = path.join(temporary.path, "firebase.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        firestore: { rules: "firestore.rules" },
        emulators: {
          firestore: { host: "127.0.0.1", port: 8196 },
          ui: { enabled: false },
          singleProjectMode: true,
        },
      }),
    );
    await run(
      cli,
      [
        "emulators:exec",
        "--config",
        config,
        "--only",
        "firestore",
        "--project",
        "demo-apx-artifacts",
        'node --test --test-concurrency=1 "firebase/*.rules.test.ts" && node scripts/test-public-artifacts.ts',
      ],
      { ...process.env, APX_SECRETS: "file" },
    );
  } finally {
    await temporary.remove();
  }
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
