import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { readArchive } from "./package.ts";
import { catalogOf, zipFiles } from "./zip.test-support.ts";

const CATALOG = "https://catalog.example.com/index.json";
/** What the stand-in net serves: the catalog and .apxext downloads. */
const served = new Map<string, Buffer | string>();

const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  id: "weather",
  name: "Weather",
  version,
  description: "Forecasts for agents.",
  skills: "skills",
  mcp: { forecast: { url: "https://api.weather.example.com/mcp", headers: { Authorization: "Bearer secret://key" } } },
  secrets: [{ name: "key", label: "API key" }],
  ...extra,
});
const archive = (version: string, extra: Record<string, unknown> = {}, readme = "Weather.") =>
  zipFiles({
    "apx-extension.json": JSON.stringify(manifest(version, extra)),
    "skills/forecast/SKILL.md": "---\nname: forecast\ndescription: Forecasts.\n---\nAsk the forecast tools.\n",
    "README.md": readme,
  });
const file = (buf: Buffer, name = "weather.apxext") => ({ name, data: buf.toString("base64") });
const refused = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof ApxError && re.test(e.message));

const v1 = archive("1.0.0");
const v11 = archive("1.1.0", {}, "Weather, with a better README.");
const v12 = archive("1.2.0", {
  mcp: {
    forecast: { url: "https://api.weather.example.com/mcp", headers: { Authorization: "Bearer secret://key" } },
    radar: { url: "https://radar.northwind.test/mcp" },
  },
});
const official = [v1, v11, v12].map((b) => {
  const p = readArchive(b);
  return { id: p.manifest.id, version: p.manifest.version, hash: p.hash };
});

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;
const extDir = () => path.join(home.path, "extensions");

before(async () => {
  home = tempDir("apx-apxext-");
  served.set(CATALOG, catalogOf(official));
  served.set("https://dl.example.com/weather-1.1.0.apxext", v11);
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    marketplaceIndex: CATALOG,
    extensionFetch: (async (url: string | URL) => {
      const body = served.get(String(url));
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    }) as typeof fetch,
  });
});
after(async () => {
  await env.core.close();
  await home.remove();
});

test("an .apxext is inspected without writing anything, then installed off and marked Official by its fingerprint", async () => {
  const seen = await env.client.call("extensions.inspect", { file: file(v1) });
  assert.equal(seen.provenance, "official");
  assert.equal(seen.enabled, false);
  assert.deepEqual(seen.skills, ["forecast"]);
  assert.deepEqual(seen.mcp, ["weather-forecast"]);
  assert.equal(seen.source, "weather.apxext");
  assert.equal(fs.existsSync(path.join(extDir(), "weather")), false);

  await refused(env.client.call("extensions.install", { file: file(v1), hash: "0000000000000000" }), /looked at/);
  const info = await env.client.call("extensions.install", { file: file(v1), hash: seen.hash });
  assert.equal(info.provenance, "official");
  assert.equal(info.enabled, false);
  assert.equal(info.update, undefined);
  // The staging folder is gone; only the copy remains.
  assert.deepEqual(fs.readdirSync(extDir()), ["weather"]);

  // One byte changed: the same id and version, but not the files the catalog lists.
  const touched = archive("1.0.0", {}, "Weather!");
  const third = await env.client.call("extensions.inspect", { file: file(touched) });
  assert.equal(third.provenance, "third_party");
  assert.equal(third.update?.from, "1.0.0");
});

test("a hostile archive or a plain http address is refused before anything is written", async () => {
  const before = fs.readdirSync(extDir());
  await refused(
    env.client.call("extensions.install", {
      file: file(zipFiles({ "apx-extension.json": JSON.stringify(manifest("9.0.0")), "../../escape": "x" })),
    }),
    /outside/,
  );
  await refused(env.client.call("extensions.inspect", { url: "http://dl.example.com/weather.apxext" }), /invalid/);
  await refused(env.client.call("extensions.inspect", { url: "https://dl.example.com/none.apxext" }), /404/);
  await refused(env.client.call("extensions.inspect", { path: home.path, url: "https://dl.example.com/x" }), /invalid/);
  assert.deepEqual(fs.readdirSync(extDir()), before);
});

test("an update: official and asking for nothing more stays on; one that reaches a new host waits; going back works", async () => {
  await env.client.call("extensions.enable", { id: "weather", enabled: true });

  // From a URL, official, nothing more: it stays on, with the version before kept beside it.
  const url = "https://dl.example.com/weather-1.1.0.apxext";
  const look = await env.client.call("extensions.inspect", { url });
  assert.deepEqual(look.update, { from: "1.0.0", adds: [], removes: [], keeps_on: true });
  const on = await env.client.call("extensions.install", { url, hash: look.hash });
  assert.equal(on.version, "1.1.0");
  assert.equal(on.enabled, true);
  assert.equal(on.source, url);
  assert.ok(fs.existsSync(path.join(extDir(), "weather.prev")));

  // Official, but reaching a new host: shown before, and off until the owner turns it on.
  const more = await env.client.call("extensions.inspect", { file: file(v12) });
  assert.equal(more.update?.keeps_on, false);
  assert.deepEqual(
    more.update?.adds.map((p) => `${p.kind}:${p.name}`),
    ["mcp:radar", "host:radar.northwind.test"],
  );
  const off = await env.client.call("extensions.install", { file: file(v12) });
  assert.equal(off.enabled, false);
  assert.equal(off.update?.from, "1.1.0");
  assert.equal(off.update?.adds.length, 2);

  // Back to 1.1.0, as it was approved (on); and forward again to 1.2.0, still waiting.
  const back = await env.client.call("extensions.rollback", { id: "weather" });
  assert.equal(back.version, "1.1.0");
  assert.equal(back.enabled, true);
  assert.equal(back.update?.from, "1.2.0");
  const forward = await env.client.call("extensions.rollback", { id: "weather" });
  assert.equal(forward.version, "1.2.0");
  assert.equal(forward.enabled, false);

  // A third-party update of one that is on goes off, however little it changes.
  await env.client.call("extensions.rollback", { id: "weather" });
  const tweaked = await env.client.call("extensions.install", { file: file(archive("1.1.0", {}, "Changed.")) });
  assert.equal(tweaked.provenance, "third_party");
  assert.equal(tweaked.enabled, false);

  // A kept version changed on disk is not brought back.
  fs.writeFileSync(path.join(extDir(), "weather.prev", "README.md"), "edited");
  await refused(env.client.call("extensions.rollback", { id: "weather" }), /changed on disk/);

  assert.deepEqual(await env.client.call("extensions.remove", { id: "weather" }), { removed: true });
  assert.deepEqual(fs.readdirSync(extDir()), []);
  await refused(env.client.call("extensions.rollback", { id: "weather" }), /not found/);
});
