// Test helpers: ephemeral project tree builder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Deliberately NO top-level import of #core/config or anything that reaches it:
// config/paths.js freezes APX_HOME into module constants the moment it loads,
// and every test file that imports this helper would freeze it before it got a
// chance to point APX_HOME at its own sandbox (see admin-reload.test.js).
// Source of truth for the layout below: core/agent/memory.js + config/paths.js.
function agentMemoryFile(root, slug) {
  const apxHome = process.env.APX_HOME || path.join(os.homedir(), ".apx");
  const { apx_id } = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
  return path.join(apxHome, "projects", apx_id, "agents", slug, "memory.md");
}

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
      apx_id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    }, null, 2)
  );

  for (const a of agents) {
    // Agents live in .apc/agents/<slug>.md — the one source readAgents() reads.
    // AGENTS.md is the project's startup-rules file, never an agent registry.
    const fm = ["---"];
    if (a.role) fm.push(`role: ${a.role}`);
    if (a.model) fm.push(`model: ${a.model}`);
    if (a.skills?.length) fm.push(`skills: ${a.skills.join(", ")}`);
    if (a.language) fm.push(`language: ${a.language}`);
    if (a.description) fm.push(`description: ${a.description}`);
    fm.push("---", "");
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${a.slug}.md`),
      `${fm.join("\n")}\n${a.body || ""}`
    );

    // Memory goes where the code reads it: ~/.apx/projects/<apx_id>/agents/
    // <slug>/memory.md, never .apc/. A fixture seeded under .apc/ is a fixture
    // production stopped looking at.
    const mem = agentMemoryFile(root, a.slug);
    fs.mkdirSync(path.dirname(mem), { recursive: true });
    fs.writeFileSync(mem, a.memory || `# Memory — ${a.slug}\n\n## Identity\n- ${a.slug}\n`);
  }
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Project rules\n");

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
  // The runtime half lives outside the repo tree, so removing the repo alone
  // leaves a stray ~/.apx/projects/<apx_id>/ behind on every single run.
  try {
    // memory.md → agents/<slug> → agents → the store itself.
    const store = path.dirname(path.dirname(path.dirname(agentMemoryFile(root, "_"))));
    const id = path.basename(store);
    if (path.basename(path.dirname(store)) === "projects" && id !== "default" && id !== "null") {
      fs.rmSync(store, { recursive: true, force: true });
    }
  } catch {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

// Router mounted at /api, matching what buildApi does in production. Tests that
// register a route module straight onto a bare express app would otherwise
// serve it at the root and silently stop matching real URLs.
//
//   register(apiRouter(express, app), ctx)   // routes land under /api/…
//
// Express routers are mutable after mounting, so returning the router before
// the module registers on it is fine.
export function apiRouter(express, app) {
  const router = express.Router();
  app.use("/api", router);
  return router;
}
