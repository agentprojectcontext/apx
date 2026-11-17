import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionManifest } from "@apx/protocol";
import { tempDir } from "../testkit/platform.ts";
import { createCatalog } from "./catalog.ts";
import { comparePowers, MAX_FILES, PackageError, readArchive, readFolder, writePackage } from "./package.ts";
import { catalogOf, zip, zipFiles } from "./zip.test-support.ts";

const MANIFEST = JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", skills: "skills" });
const FILES = {
  "apx-extension.json": MANIFEST,
  "skills/forecast/SKILL.md": "---\nname: forecast\ndescription: Forecasts.\n---\nAsk.\n",
  "README.md": "Weather for agents.",
};
const refused = (buf: Buffer, re: RegExp) =>
  assert.throws(
    () => readArchive(buf),
    (e: unknown) => e instanceof PackageError && re.test(e.message),
  );

test("an .apxext gives the same fingerprint as its folder, zipped flat or inside one top folder", async () => {
  await using dir = tempDir("apx-ext-pkg-");
  for (const [rel, data] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir.path, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir.path, rel), data);
  }
  const folder = readFolder(dir.path);
  const flat = readArchive(zipFiles(FILES));
  // How "Compress" on a Mac packs a folder: one top folder, and its __MACOSX and .DS_Store left out.
  const byHand = readArchive(zipFiles({ ...FILES, ".DS_Store": "x", "skills/.DS_Store": "x" }, "weather/"));
  const mac = readArchive(
    zip([
      ...Object.entries(FILES).map(([n, d]) => ({ name: `w/${n}`, data: d })),
      { name: "__MACOSX/w/._README.md", data: "resource fork" },
    ]),
  );
  assert.equal(flat.hash, folder.hash);
  assert.equal(byHand.hash, folder.hash);
  assert.equal(mac.hash, folder.hash);
  assert.deepEqual(flat.skills, ["forecast"]);
  assert.equal(flat.manifest.id, "weather");
  // Written to disk, it reads back as the same files.
  await using out = tempDir("apx-ext-out-");
  writePackage(flat, path.join(out.path, "weather"));
  assert.equal(readFolder(path.join(out.path, "weather")).hash, folder.hash);
  assert.throws(() => writePackage(flat, path.join(out.path, "weather")), /EEXIST/);
});

