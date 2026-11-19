import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { CatalogItem } from "../domain/extension-catalogs.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir, waitFor } from "../testkit/platform.ts";
import { catalogPluginIds } from "./catalog-identities.ts";
import { parseSource } from "./catalogs.ts";
import { convertPlugin, licenseOf } from "./claude-plugin.ts";
import { hostsOf, ownerHost, readFiles } from "./package.ts";
import { bringsOf } from "./summary.ts";

const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy...";
const PROPRIETARY = "Copyright Acme. All rights reserved. No part of this may be copied.";
const SHA = "778122e5f9c680f541eeceda5a5b36405eb7980c";
/** Claude Code's `${NAME}` placeholder, as a plugin writes it. */
const placeholder = (name: string) => `\${${name}}`;
const settingId = (name: string) => `x_${createHash("sha256").update(name).digest("hex").slice(0, 18)}`;
const put = (root: string, files: Record<string, string>) => {
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), data);
  }
};

test("a catalog's address: GitHub owner/repo, a git address, an index's https address or a folder; nothing else", () => {
  assert.deepEqual(parseSource("anthropics/knowledge-work-plugins"), {
    kind: "git",
    url: "https://github.com/anthropics/knowledge-work-plugins.git",
  });
  assert.deepEqual(parseSource("https://github.com/acme/tools/tree/stable"), {
    kind: "git",
    url: "https://github.com/acme/tools.git",
    ref: "stable",
  });
  assert.deepEqual(parseSource("https://catalog.example.com/index.json"), {
    kind: "json",
    url: "https://catalog.example.com/index.json",
  });
  assert.equal(parseSource("~/work/catalog").kind, "folder");
  for (const bad of ["http://catalog.example.com/index.json", "file:///etc", "ext::sh -c x", "just words"])
    assert.throws(() => parseSource(bad), /GitHub owner\/repo/);
});

test("a license by its words or its id; one that does not allow a copy is none", () => {
  assert.equal(licenseOf(MIT), "MIT");
  assert.equal(licenseOf("Apache License\nVersion 2.0, January 2004"), "Apache-2.0");
  assert.equal(licenseOf("apache-2.0"), "Apache-2.0");
  assert.equal(licenseOf(PROPRIETARY), undefined);
  assert.equal(licenseOf("GPL-3.0"), undefined);
});

test("a Claude plugin becomes an extension: skills as they are, servers with their keys as settings, agents", () => {
  const files = new Map(
    Object.entries({
      ".claude-plugin/plugin.json": JSON.stringify({ name: "Sales Toolkit", version: "1.2.0", description: "Deals." }),
      "skills/pipeline/SKILL.md": "---\nname: pipeline\ndescription: Pipeline.\n---\nRead deals.\n",
      ".mcp.json": JSON.stringify({
        mcpServers: {
          crm: { command: "npx", args: ["-y", "crm-mcp@1.0.0"], env: { CRM_API_KEY: placeholder("CRM_API_KEY") } },
          "deal room": {
            type: "http",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: `Bearer ${placeholder("ROOM_TOKEN")}` },
          },
          broken: { type: "http", url: "" },
        },
      }),
      "agents/closer.md":
        "---\nname: Deal closer\ndescription: Pushes stuck deals.\n---\nFind deals that stopped and draft a nudge.",
      "commands/report.md": "Make a report.",
      LICENSE: MIT,
    }).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const out = convertPlugin(files, { name: "fallback" });
  assert.equal(out.id, "sales-toolkit");
  assert.deepEqual(out.left, ["commands", "mcp broken"]);
  assert.ok(out.files.has("skills/pipeline/SKILL.md"));
  assert.ok(out.files.has("LICENSE"));
  const m = JSON.parse(out.files.get("apx-extension.json")?.toString() ?? "{}");
  assert.equal(m.manifest, 2);
  assert.deepEqual(m.mcp.crm, {
    command: "npx",
    args: ["-y", "crm-mcp@1.0.0"],
    env: { CRM_API_KEY: `secret://${settingId("CRM_API_KEY")}` },
  });
  assert.deepEqual(m.mcp.deal_room, {
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: `Bearer secret://${settingId("ROOM_TOKEN")}` },
  });
  assert.deepEqual(
    m.settings.map((s: { name: string; sensitive: boolean; required: boolean }) => [s.name, s.sensitive, s.required]),
    [
      [settingId("CRM_API_KEY"), true, true],
      [settingId("ROOM_TOKEN"), true, true],
    ],
  );
  assert.deepEqual(m.agents[0], {
    id: "deal_closer",
    name: "Deal closer",
    description: "Pushes stuck deals.",
    prompt: "Find deals that stopped and draft a nudge.",
  });
});

