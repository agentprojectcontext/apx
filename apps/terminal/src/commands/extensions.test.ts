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
  settings: [
    { name: "region", label: "Region", type: "string", sensitive: false, required: false, value: "eu", set: true },
  ],
  agents: [{ id: "host", name: "Night host" }],
  pages: [],
  apps: [],
  companion: { name: "Acme TV", platform: "android-tv" },
};

test("extension inspect, install and toggles preserve exact protocol intent and show capabilities", async () => {
  for (const c of [
    // A folder is where the person is, not where the core runs; "~" is the core's to resolve.
    { args: ["inspect", "./acme"], method: "extensions.inspect", params: { path: path.resolve("acme") } },
    { args: ["install", "~/work/acme"], method: "extensions.install", params: { path: "~/work/acme" } },
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
      'setting region: Region ("eu")',
      "agent Night host",
      "companion app: Acme TV (android-tv)",
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

test("the catalog lists each offer with what it brings and where to install it from", async () => {
  const { client, calls } = recordingClient({
    "extensions.catalog": {
      entries: [
        {
          id: "weather",
          name: "Weather",
          description: "Forecasts.",
          categories: [],
          version: "1.0.0",
          provenance: "official",
          url: "https://dl.example.com/weather.apxext",
          brings: ["tools"],
          needs: ["cost"],
        },
        {
          id: "notes",
          name: "Notes",
          description: "Notes for agents.",
          categories: [],
          version: "0.0.0",
          provenance: "third_party",
          catalog: "c1",
        },
      ],
    },
    "extensions.install": extension,
  });
  const out = await printed(() => extensions(client, ["catalog"], {}));
  for (const text of [
    "weather  Weather v1.0.0  · official",
    "tools, needs cost",
    "https://dl.example.com/weather.apxext",
    "notes  Notes  · third party",
    "catalog:c1/notes",
  ])
    assert.ok(out.includes(text), out);
  // An added catalog's entry installs by the address the list printed.
  await printed(() => extensions(client, ["install", "catalog:c1/notes"], {}));
  assert.deepEqual(calls, [
    ["extensions.catalog", {}],
    ["extensions.install", { entry: { catalog: "c1", id: "notes" } }],
  ]);
});

test("settings are set as name=value pairs; a sensitive one can come from stdin", async () => {
  const { client, calls } = recordingClient({
    "extensions.settings": { ...extension, settings: [], agents: [], apps: [] },
  });
  await printed(() => extensions(client, ["set", "acme", "region=eu", "volume=12"], {}));
  assert.deepEqual(calls, [["extensions.settings", { id: "acme", values: { region: "eu", volume: "12" } }]]);
  await assert.rejects(extensions(client, ["set", "acme", "region"], {}), /apx extensions/);
});

test("your own catalogs: add one by its address, see what it left out", async () => {
  const catalog = {
    id: "c1",
    name: "Acme",
    source: "acme/plugins",
    kind: "claude",
    count: 2,
    skipped: [{ name: "closed", reason: "license" }],
  };
  const { client, calls } = recordingClient({ "extensions.catalog_add": catalog });
  const out = await printed(() => extensions(client, ["catalogs", "add", "acme/plugins"], {}));
  assert.deepEqual(calls, [["extensions.catalog_add", { source: "acme/plugins" }]]);
  assert.ok(out.includes("left out closed: license"), out);
});

test("pack writes the core's .apxext where the person is, or to the file they name", async () => {
  await using dir = tempDir("apx-cli-pack-");
  const packed = { name: "acme-1.0.0.apxext", data: Buffer.from("PK zip").toString("base64"), hash: "abc", size: 6 };
  const { client, calls } = recordingClient({ "extensions.pack": packed });
  const out = path.join(dir.path, "shared.apxext");
  const printedOut = await printed(() => extensions(client, ["pack", path.join(dir.path, "acme"), out], {}));
  assert.deepEqual(calls, [["extensions.pack", { path: path.join(dir.path, "acme") }]]);
  assert.equal(fs.readFileSync(out, "utf8"), "PK zip");
  assert.ok(printedOut.includes("apx extensions install"), printedOut);
  await assert.rejects(extensions(client, ["pack", "./acme", path.join(dir.path, "acme.zip")], {}), /\.apxext/);
});
