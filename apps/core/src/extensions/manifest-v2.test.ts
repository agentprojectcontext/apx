import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";

const refused = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof ApxError && re.test(e.message));

const BUNDLE = {
  format: "apx-artifact@1",
  manifest: { name: "tv-remote", title: "TV remote", kind: "widget", version: 1 },
  html: "<!doctype html><p>remote</p>",
};
const manifest = (extra: Record<string, unknown> = {}) => ({
  manifest: 2,
  id: "living_tv",
  name: "Living TV",
  version: "1.0.0",
  skills: "skills",
  mcp: {
    remote: {
      command: "node",
      args: ["./server.mjs", "--region", "setting://region"],
      env: { TV_KEY: "secret://connection_key" },
    },
  },
  settings: [
    {
      name: "region",
      label: "Region",
      description: "Choose a region.",
      locales: { es: { label: "Región", description: "Elegí una región." } },
      type: "string",
      options: ["us", "eu"],
      default: "us",
    },
    { name: "volume", label: "Starting volume", type: "number" },
    { name: "library", label: "Media folder", type: "directory", required: true },
    { name: "connection_key", label: "Connection key", type: "string", sensitive: true, generate: "random" },
  ],
  agents: [
    { id: "host", name: "Movie night host", description: "Picks and plays.", prompt: "Pick a movie and play it." },
  ],
  pages: [{ id: "setup", title: "Set up the TV", entry: "pages/setup.html" }],
  apps: [{ file: "apps/remote.apxart", name: "Remote" }],
  hosts: ["tv.example.com"],
  companion: {
    name: "APX TV",
    platform: "android-tv",
    file: "tv.apk",
    steps: ["Install APX TV", "Open it and type the code"],
    pairing: { with: "extension", server: "remote", tool: "tv_pairing" },
  },
  ...extra,
});

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;
let src: TempDir;
const write = (m: unknown) => fs.writeFileSync(path.join(src.path, "apx-extension.json"), JSON.stringify(m));

before(async () => {
  home = tempDir("apx-v2-home-");
  src = tempDir("apx-v2-src-");
  fs.mkdirSync(path.join(src.path, "skills", "tv"), { recursive: true });
  fs.mkdirSync(path.join(src.path, "pages"));
  fs.mkdirSync(path.join(src.path, "apps"));
  fs.writeFileSync(path.join(src.path, "skills", "tv", "SKILL.md"), "---\nname: tv\ndescription: TV.\n---\nUse it.\n");
  fs.writeFileSync(path.join(src.path, "server.mjs"), "export {};");
  fs.writeFileSync(path.join(src.path, "pages", "setup.html"), "<!doctype html><h1>Set up</h1>");
  fs.writeFileSync(path.join(src.path, "apps", "remote.apxart"), JSON.stringify(BUNDLE));
  fs.writeFileSync(path.join(src.path, "tv.apk"), Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3]));
  write(manifest());
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home: home.path });
});
after(async () => {
  await env.core.close();
  await home.remove();
  await src.remove();
});

test("a manifest 2 says what it brings and needs: agents, apps, a TV app, the hosts it reaches", async () => {
  const seen = await env.client.call("extensions.inspect", { path: src.path });
  assert.deepEqual(seen.brings, ["accounts", "tools", "skills", "agents", "devices", "apps"]);
  assert.deepEqual(seen.needs, ["code", "tv"]);
  assert.deepEqual(seen.hosts, ["tv.example.com"]);
  assert.equal(seen.agents[0]?.name, "Movie night host");
  assert.deepEqual(seen.pages, [{ id: "setup", title: "Set up the TV" }]);
  assert.equal(seen.companion?.pairing.with, "extension");
  assert.equal(seen.settings[0]?.label, "Region");
  assert.deepEqual(seen.settings[0]?.locales, { es: { label: "Región", description: "Elegí una región." } });
  // Its settings before install: defaults shown, nothing set.
  assert.deepEqual(
    seen.settings.map((s) => [s.name, s.value ?? null, s.set]),
    [
      ["region", "us", false],
      ["volume", null, false],
      ["library", null, false],
      ["connection_key", null, false],
    ],
  );
});