test("servers plugin.json names in a file of its own; a placeholder with a default that is no key is a plain setting", () => {
  const files = new Map(
    Object.entries({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "watch",
        version: "0.7.1",
        mcpServers: "./.watch_mcp.json",
      }),
      ".watch_mcp.json": JSON.stringify({
        mcpServers: {
          mcp: {
            type: "http",
            url: `https://${placeholder("WATCH_DOMAIN:-not-setup")}/v1/mcp`,
            headers: { WATCH_API_KEY: placeholder("WATCH_API_KEY:-") },
          },
        },
      }),
      LICENSE: MIT,
    }).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const out = convertPlugin(files, { id: "watch", name: "Watch", version: "0.0.0" });
  const m = JSON.parse(out.files.get("apx-extension.json")?.toString() ?? "{}");
  assert.equal(m.name, "Watch");
  assert.equal(m.version, "0.7.1");
  assert.deepEqual(m.mcp.mcp, {
    url: `https://setting://${settingId("WATCH_DOMAIN")}/v1/mcp`,
    headers: { WATCH_API_KEY: `secret://${settingId("WATCH_API_KEY")}` },
  });
  assert.deepEqual(m.settings, [
    {
      name: settingId("WATCH_DOMAIN"),
      label: "Watch domain",
      type: "string",
      sensitive: false,
      required: false,
      default: "not-setup",
    },
    { name: settingId("WATCH_API_KEY"), label: "Watch API key", type: "string", sensitive: true, required: false },
  ]);
  // The address the owner types is theirs: no host of its own, said apart.
  const pkg = readFiles(out.files);
  assert.deepEqual(hostsOf(pkg.manifest), []);
  assert.equal(ownerHost(pkg.manifest), true);
});

