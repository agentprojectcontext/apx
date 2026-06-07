import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_SCHEMAS,
  BASE_TOOL_SCHEMAS,
  BASE_TOOL_NAMES,
  createToolSession,
  buildLazyToolsBlock,
  makeToolHandlers,
} from "../src/host/daemon/super-agent-tools/index.js";

const nameOf = (s) => s?.function?.name || s?.name;

test("base set is a strict, smaller subset of the full registry", () => {
  assert.ok(BASE_TOOL_SCHEMAS.length < TOOL_SCHEMAS.length);
  assert.ok(BASE_TOOL_SCHEMAS.length >= 20 && BASE_TOOL_SCHEMAS.length <= 26);
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
  for (const ch of ["web", "code", "terminal", "routine", "api"]) {
    const s = createToolSession(ch);
    assert.equal(s.initialSchemas.length, TOOL_SCHEMAS.length, `${ch} should be full`);
    assert.equal(s.notLoaded().length, 0, `${ch} should have nothing on-demand`);
    assert.equal(buildLazyToolsBlock(s), "");
  }
});

test("activate by category reveals schemas via pending", () => {
  const s = createToolSession("telegram");
  const r = s.activate({ category: "browser" });
  assert.equal(r.activated.length, 11);
  assert.equal(s.pending.length, 11);
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
  assert.equal(r.denied.length, 11);
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
  assert.ok(cat.categories.browser.length === 11);
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
