import { spawnSync } from "node:child_process";
import path from "node:path";

// Catalog discovery must not start agent CLIs installed alongside the developer's tools.
const systemPath =
  process.platform === "win32"
    ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")
    : ["/usr/bin", "/bin"].join(path.delimiter);
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...[
      "browser.test.ts",
      "agents.test.ts",
      "navigation.test.ts",
      "framing.test.ts",
      "store.test.ts",
      "control.test.ts",
    ].map((file) => path.join(import.meta.dirname, file)),
  ],
  {
    env: { ...env, PATH: systemPath },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
