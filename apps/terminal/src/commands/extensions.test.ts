import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { extensions } from "./extensions.ts";
import { printed, recordingClient } from "./testing.ts";

const extension = {
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  enabled: false,
  hash: "abc",
  description: "Acme tools",
  skills: ["review"],
  mcp: ["acme-mcp"],
  routines: [{ name: "Daily review" }],
  secrets: [{ name: "api", label: "API key", set: false }],
  plugin: { status: "failed", error: "invalid manifest", observe: ["task.changed"], context: true, network: true },
  runs_code: true,
};

test("extension inspect, install and toggles preserve exact protocol intent and show capabilities", async () => {
  for (const c of [
    { args: ["inspect", "./acme"], method: "extensions.inspect", params: { path: "./acme" } },
    { args: ["install", "./acme"], method: "extensions.install", params: { path: "./acme" } },
    { args: ["on", "acme"], method: "extensions.enable", params: { id: "acme", enabled: true } },
    { args: ["off", "acme"], method: "extensions.enable", params: { id: "acme", enabled: false } },
  ]) {
    const { client, calls } = recordingClient({ [c.method]: extension });
    const out = await printed(() => extensions(client, c.args, {}));
    assert.deepEqual(calls, [[c.method, c.params]]);
    for (const text of [
      "Acme v1.0.0",
      "skills: review",
      "mcp: acme-mcp",
      "routines: Daily review",
      "secret api: API key (missing)",
      "plugin: failed (invalid manifest); watches task.changed; adds context; internet",
      "runs code on this computer",
    ])
      assert.ok(out.includes(text), out);
    assert.equal(out.includes("Turn it on with:"), c.method === "extensions.install");
  }
});

test("extension list, removal and clearing a secret never request its value as argv", async () => {
  const { client, calls } = recordingClient({
    "extensions.list": { extensions: [extension] },
    "extensions.remove": { removed: true },
    "extensions.set_secret": extension,
  });
  assert.match(await printed(() => extensions(client, [], {})), /^acme {2}Acme/);
  assert.equal(await printed(() => extensions(client, ["rm", "acme"], {})), "removed");
  await printed(() => extensions(client, ["secret", "acme", "api"], { clear: true }));
  assert.deepEqual(calls, [
    ["extensions.list", {}],
    ["extensions.remove", { id: "acme" }],
    ["extensions.set_secret", { id: "acme", name: "api", value: null }],
  ]);
  const empty = recordingClient({ "extensions.list": { extensions: [] }, "extensions.remove": { removed: false } });
  assert.match(await printed(() => extensions(empty.client, [], {})), /^\(no extensions\)/);
  assert.equal(await printed(() => extensions(empty.client, ["rm", "missing"], {})), "no such extension");
});

test("incomplete extension commands have no side effect and install errors cannot print success", async () => {
  const error = new Error("manifest refused");
  const { client, calls } = recordingClient({ "extensions.install": error });
  for (const args of [["inspect"], ["install"], ["on"], ["off"], ["rm"], ["secret", "acme"], ["unknown"]])
    await assert.rejects(extensions(client, args, {}), /apx extensions/);
  assert.deepEqual(calls, []);
  assert.equal(
    await printed(async () => {
      await assert.rejects(extensions(client, ["install", "./acme"], {}), (e) => e === error);
    }),
    "",
  );
});

test("an .apxext on this computer is sent whole, an https address as given, a folder by its path", async () => {
  await using dir = tempDir("apx-cli-ext-");
  const file = path.join(dir.path, "acme.apxext");
  fs.writeFileSync(file, "PK-not-really");
  const update = {
    ...extension,
    provenance: "official",
    update: { from: "0.9.0", adds: [{ kind: "host", name: "api.acme.test" }], removes: [], keeps_on: false },
  };
  const { client, calls } = recordingClient({ "extensions.install": update, "extensions.rollback": update });
  const out = await printed(() => extensions(client, ["install", file], {}));
  await printed(() => extensions(client, ["install", "https://dl.example.com/acme.apxext"], {}));
  await printed(() => extensions(client, ["rollback", "acme"], {}));
  assert.deepEqual(calls, [
    ["extensions.install", { file: { name: "acme.apxext", data: Buffer.from("PK-not-really").toString("base64") } }],
    ["extensions.install", { url: "https://dl.example.com/acme.apxext" }],
    ["extensions.rollback", { id: "acme" }],
  ]);
  for (const text of ["· official", "over v0.9.0:", "+ reaches api.acme.test", "will be off until you turn it on"])
    assert.ok(out.includes(text), out);
  await assert.rejects(extensions(client, ["install", "http://dl.example.com/acme.apxext"], {}), /https/);
  await assert.rejects(extensions(client, ["install", path.join(dir.path, "none.apxext")], {}), /no file/);
  assert.equal(calls.length, 3);
});
