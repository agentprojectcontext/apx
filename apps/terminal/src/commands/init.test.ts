import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { ApxClient } from "@apx/protocol/client";
import { init } from "./init.ts";
import { printed } from "./testing.ts";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-init-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));

/** Stands in for the core: registering with init writes what is missing, as the core does. */
function fakeCore(registered: string[] = []) {
  const calls: [string, Record<string, unknown>][] = [];
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push([method, params]);
      if (method === "projects.list") return { projects: registered.map((p) => ({ id: "p1", name: "x", path: p })) };
      if (method !== "projects.register") throw new Error(`unexpected call ${method}`);
      const dir = String(params.path);
      if (!fs.existsSync(path.join(dir, "AGENTS.md")))
        fs.writeFileSync(path.join(dir, "AGENTS.md"), `# ${path.basename(dir)}\n`);
      fs.mkdirSync(path.join(dir, ".apc"), { recursive: true });
      return { project: { id: "p1", name: path.basename(dir), present: true, path: dir }, agents: 0 };
    },
  } as unknown as ApxClient;
  return { client, calls };
}

test("apx init registers this folder by default, through the core, and says what it created", async () => {
  const dir = path.join(root, "northwind");
  fs.mkdirSync(dir);
  const { client, calls } = fakeCore();
  const out = await printed(() => init(client, [], { cwd: dir }));
  assert.deepEqual(calls.at(-1), ["projects.register", { path: dir, init: true }]);
  assert.match(out, /^Registered northwind \(p1\) · 0 agents/);
  assert.match(out, /Created AGENTS\.md\n {2}Created \.apc\//);
  assert.match(out, /Next: apx agents new <slug> "<Name>" --project p1/);
});

test("apx init on a registered folder with its files writes nothing and says so", async () => {
  const dir = path.join(root, "acme");
  fs.mkdirSync(path.join(dir, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Acme\n\nUse metric units.\n");
  const { client } = fakeCore([dir]);
  const out = await printed(() => init(client, ["acme"], { cwd: root }));
  assert.match(out, /^Already a project in APX: acme/);
  assert.match(out, /Nothing written/);
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "# Acme\n\nUse metric units.\n");
  const json = JSON.parse(await printed(() => init(client, [dir], { json: true })));
  assert.deepEqual([json.already, json.created], [true, []]);
});

test("apx init help is help, and a second folder is refused", async () => {
  const { client, calls } = fakeCore();
  assert.match(await printed(() => init(client, ["help"])), /^apx init \[folder\]/);
  await assert.rejects(init(client, ["a", "b"]), /usage: apx init/);
  assert.equal(calls.length, 0);
});
