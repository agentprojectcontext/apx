import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_SCHEMAS,
  BASE_TOOL_SCHEMAS,
  BASE_TOOL_NAMES,
  createToolSession,
  buildLazyToolsBlock,
  makeToolHandlers,
} from "#core/agent/tools/registry.js";
import { TOOL_DEFINITIONS } from "#core/http-tools/catalog.js";

const nameOf = (s) => s?.function?.name || s?.name;

// Derived, not typed in: the browser category grows (browser_snapshot was the
// twelfth), and a literal here only ever fails the next person to add a tool.
const BROWSER_TOOL_COUNT = TOOL_DEFINITIONS.filter((t) => t.category === "browser").length;

test("base set is a strict, smaller subset of the full registry", () => {
  assert.ok(BASE_TOOL_SCHEMAS.length < TOOL_SCHEMAS.length);
  // A band, not a number: the base set is allowed to grow, but not quietly.
  // It went to 29 when complete_task and mark_commitment joined the halves that
  // were already hot (~+480 tokens on every lightweight turn) — the asymmetry
  // was costing more than the tokens, see BASE_TOOL_NAMES.
  assert.ok(BASE_TOOL_SCHEMAS.length >= 20 && BASE_TOOL_SCHEMAS.length <= 30);
  const full = new Set(TOOL_SCHEMAS.map(nameOf));
  for (const s of BASE_TOOL_SCHEMAS) assert.ok(full.has(nameOf(s)));
  // discover_tools must be in the base set — it's the entry point to the rest.
  assert.ok(BASE_TOOL_NAMES.has("discover_tools"));
  assert.ok(BASE_TOOL_SCHEMAS.map(nameOf).includes("discover_tools"));
});

test("browser tools are NOT in the base set but ARE in the full registry", () => {
  const base = new Set(BASE_TOOL_SCHEMAS.map(nameOf));
  const full = new Set(TOOL_SCHEMAS.map(nameOf));
  for (const t of ["browser_navigate", "browser_screenshot", "browser_click"]) {
    assert.ok(!base.has(t), `${t} should not be in base`);
    assert.ok(full.has(t), `${t} should be in full`);
  }
});

test("telegram session starts on base and lists everything else as not-loaded", () => {
  const s = createToolSession("telegram");
  assert.equal(s.initialSchemas.length, BASE_TOOL_SCHEMAS.length);
  const notLoaded = s.notLoaded().map((m) => m.name);
  assert.ok(notLoaded.includes("browser_navigate"));
  assert.ok(notLoaded.includes("web_search"));
  assert.equal(s.initialSchemas.length + notLoaded.length, TOOL_SCHEMAS.length);
});

test("full channels load everything and produce no lazy block", () => {
  for (const ch of ["web", "code", "routine", "api"]) {
    const s = createToolSession(ch);
    assert.equal(s.initialSchemas.length, TOOL_SCHEMAS.length, `${ch} should be full`);
    assert.equal(s.notLoaded().length, 0, `${ch} should have nothing on-demand`);
    assert.equal(buildLazyToolsBlock(s), "");
  }
});

test("activate by category reveals schemas via pending", () => {
  const s = createToolSession("telegram");
  const r = s.activate({ category: "browser" });
  assert.equal(r.activated.length, BROWSER_TOOL_COUNT);
  assert.equal(s.pending.length, BROWSER_TOOL_COUNT);
  assert.ok(s.activeNames.has("browser_navigate"));
  // pending carries real schemas the agent loop can merge
  assert.ok(s.pending.every((sc) => typeof nameOf(sc) === "string"));
});

test("activate dedupes, reports unknown, and keeps already-loaded out of pending", () => {
  const s = createToolSession("telegram");
  s.activate({ names: ["http_get"] });
  s.pending = []; // simulate the loop draining
  const r = s.activate({ names: ["http_get", "browser_click", "send_telegram", "nope"] });
  assert.deepEqual(r.activated, ["browser_click"]);
  assert.ok(r.already_loaded.includes("http_get")); // re-requested, already active
  assert.ok(r.already_loaded.includes("send_telegram")); // base tool
  assert.deepEqual(r.unknown, ["nope"]);
  assert.equal(s.pending.length, 1);
});

test("role gate is enforced on the initial set and on activation", () => {
  const guest = createToolSession("telegram", { allowedTools: ["send_telegram", "list_tasks"] });
  assert.deepEqual(guest.initialSchemas.map(nameOf).sort(), ["list_tasks", "send_telegram"]);
  const r = guest.activate({ category: "browser" });
  assert.equal(r.activated.length, 0);
  assert.equal(r.denied.length, BROWSER_TOOL_COUNT);
  assert.equal(guest.pending.length, 0);

  const muted = createToolSession("telegram", { allowedTools: [] });
  assert.equal(muted.initialSchemas.length, 0);
  assert.equal(muted.activate({ category: "browser" }).activated.length, 0);
});

