import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON = process.env.APX_DAEMON_URL || "http://localhost:7430";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_FILE = path.join(HERE, ".runtime.json");

// Prepares an isolated, throwaway project so the mutating CRUD specs never
// touch the user's real registered projects. Writes the bearer token + the
// throwaway project's id/path/tmpDir to .runtime.json for the fixtures and
// teardown to consume.
export default async function globalSetup() {
  // 1. Loopback bearer token (same one the panel auto-fetches).
  const tokenRes = await fetch(`${DAEMON}/admin/web-token`);
  if (!tokenRes.ok) {
    throw new Error(
      `Could not get /admin/web-token from ${DAEMON} (HTTP ${tokenRes.status}). Is the daemon running? Try: apx daemon status`,
    );
  }
  const { token } = (await tokenRes.json()) as { token: string };
  if (!token) throw new Error("daemon returned no token");

  // 2. Throwaway project on a temp dir, initialised as an APC project.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-"));
  execSync(`apx init . --name apx-e2e`, { cwd: tmpDir, stdio: "ignore" });

  // 3. Register it with the daemon.
  const reg = await fetch(`${DAEMON}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: tmpDir }),
  });
  if (!reg.ok) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`POST /projects failed: HTTP ${reg.status} ${await reg.text()}`);
  }
  const { id: projectId, path: projectPath } = (await reg.json()) as { id: number; path: string };

  const runtime = {
    token,
    daemon: DAEMON,
    projectId,
    projectPath,
    tmpDir,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(runtime, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n[e2e] throwaway project #${projectId} → ${projectPath}\n`);
}
