import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browser } from "./browser.ts";
import { printed, recordingClient } from "./testing.ts";

test("browser commands preserve ownership, profiles, element references and submit choices", async () => {
  const cases: {
    args: string[];
    options?: Parameters<typeof browser>[1];
    method: string;
    params: object;
    result: object;
    output: RegExp;
  }[] = [
    {
      args: ["open", "https://example.com"],
      method: "browser.open",
      params: { url: "https://example.com", by: "terminal" },
      result: { tab: "t1", profile: "shared", title: "Acme" },
      output: /^t1 · shared · Acme$/,
    },
    {
      args: ["open", "https://example.com"],
      options: { by: "scout", profile: "incognito" },
      method: "browser.open",
      params: { url: "https://example.com", by: "scout", profile: "incognito" },
      result: { tab: "t1", profile: "incognito", title: "", url: "https://example.com" },
      output: /https:\/\/example.com$/,
    },
    {
      args: ["nav", "t1", "https://example.com/prices"],
      method: "browser.navigate",
      params: { tab: "t1", url: "https://example.com/prices", by: "terminal" },
      result: { title: "Prices", url: "https://example.com/prices" },
      output: /^Prices · https:/,
    },
    {
      args: ["snapshot", "t1"],
      method: "browser.snapshot",
      params: { tab: "t1" },
      result: { tree: "<untrusted_web>Acme</untrusted_web>", refs: 3, truncated: true, url: "https://example.com" },
      output: /3 refs \(truncated\)/,
    },
    {
      args: ["click", "t1", "e7"],
      method: "browser.click",
      params: { tab: "t1", ref: "e7", by: "terminal" },
      result: { url: "https://example.com" },
      output: /^ok · https:/,
    },
    {
      args: ["type", "t1", "e2", "Acme plans"],
      method: "browser.type",
      params: { tab: "t1", ref: "e2", text: "Acme plans", submit: false, by: "terminal" },
      result: { url: "https://example.com" },
      output: /^ok · https:/,
    },
    {
      args: ["type", "t1", "e2", "Acme plans"],
      options: { submit: true, by: "scout" },
      method: "browser.type",
      params: { tab: "t1", ref: "e2", text: "Acme plans", submit: true, by: "scout" },
      result: { url: "https://example.com" },
      output: /^ok · https:/,
    },
    {
      args: ["import", "firefox", "example.com,acme.example"],
      options: { profile: "shared" },
      method: "browser.import_cookies",
      params: { source: "firefox", domains: ["example.com", "acme.example"], profile: "shared" },
      result: { imported: 2, skipped: 1, failed: 0 },
      output: /^imported 2 · skipped 1 \(expired\) · failed 0$/,
    },
    ...(["user", "idle", "done"] as const).map((mode) => ({
      args: ["control", "t1", mode],
      method: "browser.control",
      params: { tab: "t1", mode },
      result: { tab: "t1", control: { kind: mode } },
      output: new RegExp(`^t1 · ${mode}$`),
    })),
    { args: ["close", "t1"], method: "browser.close", params: { tab: "t1" }, result: { ok: true }, output: /^closed$/ },
  ];
  for (const c of cases) {
    const { client, calls } = recordingClient({ [c.method]: c.result });
    assert.match(await printed(() => browser(client, c.options ?? {}, c.args)), c.output, c.args.join(" "));
    assert.deepEqual(calls, [[c.method, c.params]], c.args.join(" "));
  }
});

test("tabs distinguish owner and agent control; empty lists and cookie sources stay readable", async () => {
  const { client, calls } = recordingClient({
    "browser.tabs": {
      tabs: [
        { tab: "t1", profile: "shared", control: { kind: "agent", by: "scout" }, url: "https://example.com" },
        { tab: "t2", profile: "incognito", control: { kind: "user" }, url: "about:blank" },
      ],
    },
    "browser.cookie_sources": { sources: [{ id: "firefox", family: "firefox" }] },
    "browser.cookie_domains": { domains: [{ domain: "example.com", count: 7 }] },
  });
  assert.equal(
    await printed(() => browser(client, {}, ["tabs"])),
    "t1\tshared\tscout\thttps://example.com\nt2\tincognito\tuser\tabout:blank",
  );
  assert.equal(await printed(() => browser(client, {}, ["cookies"])), "firefox\tfirefox");
  assert.equal(await printed(() => browser(client, {}, ["cookies", "firefox", "example"])), "    7  example.com");
  assert.deepEqual(calls, [
    ["browser.tabs", {}],
    ["browser.cookie_sources", {}],
    ["browser.cookie_domains", { source: "firefox", filter: "example" }],
  ]);
  const empty = recordingClient({ "browser.tabs": { tabs: [] } });
  assert.equal(await printed(() => browser(empty.client, {}, ["tabs"])), "(no tabs)");
});

test("a screenshot writes the returned bytes to the requested file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-cli-shot-"));
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const file = path.join(dir, "shot.png");
    const { client, calls } = recordingClient({
      "browser.screenshot": { data: bytes.toString("base64"), bytes: bytes.length },
    });
    const out = await printed(() => browser(client, {}, ["shot", "t1", file]));
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.match(out, /\(4 bytes\)$/);
    assert.deepEqual(calls, [["browser.screenshot", { tab: "t1" }]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid browser arguments cannot cause protocol effects", async () => {
  const { client, calls } = recordingClient({});
  for (const args of [
    ["open"],
    ["nav", "t1"],
    ["snapshot"],
    ["click", "t1"],
    ["type", "t1", "e2"],
    ["import", "firefox"],
    ["control", "t1", "invalid"],
    ["close"],
    [],
    ["unknown"],
  ]) {
    await assert.rejects(browser(client, {}, args), /missing |mode must be |unknown browser command/);
  }
  assert.deepEqual(calls, []);
});

test("browser node failures propagate without a success message", async () => {
  const error = new Error("browser unavailable");
  const { client } = recordingClient({ "browser.open": error });
  assert.equal(
    await printed(async () => {
      await assert.rejects(browser(client, {}, ["open", "https://example.com"]), (e) => e === error);
    }),
    "",
  );
});
