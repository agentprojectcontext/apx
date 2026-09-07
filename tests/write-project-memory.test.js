// `write_project_memory` — the document-shaped half of a project's local memory.
//
// THE FAILURE THIS FIXES, from a real install (2026-09-06): asked to store a
// full survey of Postbean — sections, a pricing table, operational notes — the
// super-agent had no tool shaped like a document. `remember` takes "one
// self-contained sentence", so the survey did not fit, and the model used the
// tools that did: it wrote `memory.md` at the repo root. Nothing reads that
// file — not the Memories screen, not the RAG indexer — and that repo deploys
// to production on every push.
//
// The assertions that matter are therefore about WHICH FILE again: a document
// has to land in the runtime store, never in the repo, and replacing one has to
// leave the previous body behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wpm-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const tool = (await import("#core/agent/tools/handlers/write-project-memory.js")).default;
const { projectLocalMemoryPath, readProjectLocalMemory } =
  await import("#core/stores/project-memory.js");
const { apcMemoryFile } = await import("#core/apc/paths.js");

const root = makeTempProject("wpm");
const storage = path.join(TMP_HOME, ".apx", "projects", "wpmproj");
const project = { id: 1, name: "Postbean", path: root, storagePath: storage };
const projects = { list: () => [project], get: () => project };
const run = (args) => tool.makeHandler({ projects, channel: "code" })(args);

test("a document lands in the runtime store, not in the repo", async () => {
  const body = "# Postbean\n\n## Planes\n\n| Plan | Precio |\n|---|---|\n| Free | $0 |\n";
  const r = await run({ project: "Postbean", content: body, mode: "replace" });

  assert.equal(r.ok, true);
  assert.equal(r.path, projectLocalMemoryPath(project));
  assert.ok(r.path.startsWith(storage), `wrote outside the store: ${r.path}`);
  assert.equal(readProjectLocalMemory(project), body);

  assert.ok(!fs.existsSync(path.join(root, "memory.md")), "never at the repo root");
  assert.ok(!fs.existsSync(path.join(root, "MEMORY.md")), "never at the repo root");
  assert.ok(!fs.existsSync(apcMemoryFile(root)), "never the committed .apc/memory.md");
});

test("replace leaves the previous body behind", async () => {
  await run({ project: "Postbean", content: "# first\n", mode: "replace" });
  const r = await run({ project: "Postbean", content: "# second\n", mode: "replace" });

  assert.equal(readProjectLocalMemory(project), "# second\n");
  assert.ok(r.backup, "a wholesale overwrite without a copy is not recoverable");
  assert.equal(fs.readFileSync(r.backup, "utf8"), "# first\n");
});

test("append adds one dated bullet and keeps the document", async () => {
  await run({ project: "Postbean", content: "# Postbean\n\n## Stack\n- Laravel 12\n", mode: "replace" });
  const r = await run({ project: "Postbean", content: "Lemon Squeezy es el MoR, reemplazó a Stripe." });

  assert.equal(r.mode, "append");
  const mem = readProjectLocalMemory(project);
  assert.match(mem, /## Stack\n- Laravel 12/, "the document survives an append");
  assert.match(mem, /\[code\] Lemon Squeezy es el MoR/, "tagged with the channel");
  assert.match(mem, /^## \d{4}-\d{2}-\d{2}$/m, "under a dated heading");
});

test("replace asks before overwriting", async () => {
  const asked = [];
  const handler = tool.makeHandler({
    projects,
    requirePermission: (name, opts) => { asked.push([name, opts?.dangerous, opts?.args?.mode]); },
  });
  await handler({ project: "Postbean", content: "# x\n", mode: "replace" });
  assert.deepEqual(asked, [["write_project_memory", true, "replace"]]);
});

test("an unknown project is an error, not a silent write somewhere else", async () => {
  const r = await run({ project: "ghost", content: "x", mode: "replace" });
  assert.ok(r.error, "expected an error");
  assert.ok(!r.ok);
});

test("empty inputs are refused", async () => {
  assert.ok((await run({ project: "Postbean", content: "  " })).error);
  assert.ok((await run({ project: "", content: "x" })).error);
});

test("it is registered, categorised under memory, and stays off the base set", async () => {
  const { TOOL_SCHEMAS, BASE_TOOL_NAMES, toolCatalog } = await import("#core/agent/tools/registry.js");
  const names = TOOL_SCHEMAS.map((s) => s.function?.name || s.name);
  assert.ok(names.includes("write_project_memory"), "not in the registry");
  // Lazy on purpose: document-shaped writes are rare and the base set pays
  // tokens on every turn. `remember` is hot and names this one, which is what
  // keeps the model from improvising a file instead.
  assert.ok(!BASE_TOOL_NAMES.has("write_project_memory"));
  const remember = TOOL_SCHEMAS.find((s) => (s.function?.name || s.name) === "remember");
  assert.match(remember.function.description, /write_project_memory/);
  if (typeof toolCatalog === "function") {
    const entry = toolCatalog().find((t) => t.name === "write_project_memory");
    if (entry) assert.equal(entry.category, "memory");
  }
});

process.on("exit", () => cleanupTempProject(root));
