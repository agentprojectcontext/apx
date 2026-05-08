// Test helpers: ephemeral project tree builder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let counter = 0;

export function makeTempProject({ name = "tmp", agents = [], skills = [], mcps = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `apx-test-${++counter}-`));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, ".apc", "skills"), { recursive: true });

  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({
      name,
      version: "0.1.0",
      apf: "0.1.0",
      created: "2026-01-01T00:00:00Z",
    }, null, 2)
  );

  let agentsMd = "# Agents\n\n";
  for (const a of agents) {
    agentsMd += `## ${a.slug}\n`;
    if (a.role) agentsMd += `- **Role**: ${a.role}\n`;
    if (a.model) agentsMd += `- **Model**: ${a.model}\n`;
    if (a.skills?.length) agentsMd += `- **Skills**: ${a.skills.join(", ")}\n`;
    if (a.language) agentsMd += `- **Language**: ${a.language}\n`;
    if (a.description) agentsMd += `- **Description**: ${a.description}\n`;
    agentsMd += "\n";

    const adir = path.join(root, ".apc", "agents", a.slug);
    fs.mkdirSync(path.join(adir, "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(adir, "memory.md"),
      a.memory || `# Memory — ${a.slug}\n\n## Identity\n- ${a.slug}\n`
    );
  }
  fs.writeFileSync(path.join(root, "AGENTS.md"), agentsMd);

  for (const s of skills) {
    fs.writeFileSync(
      path.join(root, ".apc", "skills", `${s.name}.md`),
      s.body || `# ${s.name}\n`
    );
  }

  if (Object.keys(mcps).length) {
    fs.writeFileSync(
      path.join(root, ".apc", "mcps.json"),
      JSON.stringify({ mcpServers: mcps }, null, 2)
    );
  }

  return root;
}

export function cleanupTempProject(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}
