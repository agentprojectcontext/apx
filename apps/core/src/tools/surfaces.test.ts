import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const widget = (connect?: string[]) => ({
  name: "btc-live",
  title: "BTC live",
  html: "<div id=p></div><script>fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')</script>",
  ...(connect ? { connect } : {}),
});
const calls: Record<string, object | [string, object]> = {
  "live widget": widget(["https://api.binance.com", "wss://stream.binance.com:9443"]),
  "same widget": widget(),
  "no network": widget([]),
  "bad origin": widget(["http://api.binance.com/v3"]),
  "as an app": { ...widget(), app: true, pin: true },
  "plain update": { ...widget(), app: false, pin: false },
  "list widgets": ["read_widget", {}],
  "read it": ["read_widget", { name: "btc-live" }],
  "edit it": ["edit_widget", { name: "btc-live", edits: [{ old: "<div id=p></div>", new: "<div id=price>$&</div>" }] }],
  "edit missing": ["edit_widget", { name: "btc-live", edits: [{ old: "<span>", new: "x" }] }],
  "edit nothing": ["edit_widget", { name: "no-such", edits: [{ old: "a", new: "b" }] }],
  "project widget": { name: "acme-sales", title: "Acme sales", html: "<p>sales</p>" },
  "read the global one": ["read_widget", { name: "btc-live" }],
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
  env.cleanup();
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
  assert.match(await said(t.id, "bad origin"), /invalid arguments for show_widget: connect\.0/);
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