test("plugin settings with the same truncated name stay separate and repeated placeholders agree", () => {
  const files = new Map(
    Object.entries({
      ".claude-plugin/plugin.json": JSON.stringify({ name: "Tracker" }),
      ".mcp.json": JSON.stringify({
        tracker: {
          command: "node",
          env: {
            FIRST: placeholder("SOME_SERVICE_ACCESS_TOKEN"),
            SECOND: placeholder("SOME_SERVICE_ACCESS_SECRET"),
            AGAIN: placeholder("SOME_SERVICE_ACCESS_TOKEN"),
          },
        },
      }),
    }).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const pkg = readFiles(convertPlugin(files, { name: "Tracker" }).files);
  const server = pkg.manifest.mcp?.tracker;
  assert.ok(server && "env" in server && server.env);
  assert.notEqual(server.env.FIRST, server.env.SECOND);
  assert.equal(server.env.FIRST, server.env.AGAIN);
  assert.equal(pkg.manifest.settings?.length, 2);
  assert.ok(pkg.manifest.settings?.every((setting) => setting.sensitive));
  assert.ok(bringsOf(pkg.manifest).includes("accounts"));
  files.set(
    ".mcp.json",
    Buffer.from(
      JSON.stringify({
        tracker: {
          command: "node",
          env: {
            SECOND: placeholder("SOME_SERVICE_ACCESS_SECRET"),
            FIRST: placeholder("SOME_SERVICE_ACCESS_TOKEN"),
          },
        },
      }),
    ),
  );
  const reordered = readFiles(convertPlugin(files, { name: "Tracker" }).files).manifest.mcp?.tracker;
  assert.ok(reordered && "env" in reordered && reordered.env);
  assert.equal(reordered.env.FIRST, server.env.FIRST);
  assert.equal(reordered.env.SECOND, server.env.SECOND);
  files.set(
    ".mcp.json",
    Buffer.from(
      JSON.stringify({
        tracker: {
          command: "node",
          env: {
            SECOND: placeholder("SOME_SERVICE_ACCESS_SECRET"),
          },
        },
      }),
    ),
  );
  const remaining = readFiles(convertPlugin(files, { name: "Tracker" }).files).manifest.mcp?.tracker;
  assert.ok(remaining && "env" in remaining && remaining.env);
  assert.equal(remaining.env.SECOND, server.env.SECOND);
});

test("converted skills keep their referenced plugin files and address the installed root", () => {
  const files = new Map(
    Object.entries({
      ".claude-plugin/plugin.json": JSON.stringify({ name: "Migrator" }),
      "skills/migrate/SKILL.md": `---\nname: migrate\ndescription: Migrate.\n---\nRun python3 ${placeholder("CLAUDE_PLUGIN_ROOT")}/engine/run.py and read [notes](../../references/notes.md).\n`,
      "engine/run.py": "print('ok')\n",
      "engine/helpers.py": "# helper\n",
      "engine/.env": "SECRET=example\n",
      "references/notes.md": "Notes.\n",
      "unrelated/private.txt": "Not referenced.\n",
    }).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const converted = convertPlugin(files, { name: "Migrator" });
  assert.equal(converted.files.get("engine/run.py")?.toString(), "print('ok')\n");
  assert.equal(converted.files.get("engine/helpers.py")?.toString(), "# helper\n");
  assert.equal(converted.files.get("references/notes.md")?.toString(), "Notes.\n");
  assert.equal(converted.files.has("unrelated/private.txt"), false);
  assert.equal(converted.files.has("engine/.env"), false);
  const skill = converted.files.get("skills/migrate/SKILL.md")?.toString() ?? "";
  assert.match(skill, /\{\{skill_dir\}\}\/\.\.\/\.\.\/engine\/run\.py/);
  assert.match(skill, /\{\{skill_dir\}\}\/\.\.\/\.\.\/references\/notes\.md/);
  assert.doesNotThrow(() => readFiles(converted.files));
});

test("servers written at the top of .mcp.json, without mcpServers, are its servers all the same", () => {
  const files = new Map(
    Object.entries({
      ".claude-plugin/plugin.json": JSON.stringify({ name: "tracker" }),
      ".mcp.json": JSON.stringify({
        tracker: { type: "http", url: "https://mcp.tracker.example.com/mcp" },
        local: { command: "npx", args: ["-y", "tracker-mcp@2.0.0"] },
      }),
    }).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const m = JSON.parse(convertPlugin(files, { name: "Tracker" }).files.get("apx-extension.json")?.toString() ?? "{}");
  assert.deepEqual(Object.keys(m.mcp).sort(), ["local", "tracker"]);
});

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;
let cat: TempDir;
const asked: string[] = [];
/** While set, reading a plugin's license waits for it: a catalog stays being read. */
let hold: Promise<void> | undefined;

before(async () => {
  home = tempDir("apx-catalogs-home-");
  cat = tempDir("apx-catalogs-src-");
  put(cat.path, {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "Acme plugins",
      owner: { name: "Acme" },
      plugins: [
        {
          name: "notes",
          displayName: "Notes",
          description: "Notes for agents.",
          category: "database",
          homepage: "https://notes.example.com",
          source: "./notes",
        },
        { name: "setup", description: "Only a command.", category: "productivity", source: "./setup" },
        { name: "secret-sauce", description: "Closed.", source: "./sauce" },
        {
          name: "drifting",
          description: "Unpinned.",
          source: { source: "url", url: "https://github.com/acme/drift.git" },
        },
        {
          name: "pinned",
          description: "Pinned.",
          source: { source: "url", url: "https://github.com/acme/pinned.git", sha: SHA },
        },
        { name: "outside", description: "Escapes.", source: "../elsewhere" },
      ],
    }),
    "notes/.claude-plugin/plugin.json": JSON.stringify({ name: "notes", version: "0.4.0", license: "MIT" }),
    "notes/skills/notes/SKILL.md": "---\nname: notes\ndescription: Notes.\n---\nTake notes.\n",
    "notes/.mcp.json": JSON.stringify({
      mcpServers: { store: { type: "http", url: "https://notes.example.com/mcp" } },
    }),
    "setup/.claude-plugin/plugin.json": JSON.stringify({ name: "setup", license: "MIT" }),
    "setup/commands/setup.md": "Set it up.",
    "setup/README.md": "Run /setup.",
    "sauce/.claude-plugin/plugin.json": JSON.stringify({ name: "secret-sauce" }),
    "sauce/LICENSE": PROPRIETARY,
  });
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    extensionFetch: (async (url: string | URL) => {
      asked.push(String(url));
      await hold;
      // The pinned plugin's license, read at its commit.
      if (String(url) === `https://raw.githubusercontent.com/acme/pinned/${SHA}/LICENSE`) return new Response(MIT);
      // …and its MCP server, read at the same commit.
      if (String(url) === `https://raw.githubusercontent.com/acme/pinned/${SHA}/.mcp.json`)
        return new Response(
          JSON.stringify({ mcpServers: { api: { command: "npx", args: ["-y", "pinned-mcp@1.0.0"] } } }),
        );
      return new Response("missing", { status: 404 });
    }) as typeof fetch,
  });
});
after(async () => {
  await env.core.close();
  await home.remove();
  await cat.remove();
});

