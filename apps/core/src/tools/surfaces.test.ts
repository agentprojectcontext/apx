import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { surfaceTools } from "./surfaces.ts";
import type { ToolContext } from "./types.ts";

const widget = (connect?: string[]) => ({
  name: "btc-live",
  title: "BTC live",
  html: "<div id=p></div><script>fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')</script>",
  ...(connect ? { connect } : {}),
});
const KIT_APP =
  '<meta name="apx-surface" content="app"><script src="/_apx/kit@1.js"></script><div class="ax-app"><div class="ax-shell"><header class="ax-topbar">Habits</header></div></div>';
const calls: Record<string, object | [string, object]> = {
  "live widget": widget(["https://api.binance.com", "wss://stream.binance.com:9443"]),
  "same widget": widget(),
  "no network": widget([]),
  "bad origin": widget(["http://api.binance.com/v3"]),
  "as an app": { ...widget(), app: true, pin: true },
  "plain update": { ...widget(), app: false, pin: false },
  "make a widget": ["edit_widget", { name: "conversion", app: false }],
  "make an app": ["edit_widget", { name: "conversion", app: true }],
  "unpin converted": ["edit_widget", { name: "conversion", pin: false }],
  "bad conversion edit": [
    "edit_widget",
    { name: "conversion", app: false, edits: [{ old: "missing text", new: "x" }] },
  ],
  "published conversion edit": [
    "edit_widget",
    { name: "conversion", app: false, edits: [{ old: "Original", new: "Updated" }] },
  ],
  "list widgets": ["read_widget", {}],
  "read it": ["read_widget", { name: "btc-live" }],
  "edit it": ["edit_widget", { name: "btc-live", edits: [{ old: "<div id=p></div>", new: "<div id=price>$&</div>" }] }],
  "edit missing": ["edit_widget", { name: "btc-live", edits: [{ old: "<span>", new: "x" }] }],
  "edit nothing": ["edit_widget", { name: "no-such", edits: [{ old: "a", new: "b" }] }],
  "broken script": {
    name: "broken",
    title: "Broken",
    html: "<div></div>\n<script>\nconst a = {\n  x: 1\n  y: 2 };\n</script>",
  },
  "json and module": {
    name: "mixed",
    title: "Mixed",
    html: '<script type="application/json">{"a": 1 "b"}</script><script type="text/template">{{ ( }}</script><script>let x = 1;</script>\n<script type="module">import a from "./a.js";\nexport const b = 1;</script>',
  },
  "broken module": {
    name: "mixed-mod",
    title: "Mod",
    html: '<p></p>\n<script type="module">\nimport a from "./a.js";\nconst b = {\n x: 1\n y: 2};</script>',
  },
  "break the script": ["edit_widget", { name: "mixed", edits: [{ old: "let x = 1;", new: "let x = ;" }] }],
  "project widget": { name: "acme-sales", title: "Acme sales", html: "<p>sales</p>" },
  "read the global one": ["read_widget", { name: "btc-live" }],
  "kit app": { name: "habits", title: "Habits", html: KIT_APP },
  "kit app again": { name: "habits", title: "Habits", html: KIT_APP.replace("Habits", "Daily habits") },
  "read habits": ["read_widget", { name: "habits" }],
  "remember for it": ["edit_widget", { name: "habits", state: { streak: 4, draft: null } }],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content)}`);
  const c = calls[said];
  if (!c) return say("ok");
  return Array.isArray(c) ? callTool("w1", c[0], c[1]) : callTool("w1", "show_widget", c);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const said = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

test("a widget reaches only the origins it declares for live data, in the chat and once published", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "widgets" });
  assert.match(await said(t.id, "live widget"), /connecting to https:\/\/api\.binance\.com, wss:\/\/stream/);
  const { surfaces } = await env.client.call("surfaces.list", {});
  const id = surfaces.find((s) => s.name === "btc-live")?.id ?? "";
  assert.deepEqual((await env.client.call("surfaces.get", { surface: id })).connect, [
    "https://api.binance.com",
    "wss://stream.binance.com:9443",
  ]);

  // Published, its page lets those origins through and nothing else.
  const shared = await env.client.call("surfaces.share", { surface: id, shared: true });
  const page = await fetch(new URL(shared.share_path ?? "", env.core.url));
  assert.match(
    page.headers.get("content-security-policy") ?? "",
    /connect-src https:\/\/api\.binance\.com wss:\/\/stream\.binance\.com:9443;/,
  );
  await env.client.call("surfaces.share", { surface: id, shared: false });

  // Updated without connect it keeps them; [] takes them away.
  await said(t.id, "same widget");
  assert.equal((await env.client.call("surfaces.get", { surface: id })).connect?.length, 2);
  await said(t.id, "no network");
  assert.equal((await env.client.call("surfaces.get", { surface: id })).connect, undefined);

  // Only a bare https or wss origin: no plain http, no path.
  assert.match(await said(t.id, "bad origin"), /connect takes https:\/\/ or wss:\/\/ origins without a path/);
});

test("an agent reads a widget and changes a piece of it; where the owner put it stays", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "edits" });
  await said(t.id, "as an app");
  const id = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "btc-live")?.id ?? "";
  // An update that says app=false or pin=false does not take the widget off the sidebar or the board.
  await said(t.id, "plain update");
  const placed = await env.client.call("surfaces.get", { surface: id });
  assert.deepEqual([placed.app, placed.pinned], [true, true]);

  assert.match(await said(t.id, "list widgets"), /- btc-live: BTC live \(v\d+, pinned, app\)/);
  assert.match(await said(t.id, "read it"), /<html_source>\n<div id=p><\/div><script>/);
  const before = placed.version;
  assert.match(await said(t.id, "edit it"), new RegExp(`is now v${before + 1} \\(1 edit\\)`));
  const edited = await env.client.call("surfaces.get", { surface: id });
  assert.ok(edited.html.startsWith("<div id=price>$&</div><script>"), "the new text is written as is");
  const { messages } = await env.settle(t.id);
  const card = messages.at(-1)?.parts.find((p) => p.type === "surface");
  assert.equal(card?.type === "surface" && card.version, before + 1);

  assert.match(await said(t.id, "edit missing"), /edit 1: old was not found; nothing changed/);
  assert.equal((await env.client.call("surfaces.get", { surface: id })).version, before + 1);
  assert.match(await said(t.id, "edit nothing"), /no widget named no-such/);
});

test("a project's chat lists and reads only that project's widgets, and a chat outside one only the global ones", async () => {
  const loose = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "global" });
  assert.match(await said(loose.id, "live widget"), /shown, in no project/);
  const { project } = await env.client.call("projects.create", { name: "Acme" });
  const t = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "roby",
    title: "acme",
    project_id: project.id,
  });
  assert.doesNotMatch(await said(t.id, "project widget"), /in no project/);

  const inProject = await said(t.id, "list widgets");
  assert.match(inProject, /- acme-sales: Acme sales/);
  assert.doesNotMatch(inProject, /btc-live/);
  assert.match(await said(t.id, "read the global one"), /no widget named btc-live/);
  const outside = await said(loose.id, "list widgets");
  assert.match(outside, /- btc-live: BTC live/);
  assert.doesNotMatch(outside, /acme-sales/);

  const names = async (project_id?: string) =>
    (await env.client.call("surfaces.list", project_id ? { project_id } : {})).surfaces.map((s) => s.name).sort();
  assert.deepEqual(await names(project.id), ["acme-sales"]);
  assert.deepEqual(await names(), ["acme-sales", "btc-live"]);
});

test("a widget whose inline script does not parse is refused with its line; other blocks are not checked", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "syntax" });
  assert.match(
    await said(t.id, "broken script"),
    /refused: the script at line 5 \(column 3\) of the widget does not parse: Unexpected identifier 'y'/,
  );
  assert.match(await said(t.id, "broken module"), /line 6 \(column 2\).*does not parse/);
  assert.ok(!(await env.client.call("surfaces.list", {})).surfaces.some((s) => s.name === "broken"));

  // JSON and template blocks are skipped; classic and module scripts that parse pass.
  assert.match(await said(t.id, "json and module"), /widget "mixed" v1 shown/);
  const id = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "mixed")?.id ?? "";

  // An edit that breaks a script is refused and the stored widget stays as it was.
  assert.match(
    await said(t.id, "break the script"),
    /refused: the script at line 1 \(column \d+\).*does not parse.*call edit_widget again/,
  );
  const kept = await env.client.call("surfaces.get", { surface: id });
  assert.equal(kept.version, 1);
  assert.ok(kept.html.includes("let x = 1;"));
});

test("a widget is not saved when the turn stopped while its scripts were checked", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "stopped" });
  await said(t.id, "live widget");
  const before = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "btc-live");
  const saved: string[] = [];
  const ctx = {
    thread: { id: t.id },
    signal: AbortSignal.abort(),
    call: async (m: string) => {
      saved.push(m);
      throw new Error("nothing may be saved");
    },
    upsertPart: () => {},
  } as unknown as ToolContext;
  const tools = surfaceTools(env.core.store, env.home);
  const run = (name: string, args: object) =>
    (tools.find((x) => x.name === name) as unknown as { run(a: object, c: ToolContext): Promise<string> }).run(
      args,
      ctx,
    );
  const html = '<p></p><script type="module">export const a = 1;</script>';
  assert.match(await run("show_widget", { name: "never-saved", title: "Never", html }), /stopped: .*nothing changed/);
  assert.match(
    await run("edit_widget", { name: "btc-live", edits: [{ old: "<div id=p></div>", new: html }] }),
    /stopped: .*nothing changed/,
  );
  assert.match(await run("edit_widget", { name: "btc-live", app: false }), /stopped: .*nothing changed/);
  assert.deepEqual(saved, []);
  const list = (await env.client.call("surfaces.list", {})).surfaces;
  assert.ok(!list.some((s) => s.name === "never-saved"));
  assert.equal(list.find((s) => s.name === "btc-live")?.version, before?.version);
});

test("an agent converts a published app to a widget without reading or replacing its large HTML", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "conversion" });
  const original = await env.client.call("surfaces.show", {
    name: "conversion",
    title: "Original",
    html: `<p>Original ${"Long content ".repeat(3000)}</p>`,
    app: true,
    pinned: true,
    thread: t.id,
    connect: ["https://api.example.com"],
  });
  await env.client.call("surfaces.share", { surface: original.id, shared: true });
  const before = await env.client.call("surfaces.get", { surface: original.id });
  assert.match(await said(t.id, "make a widget"), /widget, pinned; HTML unchanged/);
  const converted = await env.client.call("surfaces.get", { surface: original.id });
  assert.equal(converted.app, false);
  assert.equal(converted.pinned, true);
  for (const key of ["id", "html", "version", "title", "thread_id", "project_id", "created_by", "share_path"] as const)
    assert.equal(converted[key], before[key], key);
  assert.deepEqual(converted.connect, before.connect);
  const { messages } = await env.settle(t.id);
  const part = messages.at(-1)?.parts.find((p) => p.type === "surface");
  assert.equal(part?.type === "surface" && part.version, before.version);

  assert.match(await said(t.id, "unpin converted"), /widget, not pinned; HTML unchanged/);
  assert.match(await said(t.id, "make an app"), /app, not pinned; HTML unchanged/);
  assert.match(await said(t.id, "bad conversion edit"), /nothing changed/);
  assert.equal((await env.client.call("surfaces.get", { surface: original.id })).app, true);
  assert.match(await said(t.id, "published conversion edit"), /published/);
  const kept = await env.client.call("surfaces.get", { surface: original.id });
  assert.equal(kept.app, true);
  assert.equal(kept.html, before.html);
  assert.equal(kept.version, before.version);

  const { project } = await env.client.call("projects.create", { name: "Northwind conversions" });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project.id });
  assert.match(await said(other.id, "make a widget"), /no widget named conversion/);
  assert.equal((await env.client.call("surfaces.get", { surface: original.id })).app, true);
});

test("a page written with the APX Kit is an app by its meta tag and gets the kit inline wherever it is served", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "kit" });
  assert.match(await said(t.id, "kit app"), /widget "habits" v1 shown.*listed as an app/);
  const id = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "habits")?.id ?? "";
  const doc = await env.client.call("surfaces.get", { surface: id });
  assert.equal(doc.app, true);
  assert.match(doc.html, /^<meta name="apx-surface" content="app"><script data-apx-kit>\/\*! APX Kit v1/);
  assert.doesNotMatch(doc.html, /<script src="\/_apx\/kit@1\.js"><\/script>/);
  // The agent reads and edits the page as written, never the kit.
  assert.match(
    await said(t.id, "read habits"),
    /<html_source>\n<meta name="apx-surface" content="app"><script src="\/_apx\/kit@1\.js">/,
  );

  const shared = await env.client.call("surfaces.share", { surface: id, shared: true });
  const res = await fetch(new URL(shared.share_path ?? "", env.core.url));
  assert.match(
    res.headers.get("content-security-policy") ?? "",
    /^sandbox allow-scripts allow-popups allow-forms;.*form-action 'none';/,
  );
  assert.match(await res.text(), /<script data-apx-kit>\/\*! APX Kit v1/);
  await env.client.call("surfaces.share", { surface: id, shared: false });
  const kit = await fetch(new URL("/_apx/kit@1.js", env.core.url));
  assert.match(kit.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(await kit.text(), /window\.APX = Object\.assign/);
});

test("a widget remembers between openings and versions; its agent reads it as data and changes it", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "memory" });
  await said(t.id, "kit app");
  const id = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "habits")?.id ?? "";
  const events: unknown[] = [];
  const off = env.core.bus.on((e) => {
    if (e.type === "surface.state") events.push(e.state);
  });
  const { state } = await env.client.call("surfaces.set_state", {
    surface: id,
    patch: { streak: 3, draft: "Walk </script> at 7", done: ["mon", "tue"] },
  });
  assert.deepEqual(state, { streak: 3, draft: "Walk </script> at 7", done: ["mon", "tue"] });
  assert.deepEqual(events.at(-1), state);

  // A new version of the page keeps what it remembered; the summary every client lists never carries it.
  await said(t.id, "kit app again");
  const doc = await env.client.call("surfaces.get", { surface: id });
  assert.deepEqual(doc.state, state);
  assert.ok(!("state" in ((await env.client.call("surfaces.list", {})).surfaces.find((s) => s.id === id) ?? {})));
  assert.match(await said(t.id, "read habits"), /<widget_state>\n\{"streak":3,"draft":"Walk <\/script> at 7"/);

  const version = doc.version;
  assert.match(await said(t.id, "remember for it"), /HTML unchanged; state: streak, draft changed/);
  const after = await env.client.call("surfaces.get", { surface: id });
  assert.deepEqual([after.state, after.version], [{ streak: 4, done: ["mon", "tue"] }, version]);

  await assert.rejects(
    env.client.call("surfaces.set_state", { surface: id, patch: { big: "x".repeat(70_000) } }),
    /state would be \d+ characters; the most is 64000/,
  );
  const { state: fresh } = await env.client.call("surfaces.set_state", { surface: id, patch: {}, replace: true });
  assert.deepEqual(fresh, {});
  assert.equal((await env.client.call("surfaces.get", { surface: id })).state, undefined);
  off();
});

test("read_widget names what an artifact keeps in its store and database, never the cached values", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "artifact memory" });
  await said(t.id, "kit app");
  const id = (await env.client.call("surfaces.list", {})).surfaces.find((s) => s.name === "habits")?.id ?? "";
  assert.match(await said(t.id, "read habits"), /\nmemory: store: empty; db: no tables/);
  await env.client.call("surfaces.store_set", { surface: id, patch: { reading: { value: "secret-looking 4821" } } });
  await env.client.call("surfaces.db_exec", { surface: id, sql: "CREATE TABLE entries (id INTEGER PRIMARY KEY)" });
  await env.client.call("surfaces.db_exec", { surface: id, sql: "INSERT INTO entries DEFAULT VALUES" });
  const read = await said(t.id, "read habits");
  assert.match(read, /\nmemory: store: 1 keys, \d+ bytes; db: entries \(1 rows\)/);
  assert.doesNotMatch(read, /4821/);
});

test("a page pushed from the terminal lands in the project it names, never one its thread is not in", async () => {
  const { project } = await env.client.call("projects.create", { name: "Northwind" });
  const pushed = await env.client.call("surfaces.show", {
    name: "expenses",
    title: "Expenses",
    html: "<p>built</p>",
    project: project.id,
  });
  assert.equal(pushed.project_id, project.id);
  const again = await env.client.call("surfaces.show", {
    name: "expenses",
    title: "Expenses",
    html: "<p>v2</p>",
    project: project.id,
  });
  assert.deepEqual([again.id, again.version], [pushed.id, pushed.version + 1]);
  const loose = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "elsewhere" });
  await assert.rejects(
    env.client.call("surfaces.show", {
      name: "expenses",
      title: "E",
      html: "<p></p>",
      thread: loose.id,
      project: project.id,
    }),
    /is not in project/,
  );
  await assert.rejects(
    env.client.call("surfaces.show", { name: "expenses", title: "E", html: "<p></p>", project: "p_missing" }),
    /project p_missing/,
  );
});