test("an archive that would leave its folder, hide a link or lie about its sizes is refused whole", () => {
  const ok = { name: "apx-extension.json", data: MANIFEST };
  refused(zip([ok, { name: "../escape.txt", data: "x" }]), /outside/);
  refused(zip([ok, { name: "/etc/escape", data: "x" }]), /outside/);
  refused(zip([ok, { name: "skills\\..\\..\\escape", data: "x" }]), /outside/);
  refused(zip([ok, { name: "C:/escape", data: "x" }]), /outside/);
  refused(zip([ok, { name: "link", data: "/etc/passwd", mode: 0o120777 }]), /is a link/);
  refused(zip([ok, { name: "secret.txt", data: "x", flags: 1 }]), /encrypted/);
  refused(zip([ok, { name: "odd.bin", data: "x", method: 12 }]), /compression/);
  // A size that does not match what unpacks: bigger is cut short by the declared size, smaller is damaged.
  refused(zip([ok, { name: "big.txt", data: "a".repeat(5000), size: 10 }]), /damaged|not a zip/);
  refused(zip([ok, { name: "small.txt", data: "abc", size: 4000 }]), /damaged|not a zip/);
  refused(zip([ok, { name: "stored.txt", data: "abc", method: 0, size: 2 }]), /damaged/);
  // A bomb: a tiny entry declaring more than 50 MB is refused before anything is inflated.
  refused(zip([ok, { name: "bomb.txt", data: "a".repeat(1000), size: 60 * 1024 * 1024 }]), /more than/);
  refused(zip([ok, { name: "A.md", data: "1" }, { name: "a.md", data: "2" }]), /twice/);
  refused(zip([ok, { name: "notes", data: "1" }, { name: "notes/x.md", data: "2" }]), /file and a folder/);
  refused(
    zip([ok, ...Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f/${i}.txt`, data: "" }))]),
    /too big|more than/,
  );
  refused(Buffer.from("not a zip at all"), /not a zip/);
  refused(zip([{ name: "README.md", data: "no manifest" }]), /no readable apx-extension.json/);
  refused(
    zipFiles({
      "apx-extension.json": JSON.stringify({ id: "x", name: "X", version: "1", plugin: { entry: "p.mjs" } }),
    }),
    /plugin.entry p.mjs does not exist/,
  );
  refused(
    zipFiles({ "apx-extension.json": JSON.stringify({ id: "x", name: "X", version: "1", skills: "../up" }) }),
    /skills points outside/,
  );
});

const m = (extra: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  id: "crm",
  name: "CRM",
  version: "1.0.0",
  description: "",
  mcp: { api: { url: "https://api.example.com/mcp", args: [], env: {}, headers: {} } },
  routines: [],
  secrets: [{ name: "token", label: "API token" }],
  ...extra,
});

test("a version adds what it may newly reach, run or ask for; a reworded label adds nothing", () => {
  assert.deepEqual(comparePowers(m(), m({ secrets: [{ name: "token", label: "Token (new wording)" }] })).adds, []);
  const more = comparePowers(
    m(),
    m({
      mcp: {
        api: { url: "https://api.example.com/mcp", args: [], env: {}, headers: {} },
        files: { url: "https://files.northwind.test/mcp", args: [], env: {}, headers: {} },
      },
      plugin: { entry: "p.mjs", observe: ["message.created"], context: false, network: true, local_network: false },
    }),
  );
  assert.deepEqual(
    more.adds.map((p) => `${p.kind}:${p.name}`),
    ["mcp:files", "host:files.northwind.test", "plugin:p.mjs", "internet:internet", "observe:message.created"],
  );
  const moved = comparePowers(m(), m({ mcp: { api: { command: "npx", args: ["other"], env: {}, headers: {} } } }));
  assert.deepEqual(
    moved.adds.map((p) => p.kind),
    ["mcp"],
  );
  assert.deepEqual(
    moved.removes.map((p) => p.kind),
    ["mcp", "host"],
  );
});

test("the catalog: official only for the same id, version and fingerprint under the official tier", async () => {
  await using home = tempDir("apx-catalog-");
  let now = 1_000_000;
  const asked: { etag?: string | null }[] = [];
  let body = catalogOf([
    { id: "weather", version: "1.0.0", hash: "aaaaaaaaaaaaaaaa" },
    { id: "crm", version: "1.0.0", hash: "bbbbbbbbbbbbbbbb", tier: "community" },
  ]);
  let answer: "ok" | "down" = "ok";
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    const etag = new Headers(init?.headers).get("if-none-match");
    asked.push({ etag });
    if (answer === "down") throw new TypeError("fetch failed");
    if (etag === '"v1"') return new Response(null, { status: 304 });
    return new Response(body, { status: 200, headers: { etag: '"v1"' } });
  }) as typeof fetch;
  const catalog = createCatalog({
    home: home.path,
    url: "https://catalog.example.com/index.json",
    fetch: fakeFetch,
    now: () => now,
  });
  assert.deepEqual(await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa"), { provenance: "official" });
  assert.equal((await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaab")).provenance, "third_party");
  assert.equal((await catalog.check("weather", "1.0.1", "aaaaaaaaaaaaaaaa")).provenance, "third_party");
  assert.equal((await catalog.check("crm", "1.0.0", "bbbbbbbbbbbbbbbb")).provenance, "third_party");
  // Fresh: asked once for all four. Later: asked again with its ETag, and a 304 keeps the copy.
  assert.equal(asked.length, 1);
  now += 11 * 60_000;
  assert.equal((await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa")).provenance, "official");
  assert.deepEqual(asked.at(-1), { etag: '"v1"' });
  // Unreachable: the kept copy still answers; with none kept, everything is third party and says why.
  now += 11 * 60_000;
  answer = "down";
  assert.equal((await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa")).provenance, "official");
  fs.rmSync(path.join(home.path, "marketplace", "catalog.json"));
  assert.deepEqual(await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa"), {
    provenance: "third_party",
    catalog: "unreachable",
  });
  // A catalog newer than this APX reads is set aside whole.
  answer = "ok";
  body = catalogOf([{ id: "weather", version: "1.0.0", hash: "aaaaaaaaaaaaaaaa" }], 2);
  fs.rmSync(path.join(home.path, "marketplace", "catalog.json"), { force: true });
  assert.deepEqual(await catalog.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa"), {
    provenance: "third_party",
    catalog: "needs_update",
  });
  // No catalog configured: third party, nothing asked.
  const none = createCatalog({ home: home.path, url: undefined, fetch: fakeFetch });
  const before = asked.length;
  assert.deepEqual(await none.check("weather", "1.0.0", "aaaaaaaaaaaaaaaa"), { provenance: "third_party" });
  assert.equal(asked.length, before);
});