test("entries sharing a source keep the ID of the displayed entry, not the source's ordering", () => {
  const plugins = [
    { name: "alpha", displayName: "Zulu", source: "./shared" },
    { name: "beta", displayName: "Alpha", source: "./shared" },
  ];
  const old = (id: string, name: string): CatalogItem => ({
    id,
    name,
    description: "",
    version: "1.0.0",
    plugin: true,
    via: { type: "path", path: "shared" },
  });
  const previous = [old("beta", "Alpha"), old("alpha", "Zulu")];
  const ids = catalogPluginIds(plugins, previous);
  assert.equal(ids.get(0), "alpha");
  assert.equal(ids.get(1), "beta");
  const legacy = catalogPluginIds(plugins, [old("duplicate", "Alpha"), old("duplicate", "Zulu")]);
  assert.equal(legacy.get(1), "duplicate");
  assert.notEqual(legacy.get(0), "duplicate");
  const remaining = catalogPluginIds([plugins[0]], previous);
  assert.equal(remaining.get(0), "alpha");
  const moved = catalogPluginIds([{ ...plugins[0], source: "./other" }], previous);
  assert.notEqual(moved.get(0), "alpha");
});

test("catalog names sharing the first 20 characters remain separately inspectable across syncs", async () => {
  const folder = tempDir("catalog-collisions-");
  const first = { name: "long-catalog-entry-name-alpha", source: "./alpha" };
  const second = { name: "long-catalog-entry-name-beta", source: "./beta" };
  const index = (plugins: unknown[]) => JSON.stringify({ name: "Acme", plugins });
  put(folder.path, {
    ".claude-plugin/marketplace.json": index([first]),
    "alpha/.claude-plugin/plugin.json": JSON.stringify({ name: first.name, license: "MIT" }),
    "alpha/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nAlpha.\n",
    "beta/.claude-plugin/plugin.json": JSON.stringify({ name: second.name, license: "MIT" }),
    "beta/skills/beta/SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBeta.\n",
  });
  try {
    const added = await env.client.call("extensions.catalog_add", { source: folder.path });
    const listed = async () =>
      (await env.client.call("extensions.catalog", {})).entries.filter((e) => e.catalog === added.id);
    const legacy = (await listed())[0]?.id;
    assert.ok(legacy);
    put(folder.path, { ".claude-plugin/marketplace.json": index([second, first]) });
    await env.client.call("extensions.catalog_add", { source: folder.path });
    const entries = await listed();
    const a = entries.find((e) => e.name === first.name);
    const b = entries.find((e) => e.name === second.name);
    assert.equal(a?.id, legacy);
    assert.ok(b?.id);
    assert.notEqual(a.id, b.id);
    assert.deepEqual((await env.client.call("extensions.inspect", { entry: { catalog: added.id, id: a.id } })).skills, [
      "alpha",
    ]);
    assert.deepEqual((await env.client.call("extensions.inspect", { entry: { catalog: added.id, id: b.id } })).skills, [
      "beta",
    ]);
    const installedA = await env.client.call("extensions.install", { entry: { catalog: added.id, id: a.id } });
    const installedB = await env.client.call("extensions.install", { entry: { catalog: added.id, id: b.id } });
    assert.equal(installedA.id, a.id);
    assert.equal(installedB.id, b.id);
    put(folder.path, { ".claude-plugin/marketplace.json": index([first, second]) });
    await env.client.call("extensions.catalog_add", { source: folder.path });
    assert.equal((await listed()).find((e) => e.name === second.name)?.id, b.id);
    await env.client.call("extensions.catalog_remove", { id: added.id });
  } finally {
    await folder.remove();
  }
});

