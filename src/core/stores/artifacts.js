// Artifacts: managed files stored in storagePath/artifacts/.
// Agents, routines, and shell scripts can create and reference these files.
// Path: ~/.apx/projects/{apxId}/artifacts/<name>
import fs from "node:fs";
import path from "node:path";

export const ARTIFACTS_SKIP_SIGNAL = "APX_SKIP";

export function artifactsDir(storagePath) {
  return path.join(storagePath, "artifacts");
}

/**
 * The name is a FILENAME, never a path.
 *
 * This used to be a bare `path.join`, which meant `../../evil` escaped the
 * artifacts directory. That was survivable while only a person could reach it
 * through the CLI; it stops being survivable the moment an agent can write one
 * (see the artifact tools), so the check lives here rather than at each caller.
 */
export function assertArtifactName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) throw new Error("artifact name required");
  if (raw !== path.basename(raw) || raw === "." || raw === "..") {
    throw new Error(`invalid artifact name "${raw}" — a name, not a path`);
  }
  if (raw.startsWith(".")) throw new Error(`invalid artifact name "${raw}" — cannot start with a dot`);
  return raw;
}

export function artifactPath(storagePath, name) {
  return path.join(artifactsDir(storagePath), assertArtifactName(name));
}

// Resolve "artifact:<name>" shorthand in command strings.
export function resolveArtifactRef(cmd, storagePath) {
  if (typeof cmd === "string" && cmd.startsWith("artifact:")) {
    const name = cmd.slice(9).trim();
    return artifactPath(storagePath, name);
  }
  return cmd;
}

/**
 * @param {{overwrite?: boolean, executable?: boolean}} [opts]
 *   `overwrite` makes this an upsert. Without it, "regenerate this script" is a
 *   delete-then-create dance, and an agent that gets the error halfway through
 *   leaves nothing behind.
 */
export function createArtifact(storagePath, name, content = "", { overwrite = false, executable = false } = {}) {
  const dir = artifactsDir(storagePath);
  fs.mkdirSync(dir, { recursive: true });
  const p = artifactPath(storagePath, name);
  if (!overwrite && fs.existsSync(p)) throw new Error(`artifact "${name}" already exists at ${p}`);
  fs.writeFileSync(p, content);
  // A script that is meant to be run has to be runnable; the caller knows,
  // and a shebang without the exec bit fails at spawn time with a confusing
  // error about the file not being found.
  if (executable || String(content).startsWith("#!")) {
    try {
      fs.chmodSync(p, fs.statSync(p).mode | 0o111);
    } catch {
      // A filesystem that will not take the bit says so when it is run.
    }
  }
  return p;
}

export function listArtifacts(storagePath) {
  const dir = artifactsDir(storagePath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .sort()
    .map((f) => {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      return { name: f, path: p, size: stat.size, modified: stat.mtime.toISOString() };
    });
}

export function readArtifact(storagePath, name) {
  const p = artifactPath(storagePath, name);
  if (!fs.existsSync(p)) throw new Error(`artifact "${name}" not found`);
  return { name, path: p, content: fs.readFileSync(p, "utf8") };
}

export function removeArtifact(storagePath, name) {
  const p = artifactPath(storagePath, name);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}
