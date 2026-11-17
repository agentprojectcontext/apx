import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { parseSource } from "./catalogs.ts";
import { convertPlugin, licenseOf } from "./claude-plugin.ts";

const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy...";
const PROPRIETARY = "Copyright Acme. All rights reserved. No part of this may be copied.";
const SHA = "778122e5f9c680f541eeceda5a5b36405eb7980c";
/** Claude Code's `${NAME}` placeholder, as a plugin writes it. */
const placeholder = (name: string) => `\${${name}}`;
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
    env: { CRM_API_KEY: "secret://crm_api_key" },
  });
  assert.deepEqual(m.mcp.deal_room, {
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer secret://room_token" },
  });
  assert.deepEqual(
    m.settings.map((s: { name: string; sensitive: boolean }) => [s.name, s.sensitive]),
    [
      ["crm_api_key", true],
      ["room_token", true],
    ],
  );
  assert.deepEqual(m.agents[0], {
    id: "deal_closer",
    name: "Deal closer",
    description: "Pushes stuck deals.",
    prompt: "Find deals that stopped and draft a nudge.",
  });
});

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;
let cat: TempDir;
const asked: string[] = [];

before(async () => {
  home = tempDir("apx-catalogs-home-");
  cat = tempDir("apx-catalogs-src-");
  put(cat.path, {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "Acme plugins",
      plugins: [
        { name: "notes", displayName: "Notes", description: "Notes for agents.", source: "./notes" },
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
    "sauce/.claude-plugin/plugin.json": JSON.stringify({ name: "secret-sauce" }),
    "sauce/LICENSE": PROPRIETARY,
  });
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    extensionFetch: (async (url: string | URL) => {
      asked.push(String(url));
      // The pinned plugin's license, read at its commit.
      if (String(url) === `https://raw.githubusercontent.com/acme/pinned/${SHA}/LICENSE`) return new Response(MIT);
      return new Response("missing", { status: 404 });
    }) as typeof fetch,
  });
});
after(async () => {
  await env.core.close();
  await home.remove();
  await cat.remove();
});

test("an added catalog lists what it may, leaves out what it may not (license, unpinned, outside) and says why", async () => {
  const added = await env.client.call("extensions.catalog_add", { source: cat.path });
  assert.equal(added.kind, "claude");
  assert.equal(added.name, "Acme plugins");
  assert.equal(added.count, 2);
  assert.deepEqual(added.skipped.map((s) => `${s.name}:${s.reason}`).sort(), [
    "drifting:unpinned",
    "outside:source",
    "secret-sauce:license",
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
