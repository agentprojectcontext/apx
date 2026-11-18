import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../apps/core/src/testkit/platform.ts";

type EmulatorConfig = {
  firestore?: { rules: string };
  emulators: { firestore?: { host: string; port: number } };
  hosting: {
    target?: string;
    site?: string;
    public: string;
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};

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
  if (!pnpm) throw new Error("Run this gate through pnpm test:firebase");
  const env = { ...process.env, VITE_ARTIFACT_FIREBASE_PROJECT: "demo-apx-artifacts", VITE_ARTIFACT_EMULATOR: "1" };
  await run(pnpm, ["build:web"], env);
  await run(pnpm, ["--filter", "@apx/artifact-viewer", "build"], env);
  const temporary = tempDir("apx-firebase-gate-");
  const dir = temporary.path;
  try {
    // A demo-only copy adds loopback connectivity without changing deployable production headers.
    const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.artifacts.json"), "utf8")) as EmulatorConfig;
    const publicDir = path.join(dir, "public");
    fs.cpSync(path.join(root, "apps/artifact-viewer/dist"), publicDir, { recursive: true });
    fs.copyFileSync(path.join(root, "firebase/firestore.rules"), path.join(dir, "firestore.rules"));
    config.firestore = { rules: "firestore.rules" };
    config.emulators.firestore = { host: "127.0.0.1", port: 8196 };
    delete config.hosting.target;
    config.hosting.site = "demo-apx-artifacts";
    config.hosting.public = "public";
    for (const entry of config.hosting.headers) {
      for (const header of entry.headers) {
        if (
          header.key === "Content-Security-Policy" &&
          header.value.includes("connect-src https://firestore.googleapis.com")
        )
          header.value = header.value.replace(
            "connect-src https://firestore.googleapis.com",
            "connect-src http://127.0.0.1:8196",
          );
      }
    }
    const file = path.join(dir, "firebase.json");
    fs.writeFileSync(file, JSON.stringify(config));
    const tests =
      'node --test --test-concurrency=1 "firebase/*.rules.test.ts" "firebase/public-artifact*.browser.test.ts" "firebase/public-copies*.browser.test.ts"';
    await run(
      cli,
      ["emulators:exec", "--config", file, "--only", "firestore,hosting", "--project", "demo-apx-artifacts", tests],
      {
        ...env,
        APX_ARTIFACT_VIEWER_URL: "http://127.0.0.1:7497",
        APX_SECRETS: "file",
      },
    );
  } finally {
    // emulators:exec has exited and closed its children before their files are removed.
    await temporary.remove();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
