// Starts the staged core (apps/desktop/.stage/apx) on an empty home and waits for /health: a bundle whose core cannot
// start never ships. See HISTORY.md#protocol-subpaths.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../..");
const stage = path.join(repo, "apps/desktop/.stage/apx");
const DEADLINE_MS = 90_000;

const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
  });
});
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-smoke-"));
const core = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/core/src/main.ts"], {
  cwd: stage,
  env: {
    ...process.env,
    APX_HOME: home,
    APX_PORT: String(port),
    APX_SECRETS: "file",
    APX_UPDATES: "off",
    APX_TELEMETRY: "off",
    APX_RUNTIME_SKILLS: "off",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [core.stdout, core.stderr]) stream.on("data", (d: Buffer) => (output = (output + d).slice(-8000)));
const exited = new Promise<number | null>((resolve) => core.on("exit", (code) => resolve(code)));
let gone = false;
void exited.then(() => {
  gone = true;
});

let healthy = false;
const until = Date.now() + DEADLINE_MS;
while (!healthy && !gone && Date.now() < until) {
  healthy = await fetch(`http://127.0.0.1:${port}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!healthy) await new Promise((r) => setTimeout(r, 500));
}
if (!gone) core.kill();
await exited;
fs.rmSync(home, { recursive: true, force: true });
if (!healthy) {
  console.error(output);
  throw new Error(
    gone ? "the staged core exited before it answered /health" : "the staged core did not answer /health",
  );
}
console.log("staged core answered /health");
