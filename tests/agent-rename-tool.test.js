// `rename_agent` — the rename button, reachable from a sentence.
//
// Asked to "cambiale el nombre al orchestrator de postbeam", an agent used to
// have two bad options: `configure_agent({ name })`, which relabels the card and
// leaves the slug — so every routine, room and task still points at the old key
// — or a shell pass over `.apc/agents/<slug>.md`, which moves the file and
// breaks all of them at once. Both reported success. This tool runs the same
// core `renameAgent` the HTTP route runs, so the two surfaces cannot drift.
//
// The second half of this file is the GATE: the tool reshapes somebody ELSE's
// identity, so it belongs to orchestrators and the super-agent, never to a
// specialist — and not even to a specialist whose card declares it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-rename-tool-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const renameTool = (await import("#core/agent/tools/handlers/rename-agent.js")).default;
const createTool = (await import("#core/agent/tools/handlers/create-agent.js")).default;
const { readAgents } = await import("#core/apc/parser.js");
const { readAgentMemory, writeAgentMemory } = await import("#core/agent/memory.js");
const { upsertRoutine, listRoutines } = await import("#core/stores/routines.js");
const { resolveAgentAllowedTools, defaultAgentToolNames, isMasterAgent } =
  await import("#core/agent/agent-tools.js");
const { createToolSession } = await import("#core/agent/tools/registry.js");
const { noteDeniedTools } = await import("#core/agent/tools/denied-log.js");
const { readGlobalMessages } = await import("#core/stores/messages.js");

let root, storage, entry, projects, ctx, rebuilt, asked;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "default", apx_id: "testapx00rn01" }),
  );
  entry = { id: 0, name: "default", path: root, storagePath: storage, apxId: "testapx00rn01" };
  rebuilt = [];
  asked = [];
  projects = {
    list: () => [entry],
    get: (id) => (String(id) === "0" ? entry : null),
    rebuild: (id) => rebuilt.push(id),
  };
  ctx = { projects, requirePermission: async (name) => { asked.push(name); } };
});

const rename = (args) => renameTool.makeHandler(ctx)(args);
const create = (args) => createTool.makeHandler(ctx)(args);

