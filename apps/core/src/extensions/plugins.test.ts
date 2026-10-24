import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";

// A plugin that counts the task updates it sees and, asked for context, reports what its sandbox let it do.
const PLUGIN = `
import fs from "node:fs";
import path from "node:path";
let seen = 0;
const tryIt = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.code ?? "denied"; } };
export default function activate(api) {
  api.on("task.updated", () => { seen++; });
  api.context(async (input) => {
    const outside = await tryIt(() => fs.readFileSync(process.env.HOME_FILE ?? "/etc/hosts"));
    const exec = await tryIt(() => import("node:child_process"));
    const url = input.text.split(" ").find((w) => w.startsWith("http"));
    const core = url ? await tryIt(async () => { await fetch(url); }) : "none";
    const why = url ? await fetch(url).then(() => "", (e) => e.message) : "";
    const data = await tryIt(() => fs.writeFileSync(path.join(api.dataDir, "seen.txt"), String(seen)));
    const raw = await tryIt(() => process.getBuiltinModule("_http_client"));
    const port = url ? new URL(url).port : "1";
    const mapped = await tryIt(async () => { await fetch("http://[::ffff:127.0.0.1]:" + port + "/health"); });
    if (input.text.includes("garbage")) process.stdout.write(JSON.stringify({ t: "context", id: 1, text: { x: 1 } }) + "\\n");
    if (input.text.includes("flood")) process.stdout.write("x".repeat(200000));
    return "seen=" + seen + " secret=" + (api.secrets.token ?? "none") + " outside=" + outside + " exec=" + exec +
      " core=" + core + " (" + why + ") data=" + data + " raw=" + raw + " mapped=" + mapped + " asked=" + input.text;
  });
}
`;

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
const dirs: string[] = [];
const extension = (id: string, plugin: Record<string, unknown>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apx-plugin-${id}-`));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "plugin.mjs"), PLUGIN);
  fs.writeFileSync(
    path.join(dir, "apx-extension.json"),
    JSON.stringify({
      id,
      name: `Plugin ${id}`,
      version: "1.0.0",
      secrets: [{ name: "token", label: "Token" }],
      plugin: { entry: "plugin.mjs", ...plugin },
    }),
  );
  return dir;
};
const turnInput = async (text: string) => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id, 10_000);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  for (const d of dirs) await removeDir(d);
});

test("a plugin watches what it named and adds context to owner turns, as outside data", async () => {
  await env.client.call("extensions.install", {
    path: extension("watcher", { observe: ["task.updated"], context: true }),
  });
  await env.client.call("extensions.set_secret", { id: "watcher", name: "token", value: "plug-s3cret" });
  const on = await env.client.call("extensions.enable", { id: "watcher", enabled: true });
  assert.equal(on.runs_code, true);
  await waitFor(
    async () => (await env.client.call("extensions.list", {})).extensions[0]?.plugin?.status === "running",
    "plugin running",
    { ms: 8000 },
  );
  await env.client.call("tasks.create", { title: "Watch me" });
  await new Promise((r) => setTimeout(r, 300));
  const input = await turnInput(`hello ${env.core.url}`);
  assert.match(input, /\[extension context\]\n<extension_context from="Plugin watcher" trust="untrusted">/);
  assert.match(input, /seen=1 secret=plug-s3cret/);
  assert.match(input, /asked=hello/);
});

test("Test asks the plugin for context on a sample text, as a turn would", async () => {
  const r = await env.client.call("extensions.test", { id: "watcher", text: "sample words" });
  assert.equal(r.ok, true, r.error);
  assert.match(r.context ?? "", /asked=sample words/);
  await assert.rejects(env.client.call("extensions.test", { id: "nobody", text: "x" }), /not found/);
});

test("its sandbox: no files outside its folder, no processes, no reaching APX; its data folder is writable", async () => {
  const input = await turnInput(`check ${env.core.url}/health`);
  assert.match(input, /outside=ERR_ACCESS_DENIED/);
  assert.match(input, /exec=denied/);
  assert.match(input, /core=denied \(this plugin did not ask for the network\)/);
  assert.match(input, /data=ok/);
  assert.equal(fs.readFileSync(path.join(env.home, "extension-data", "watcher", "seen.txt"), "utf8"), "1");
});

test("one context provider at a time; off, it stops and turns get nothing from it", async () => {
  await env.client.call("extensions.install", { path: extension("second", { context: true, network: true }) });
  await assert.rejects(
    env.client.call("extensions.enable", { id: "second", enabled: true }),
    (e: unknown) => e instanceof ApxError && /already adds context/.test(e.message),
  );
  await env.client.call("extensions.enable", { id: "watcher", enabled: false });
  const off = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "watcher");
  assert.equal(off?.plugin?.status, "off");
  assert.doesNotMatch(await turnInput("anyone there?"), /extension context/);
  await env.client.call("extensions.enable", { id: "second", enabled: true });
  await waitFor(
    async () =>
      (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "second")?.plugin?.status ===
      "running",
    "second running",
    { ms: 8000 },
  );
  // With the network, this machine (where APX listens) stays out of reach.
  const input = await turnInput(`now ${env.core.url}/health`);
  assert.match(input, /from="Plugin second"/);
  assert.match(input, /core=denied \(127\.0\.0\.1 is not reachable from a plugin\)/);
  assert.match(input, /raw=denied/, "no private http modules");
  assert.match(input, /mapped=denied/, "no IPv4-mapped loopback");
  // Nor the local network, which it did not ask for.
  assert.match(await turnInput("now http://192.168.1.1:9/"), /core=denied \(192\.168\.1\.1 is not reachable/);
});

test("a misbehaving plugin cannot stall turns or APX: odd answers are ignored, a flood stops it", async () => {
  const before = await turnInput("garbage please");
  assert.match(before, /from="Plugin second"/);
  // The flood kills the plugin; the turn goes on without its context, and APX keeps answering.
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "flood please" });
  const { runs } = await env.settle(t.id, 10_000);
  assert.equal(runs.at(-1)?.state, "completed");
  assert.equal((await env.client.call("system.ping", { echo: "still here" })).pong, "still here");
});

test("reinstalling changed files while on stops the plugin until approved again", async () => {
  const dir = dirs.find((d) => d.includes("apx-plugin-second-")) ?? "";
  fs.appendFileSync(path.join(dir, "plugin.mjs"), "\n// changed\n");
  const again = await env.client.call("extensions.install", { path: dir });
  assert.equal(again.enabled, false);
  assert.equal(again.plugin?.status, "off");
  assert.doesNotMatch(await turnInput("after reinstall"), /extension context/);
});

test("names inside an extension cannot be read two ways", async () => {
  const dir = extension("clash", {});
  const m = JSON.parse(fs.readFileSync(path.join(dir, "apx-extension.json"), "utf8"));
  m.secrets = [{ name: "b-c", label: "x" }];
  fs.writeFileSync(path.join(dir, "apx-extension.json"), JSON.stringify(m));
  await assert.rejects(env.client.call("extensions.install", { path: dir }), (e: unknown) => e instanceof ApxError);
});
