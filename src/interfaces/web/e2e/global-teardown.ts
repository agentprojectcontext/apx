import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_FILE = path.join(HERE, ".runtime.json");

// Unregisters the throwaway project and removes its temp dir. Best-effort:
// teardown failures must never mask test failures.
export default async function globalTeardown() {
  if (!fs.existsSync(RUNTIME_FILE)) return;
  let rt: { token: string; daemon: string; projectId: number; tmpDir: string };
  try {
    rt = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8"));
  } catch {
    return;
  }

  try {
    await fetch(`${rt.daemon}/projects/${rt.projectId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${rt.token}` },
    });
  } catch {
    /* ignore */
  }
  try {
    if (rt.tmpDir && rt.tmpDir.includes("apx-e2e-")) {
      fs.rmSync(rt.tmpDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(RUNTIME_FILE, { force: true });
  } catch {
    /* ignore */
  }
}
