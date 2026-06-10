// Artifacts: managed files stored in storagePath/artifacts/.
// Agents, routines, and shell scripts can create and reference these files.
// Path: ~/.apx/projects/{apxId}/artifacts/<name>
import fs from "node:fs";
import path from "node:path";

export const ARTIFACTS_SKIP_SIGNAL = "APX_SKIP";

export function artifactsDir(storagePath) {
  return path.join(storagePath, "artifacts");
}

export function artifactPath(storagePath, name) {
  return path.join(artifactsDir(storagePath), name);
}

// Resolve "artifact:<name>" shorthand in command strings.
export function resolveArtifactRef(cmd, storagePath) {
  if (typeof cmd === "string" && cmd.startsWith("artifact:")) {
    const name = cmd.slice(9).trim();
    return artifactPath(storagePath, name);
  }
  return cmd;
}

export function createArtifact(storagePath, name, content = "") {
  const dir = artifactsDir(storagePath);
  fs.mkdirSync(dir, { recursive: true });
  const p = artifactPath(storagePath, name);
  if (fs.existsSync(p)) throw new Error(`artifact "${name}" already exists at ${p}`);
  fs.writeFileSync(p, content);
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