test("an added catalog lists what it may, leaves out what it may not (license, unpinned, outside, empty) and says why", async () => {
  const added = await env.client.call("extensions.catalog_add", { source: cat.path });
  assert.equal(added.kind, "claude");
  assert.equal(added.name, "Acme plugins");
  assert.equal(added.count, 2);
  assert.deepEqual(added.skipped.map((s) => `${s.name}:${s.reason}`).sort(), [
    "drifting:unpinned",
    "outside:source",
    "secret-sauce:license",
    // Only a command once converted: nothing APX uses.
    "setup:empty",
  ]);
  assert.ok(asked.includes(`https://raw.githubusercontent.com/acme/pinned/${SHA}/LICENSE`));
  const { catalogs, suggested } = await env.client.call("extensions.catalogs", {});
  assert.equal(catalogs.length, 1);
  assert.equal(suggested[0]?.source, "anthropics/knowledge-work-plugins");
  const { entries } = await env.client.call("extensions.catalog", {});
  const notes = entries.find((e) => e.id === "notes");
  assert.equal(notes?.catalog, added.id);
  assert.equal(notes?.provenance, "third_party");
  assert.equal(notes?.license, "MIT");
  assert.equal(notes?.version, "0.4.0");
  // Who makes each: the catalog's owner for one kept in its repository; the GitHub account of one kept elsewhere.
  assert.equal(notes?.publisher, "Acme");
  const pinned = entries.find((e) => e.id === "pinned");
  assert.deepEqual([pinned?.publisher, pinned?.github], [undefined, "acme"]);
});

test("an added catalog's entry is filed in APX's category and says what it brings before it is added", async () => {
  const { catalogs } = await env.client.call("extensions.catalogs", {});
  const { entries } = await env.client.call("extensions.catalog", {});
  const notes = entries.find((e) => e.id === "notes" && e.catalog === catalogs[0]?.id);
  // Claude's "database" is APX's Data; its own word stays among its categories.
  assert.equal(notes?.category, "data");
  assert.deepEqual(notes?.categories, ["database"]);
  assert.equal(notes?.homepage, "https://notes.example.com");
  // Read from its files as installing would convert them: a server and a skill, so a connector, not skills alone.
  assert.equal(notes?.contents?.servers, 1);
  assert.deepEqual(notes?.contents?.skills, ["notes"]);
  assert.deepEqual(notes?.contents?.hosts, ["notes.example.com"]);
  assert.deepEqual(notes?.brings?.sort(), ["skills", "tools"]);
  const seen = await env.client.call("extensions.inspect", { entry: { catalog: catalogs[0]?.id ?? "", id: "notes" } });
  assert.equal(notes?.contents?.hash, seen.hash, "the fingerprint shown is the one installing gets");
  // One in another repository: its server read at its commit; nothing more is known before it is added.
  const pinned = entries.find((e) => e.id === "pinned");
  assert.deepEqual([pinned?.brings, pinned?.needs, pinned?.contents], [["tools"], ["code"], undefined]);
});