test("rename_agent moves the name, the slug, the memory and the pointers at once", async () => {
  await create({ slug: "orchestrator", name: "Orchestrator", system: "You coordinate the pipeline." });
  await create({ slug: "scout", parent: "orchestrator", system: "You research." });
  writeAgentMemory(entry, "orchestrator", "# Orchestrator\n- shipped the v2 pipeline\n");
  upsertRoutine(storage, {
    name: "pipeline-daily", kind: "exec_agent", schedule: "manual", spec: { agent: "orchestrator" },
  });

  const r = await rename({ agent: "orchestrator", name: "Arquitecto" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.agent, { from: "orchestrator", slug: "arquitecto", name: "Arquitecto" });
  assert.equal(asked.filter((n) => n === "rename_agent").length, 1, "asked for permission, once");
  assert.equal(rebuilt.at(-1), 0, "registry rebuilt so the daemon sees the new slug");

  const roster = readAgents(root);
  assert.ok(!roster.some((a) => a.slug === "orchestrator"), "the old slug stops resolving");
  const moved = roster.find((a) => a.slug === "arquitecto");
  assert.equal(moved.fields.Name, "Arquitecto");
  assert.match(moved.body, /You coordinate the pipeline\./);
  assert.equal(roster.find((a) => a.slug === "scout").fields.Parent, "arquitecto");
  assert.match(readAgentMemory(entry, "arquitecto"), /shipped the v2 pipeline/);
  assert.equal(listRoutines(storage)[0].spec.agent, "arquitecto");
  assert.equal(r.repointed.routines, 1);
  assert.deepEqual(moved.fields.Aliases, ["orchestrator"]);
});

test("rename_agent takes an explicit slug, and leaves the name alone", async () => {
  await create({ slug: "qa", name: "QA", system: "You review." });
  const r = await rename({ agent: "qa", slug: "revisora" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.agent.slug, "revisora");
  const moved = readAgents(root).find((a) => a.slug === "revisora");
  assert.equal(moved.fields.Name, "QA");
  assert.deepEqual(moved.fields.Aliases, ["qa"]);
});

test("rename_agent reports the prompts that still say the old name", async () => {
  await create({ slug: "nati", name: "Nati", system: "You are Nati." });
  await create({ slug: "helper", system: "Hand the finished brief to nati." });
  const r = await rename({ agent: "nati", name: "Vera" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(
    r.still_mentions.some((m) => m.agent === "helper" && m.where === "prompt"),
    `expected helper's prompt in ${JSON.stringify(r.still_mentions)}`,
  );
  // Reported, never rewritten: a slug is usually an ordinary word too.
  assert.match(readAgents(root).find((a) => a.slug === "helper").body, /to nati/);
});

test("rename_agent refuses a taken slug, an unusable one, and a no-op call", async () => {
  await create({ slug: "one", system: "x" });
  await create({ slug: "two", system: "y" });

  let r = await rename({ agent: "one", slug: "two" });
  assert.match(r.error, /already exists/i);
  assert.ok(readAgents(root).some((a) => a.slug === "one"), "nothing moved");

  r = await rename({ agent: "one", slug: "1Bad Slug" });
  assert.match(r.error, /not a usable slug/i);

  r = await rename({ agent: "one" });
  assert.match(r.error, /name or slug required/i);

  r = await rename({ agent: "ghost", name: "Whoever" });
  assert.match(r.error, /not found/i);
});

test("deleting an agent is an orchestrator's job too", () => {
  // `remove_agent` sat in the broad default, so any project agent could delete
  // any other one, irreversibly. It follows the role now, same as rename.
  assert.ok(!resolveAgentAllowedTools({ slug: "magui", fields: {} }).includes("remove_agent"));
  assert.ok(
    resolveAgentAllowedTools({ slug: "roby", fields: { Type: "orchestrator" } }).includes("remove_agent"),
  );
  // Declaring it on a specialist's card does not buy it either — the switch is
  // the role, not the paperwork.
  assert.ok(
    !resolveAgentAllowedTools({ slug: "magui", fields: { Tools: ["remove_agent"] } })
      .includes("remove_agent"),
  );
});

test("a specialist reaching for a role-gated tool lands on the log channel", () => {
  const specialist = { slug: "magui", fields: { Name: "Magui", Type: "specialist" } };
  const allowedTools = resolveAgentAllowedTools(specialist);
  const denied = [];
  const session = createToolSession("web", {
    allowedTools,
    onDenied: (names) => { denied.push(...names); noteDeniedTools(entry, specialist, names, "web"); },
  });

  // The gate refuses it, and nothing is activated.
  const r = session.activate({ names: ["remove_agent", "read_file"] });
  assert.deepEqual(r.denied, ["remove_agent"]);
  assert.ok(!session.activeNames.has("remove_agent"));
  assert.deepEqual(denied, ["remove_agent"]);

  // And it is written down where you can go and look at it — never pushed.
  const rows = readGlobalMessages({ channel: "log", limit: 20 });
  const note = rows.find((m) => m.meta?.kind === "tool_denied");
  assert.ok(note, `expected a tool_denied row, got ${JSON.stringify(rows.map((m) => m.meta?.kind))}`);
  assert.deepEqual(note.meta.tools, ["remove_agent"]);
  assert.equal(note.meta.agent_slug, "magui");
  assert.match(note.body, /Magui/);

  // An ordinary allowlist miss is not news: a narrowed card denies dozens every
  // turn, and logging those would bury the line that matters.
  const narrow = createToolSession("web", {
    allowedTools: ["read_file"],
    onDenied: (names) => noteDeniedTools(entry, specialist, names, "web"),
  });
  narrow.activate({ names: ["run_shell"] });
  assert.equal(
    readGlobalMessages({ channel: "log", limit: 20 }).filter((m) => m.meta?.kind === "tool_denied").length,
    1,
    "only the role-gated denial was recorded",
  );
});

test("the tool belongs to orchestrators — a specialist cannot reach it", () => {
  const specialist = { slug: "magui", fields: { Type: "specialist" } };
  const orchestrator = { slug: "roby", fields: { Type: "orchestrator" } };
  const master = { slug: "ceo", fields: { Master: "true" } };

  assert.equal(isMasterAgent(specialist), false);
  assert.ok(isMasterAgent(orchestrator) && isMasterAgent(master));

  assert.ok(!resolveAgentAllowedTools(specialist).includes("rename_agent"));
  assert.ok(resolveAgentAllowedTools(orchestrator).includes("rename_agent"));
  assert.ok(resolveAgentAllowedTools(master).includes("rename_agent"));

  // A HARD gate, unlike the host-only tier: the capability follows the role, so
  // writing it onto a specialist's card does not grant it.
  const declared = { slug: "magui", fields: { Tools: ["rename_agent", "read_file"] } };
  assert.ok(!resolveAgentAllowedTools(declared).includes("rename_agent"));
  assert.ok(resolveAgentAllowedTools(declared).includes("read_file"), "the rest of the card stands");
  assert.ok(
    resolveAgentAllowedTools({ ...declared, fields: { ...declared.fields, Type: "orchestrator" } })
      .includes("rename_agent"),
  );

  // Nor through a routine's allowed_tools override.
  assert.ok(!resolveAgentAllowedTools(specialist, { override: ["rename_agent"] }).includes("rename_agent"));

  // And a card that declares ONLY this tool is narrow, not broken: it must not
  // fall through to the whole default registry.
  const onlyMaster = resolveAgentAllowedTools({ slug: "x", fields: { Tools: ["rename_agent"] } });
  assert.ok(!onlyMaster.includes("run_shell"), "no accidental widening");

  // The web's tool picker draws grantable chips, and this is not one of them.
  assert.ok(!defaultAgentToolNames().includes("rename_agent"));
});
