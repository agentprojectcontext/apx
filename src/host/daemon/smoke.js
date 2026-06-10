// Smoke test: register the example project and verify agents, sessions, MCPs
// are readable from the filesystem without any SQLite.
//
//   node src/smoke.js
//
// Exits non-zero on failure.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ProjectManager } from "./db.js";
import { McpRegistry } from "../../core/mcp/runner.js";
import { readAgents } from "../../core/apc/parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Smoke now lives at src/host/daemon/smoke.js — one level deeper than the
// legacy src/daemon/smoke.js. Adjust the example-project lookup accordingly:
//   ../../../examples/my-first-project           ← repo-local examples (if any)
//   ../../../../apc/examples/my-first-project    ← sibling apc/ repo
const EXAMPLE_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "examples", "my-first-project"),
  path.resolve(__dirname, "..", "..", "..", "..", "apc", "examples", "my-first-project"),
];
const EXAMPLE = EXAMPLE_CANDIDATES.find((p) =>
  fs.existsSync(path.join(p, "AGENTS.md")) &&
  fs.existsSync(path.join(p, ".apc", "project.json"))
);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const projects = new ProjectManager();
assert(EXAMPLE, `example project missing; checked ${EXAMPLE_CANDIDATES.join(", ")}`);
const entry = projects.register(EXAMPLE);
console.log("registered project", entry.id, entry.path);

const agents = readAgents(entry.path);
console.log("agents:", agents.map((a) => `${a.slug} (${a.fields.Role || "-"}, ${a.fields.Model || "-"})`));
assert(agents.length === 2, `expected 2 agents, got ${agents.length}`);
assert(agents.find((a) => a.slug === "sofia"), "sofia missing");
assert(agents.find((a) => a.slug === "martin"), "martin missing");

// Sessions: scan APX local runtime storage.
const sofiaSessions = (() => {
  const dir = path.join(entry.storagePath, "agents", "sofia", "sessions");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
})();
console.log("sofia sessions:", sofiaSessions);

const reg = new McpRegistry({ projectPath: entry.path, storagePath: entry.storagePath });
const list = reg.list();
console.log("mcps:", list.map((m) => `${m.name} (${m.source})`));
assert(list.find((m) => m.name === "filesystem" && m.source === "apc"), "filesystem MCP missing");
assert(list.find((m) => m.name === "brave" && m.source === "apc"), "brave MCP missing");
const conflicts = reg.conflicts();
console.log("conflicts:", conflicts);
reg.shutdown();

console.log("OK");