test("an entry of an added catalog installs converted, third party, off", async () => {
  const { catalogs } = await env.client.call("extensions.catalogs", {});
  const id = catalogs[0]?.id ?? "";
  const seen = await env.client.call("extensions.inspect", { entry: { catalog: id, id: "notes" } });
  assert.equal(seen.provenance, "third_party");
  assert.deepEqual(seen.skills, ["notes"]);
  assert.deepEqual(seen.hosts, ["notes.example.com"]);
  const info = await env.client.call("extensions.install", { entry: { catalog: id, id: "notes" }, hash: seen.hash });
  assert.equal(info.enabled, false);
  assert.equal(info.version, "0.4.0");
  assert.equal(info.source, "Acme plugins · Notes");
  assert.deepEqual(await env.client.call("extensions.catalog_remove", { id }), { removed: true });
});

test("a catalog read in the background answers at once, tells how far along it is, and lists it once read", async () => {
  const socket = await env.client.connect();
  try {
    const at: Array<{ done: number; total: number }> = [];
    let changed = 0;
    socket.onEvent((e) => {
      if (e.type === "extensions.catalog_reading") {
        const { done, total } = e.payload as { done: number; total: number };
        at.push({ done, total });
      }
      if (e.type === "extensions.changed") changed++;
    });
    const started = await env.client.call("extensions.catalog_add", { source: cat.path, background: true });
    assert.ok(started.reading, "being read");
    assert.equal(started.count, 0);
    const read = await waitFor(async () => {
      const c = (await env.client.call("extensions.catalogs", {})).catalogs.find((x) => x.id === started.id);
      return c && !c.reading ? c : undefined;
    }, "the catalog read");
    assert.deepEqual([read.name, read.count, read.failed], ["Acme plugins", 2, undefined]);
    // Every plugin was checked, and the panel heard when it was done.
    assert.deepEqual(at.at(-1), { done: 6, total: 6 });
    await waitFor(async () => changed > 0 || undefined, "extensions.changed once read");
    assert.deepEqual(await env.client.call("extensions.catalog_remove", { id: started.id }), { removed: true });
  } finally {
    socket.close();
  }
});

test("a background read that fails says so until it is removed; one removed while read does not come back", async () => {
  const gone = path.join(cat.path, "missing");
  const bad = await env.client.call("extensions.catalog_add", { source: gone, background: true });
  const failed = await waitFor(async () => {
    const c = (await env.client.call("extensions.catalogs", {})).catalogs.find((x) => x.id === bad.id);
    return c?.failed ? c : undefined;
  }, "the failed read");
  // Never read, it goes by its folder's name.
  assert.deepEqual([failed.source, failed.name, failed.count], [gone, "missing", 0]);
  assert.deepEqual(await env.client.call("extensions.catalog_remove", { id: bad.id }), { removed: true });
  assert.equal((await env.client.call("extensions.catalogs", {})).catalogs.length, 0);

  let release = () => {};
  hold = new Promise((r) => {
    release = r;
  });
  const socket = await env.client.connect();
  try {
    let ended = 0;
    socket.onEvent((e) => {
      if (e.type === "extensions.changed") ended++;
    });
    const slow = await env.client.call("extensions.catalog_add", { source: cat.path, background: true });
    const shown = (await env.client.call("extensions.catalogs", {})).catalogs;
    assert.ok(shown.find((c) => c.id === slow.id)?.reading, "still being read");
    assert.deepEqual(await env.client.call("extensions.catalog_remove", { id: slow.id }), { removed: true });
    // Gone from the list at once, and its read, once it ends, keeps nothing.
    assert.equal((await env.client.call("extensions.catalogs", {})).catalogs.length, 0);
    const before = ended;
    hold = undefined;
    release();
    await waitFor(async () => ended > before || undefined, "its read ended");
    assert.equal((await env.client.call("extensions.catalogs", {})).catalogs.length, 0);
  } finally {
    hold = undefined;
    release();
    socket.close();
  }
});