test("what a manifest 2 names must hold: declared references, files that exist, settings that fit", async () => {
  const bad = async (m: unknown, re: RegExp) => {
    write(m);
    await refused(env.client.call("extensions.inspect", { path: src.path }), re);
  };
  await bad(
    manifest({ mcp: { remote: { command: "node", args: ["setting://nope"] } }, companion: undefined }),
    /setting nope is not declared/,
  );
  await bad(manifest({ pages: [{ id: "x", title: "X", entry: "pages/missing.html" }] }), /does not exist/);
  await bad(manifest({ apps: [{ file: "tv.apk" }] }), /not the kind of file/);
  await bad(
    manifest({
      companion: { name: "X", platform: "android-tv", pairing: { with: "extension", server: "gone", tool: "t" } },
    }),
    /does not bring/,
  );
  await bad(manifest({ settings: [{ name: "region", label: "R", type: "number", default: "us" }] }), /default is not/);
  write(manifest());
});

test("settings: typed and checked; a sensitive one generated and kept as a secret; plain ones fill its server", async () => {
  const installed = await env.client.call("extensions.install", { path: src.path });
  assert.deepEqual(installed.settings[0]?.locales, { es: { label: "Región", description: "Elegí una región." } });
  const key = installed.settings.find((s) => s.name === "connection_key");
  assert.equal(key?.set, true);
  assert.equal(key?.value, undefined);
  await refused(
    env.client.call("extensions.settings", { id: "living_tv", values: { region: "mars" } }),
    /one of us, eu/,
  );
  await refused(
    env.client.call("extensions.settings", { id: "living_tv", values: { library: path.join(src.path, "nope") } }),
    /no folder/,
  );
  const after = await env.client.call("extensions.settings", {
    id: "living_tv",
    values: { region: "eu", volume: "12", library: src.path },
  });
  assert.deepEqual(after.settings[0]?.locales, { es: { label: "Región", description: "Elegí una región." } });
  assert.deepEqual(
    after.settings.map((s) => [s.name, s.value ?? null]),
    [
      ["region", "eu"],
      ["volume", 12],
      ["library", src.path],
      ["connection_key", null],
    ],
  );
  await env.client.call("extensions.enable", { id: "living_tv", enabled: true });
  const server = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "living_tv-remote");
  assert.match(server?.target ?? "", /--region eu/);
  assert.doesNotMatch(server?.target ?? "", /setting:\/\//);
});

test("its page, its app for Apps and its companion app come only from what it declares", async () => {
  const page = await env.client.call("extensions.page", { id: "living_tv", page: "setup" });
  assert.equal(page.title, "Set up the TV");
  assert.match(page.html, /<h1>Set up<\/h1>/);
  await refused(env.client.call("extensions.page", { id: "living_tv", page: "other" }), /not found/);
  const bundle = await env.client.call("extensions.app_bundle", { id: "living_tv", file: "apps/remote.apxart" });
  assert.equal(bundle.manifest.title, "TV remote");
  await refused(env.client.call("extensions.app_bundle", { id: "living_tv", file: "tv.apk" }), /not found/);
  const apk = await env.client.call("extensions.companion_file", { id: "living_tv" });
  assert.equal(apk.name, "tv.apk");
  assert.deepEqual(Buffer.from(apk.data, "base64"), Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3]));
});

test("an address the owner types with a final / joins its server's path with one /, as native integrations do", async () => {
  await using ha = tempDir("apx-v2-ha-");
  fs.writeFileSync(
    path.join(ha.path, "apx-extension.json"),
    JSON.stringify({
      manifest: 2,
      id: "home_hub",
      name: "Home hub",
      version: "1.0.0",
      mcp: {
        hub: {
          url: "setting://address/api/mcp",
          headers: { Authorization: "Bearer secret://token", "X-Hub": "setting://address" },
        },
      },
      settings: [
        { name: "address", label: "Address", type: "string", required: true },
        { name: "token", label: "Token", type: "string", sensitive: true },
      ],
    }),
  );
  await env.client.call("extensions.install", { path: ha.path });
  await env.client.call("extensions.enable", { id: "home_hub", enabled: true });
  const missing = await env.client.call("mcp.test", { scope: "global", server: "home_hub-hub" });
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? "", /Address/);
  const target = async (address: string) => {
    await env.client.call("extensions.settings", { id: "home_hub", values: { address } });
    await env.client.call("extensions.enable", { id: "home_hub", enabled: true });
    return (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "home_hub-hub")?.target;
  };
  assert.equal(await target("https://hub.example.com:8123/"), "https://hub.example.com:8123/api/mcp");
  assert.equal(await target("https://hub.example.com:8123//"), "https://hub.example.com:8123/api/mcp");
  assert.equal(await target("https://hub.example.com:8123"), "https://hub.example.com:8123/api/mcp");
  await env.client.call("extensions.remove", { id: "home_hub" });
});