test("discover_tools catalog groups not-loaded tools by category", () => {
  const s = createToolSession("telegram");
  const handlers = makeToolHandlers({ projects: { list: () => [] }, globalConfig: {}, toolSession: s });
  const cat = handlers.discover_tools({});
  assert.equal(cat.ok, true);
  assert.ok(cat.categories.browser.length === BROWSER_TOOL_COUNT);
  assert.equal(cat.loaded_count, BASE_TOOL_SCHEMAS.length);

  // activation through the handler mutates the session
  const act = handlers.discover_tools({ names: ["browser_navigate"] });
  assert.deepEqual(act.activated, ["browser_navigate"]);
  assert.ok(s.pending.some((sc) => nameOf(sc) === "browser_navigate"));
});

test("discover_tools without a session reports everything already loaded", () => {
  const handlers = makeToolHandlers({ projects: { list: () => [] }, globalConfig: {} });
  const r = handlers.discover_tools({});
  assert.equal(r.loaded_all, true);
});

test("lazy block lists not-loaded tool names without schemas", () => {
  const block = buildLazyToolsBlock(createToolSession("telegram"));
  assert.match(block, /discover_tools/);
  assert.match(block, /browser_navigate/);
  // names only — no JSON schema noise
  assert.ok(!block.includes('"parameters"'));
});

// ── the pairs that must not be split ─────────────────────────────────────────

test("a hot half never ships without its write-back half", () => {
  // The gap that bit on 2026-08-27: create_task and list_tasks were in the base
  // set, complete_task was not. On Telegram the model could open a task and read
  // it back but not close one — so, seeing the name in the lazy block and no
  // schema, it invented `complete_task({project, id})`, got "task required"
  // twice, and left the task open. Same shape for commitments, where the
  // unresolvable one had been in the watcher's signals since July 2025.
  for (const [read, write] of [
    ["list_tasks", "complete_task"],
    ["list_commitments", "mark_commitment"],
  ]) {
    assert.ok(BASE_TOOL_NAMES.has(read), `${read} is hot`);
    assert.ok(BASE_TOOL_NAMES.has(write), `${write} must be hot too — ${read} is`);
  }
});

// ── calling a tool whose schema was never sent ───────────────────────────────

test("run-agent: a call to an unloaded tool activates it and returns the schema, and runs nothing", async () => {
  // The model can SEE unloaded tool NAMES (that is what buildLazyToolsBlock is
  // for) and providers do not all refuse a call to a tool that was not in the
  // request. Executing it means executing guessed arguments — which is how a
  // task got closed with `id` against a schema that says `task`.
  const { runAgent } = await import("#core/agent/run-agent.js");
  const session = createToolSession("telegram");
  const executed = [];
  const result = await runAgent({
    globalConfig: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total", model_fallback: { enabled: false } }, engines: {} },
    system: "sys",
    prompt: "[mock:tool:web_search] buscá precios",
    toolSchemas: session.initialSchemas,
    makeToolHandlers: () => ({ web_search: async (args) => { executed.push(args); return { ok: true }; } }),
    toolHandlerCtx: { toolSession: session, globalConfig: {}, projects: { list: () => [] } },
    maxIters: 2,
  });
  const call = (result.trace || []).find((t) => t.tool === "web_search");
  assert.ok(call, "the call was made");
  assert.equal(executed.length, 0, "guessed arguments never reached the handler");
  assert.match(call.result.error, /was not loaded/);
  assert.equal(call.result.activated, "web_search");
  assert.ok(call.result.schema?.parameters, "the model gets the schema it was missing");
  assert.ok(session.activeNames.has("web_search"), "and the retry has the tool");
});

test("run-agent: a tool the role gate denies is refused, not run, even when the name is guessed", async () => {
  // The gate only ever filtered the schemas the model was SENT. The handler map
  // holds every tool, so a guessed name walked straight past it.
  const { runAgent } = await import("#core/agent/run-agent.js");
  const session = createToolSession("telegram", { allowedTools: ["list_tasks"] });
  const executed = [];
  const result = await runAgent({
    globalConfig: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total", model_fallback: { enabled: false } }, engines: {} },
    system: "sys",
    prompt: "[mock:tool:run_shell] borrá todo",
    toolSchemas: session.initialSchemas,
    makeToolHandlers: () => ({ run_shell: async (args) => { executed.push(args); return { ok: true }; } }),
    toolHandlerCtx: { toolSession: session, globalConfig: {}, projects: { list: () => [] } },
    maxIters: 2,
  });
  const call = (result.trace || []).find((t) => t.tool === "run_shell");
  assert.ok(call);
  assert.equal(executed.length, 0);
  assert.match(call.result.error, /not available to you/);
  assert.ok(!session.activeNames.has("run_shell"));
});
