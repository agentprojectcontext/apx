import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

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
    const url = input.text.split(" ")[1];
    const core = url ? await tryIt(async () => { await fetch(url); }) : "none";
    const why = url ? await fetch(url).then(() => "", (e) => e.message) : "";
    const data = await tryIt(() => fs.writeFileSync(path.join(api.dataDir, "seen.txt"), String(seen)));
    return "seen=" + seen + " secret=" + (api.secrets.token ?? "none") + " outside=" + outside + " exec=" + exec +
      " core=" + core + " (" + why + ") data=" + data + " asked=" + input.text;
  });
}
`;

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
const dirs: string[] = [];
const extension = (id: string, plugin: Record<string, unknown>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apx2-plugin-${id}-`));
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
const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`never: ${what}`);
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
  env.cleanup();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("a plugin watches what it named and adds context to owner turns, as outside data", async () => {
  await env.client.call("extensions.install", {
    path: extension("watcher", { observe: ["task.updated"], context: true }),
  });
  await env.client.call("extensions.set_secret", { id: "watcher", name: "token", value: "plug-s3cret" });
  const on = await env.client.call("extensions.enable", { id: "watcher", enabled: true });
  assert.equal(on.runs_code, true);
  await until(
    async () => (await env.client.call("extensions.list", {})).extensions[0]?.plugin?.status === "running",
    "plugin running",
  );
  await env.client.call("tasks.create", { title: "Watch me" });
  await new Promise((r) => setTimeout(r, 300));
  const input = await turnInput(`hello ${env.core.url}`);
  assert.match(input, /\[extension context\]\n<extension_context from="Plugin watcher" trust="untrusted">/);
  assert.match(input, /seen=1 secret=plug-s3cret/);
  assert.match(input, /asked=hello/);
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
  await until(
    async () =>
      (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "second")?.plugin?.status ===
      "running",
    "second running",
  );
  // With the network, this machine (where APX listens) stays out of reach.
  const input = await turnInput(`now ${env.core.url}/health`);
  assert.match(input, /from="Plugin second"/);
  assert.match(input, /core=denied \(127\.0\.0\.1 is not reachable from a plugin\)/);
});
