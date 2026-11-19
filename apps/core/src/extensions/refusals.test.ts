import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExtensionRefusal } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { zipFiles } from "./zip.test-support.ts";

// What the install box shows before and after adding: where it connects, the tools its listing names, and why a
// package was refused in a way the panel can say in the owner's words.

const served = new Map<string, Buffer>();
const manifest = (extra: Record<string, unknown> = {}) => ({
  id: "billing",
  name: "Northwind Billing",
  version: "1.0.0",
  description: "Invoices and payments.",
  mcp: { service: { command: "npx", args: ["-y", "mcp-remote", "https://mcp.billing.example.com"] } },
  ...extra,
});
const pack = (m: unknown, listing?: unknown) =>
  zipFiles({
    "apx-extension.json": JSON.stringify(m),
    ...(listing ? { "apx-listing.json": JSON.stringify(listing) } : {}),
  });
const file = (buf: Buffer) => ({ name: "billing.apxext", data: buf.toString("base64") });
const reason = (p: Promise<unknown>, want: ExtensionRefusal) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ApxError);
    assert.deepEqual(e.detail, want);
    return true;
  });

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;

before(async () => {
  home = tempDir("apx-refusals-");
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    releases: { version: () => "2.17.0", notes: () => undefined },
    extensionFetch: (async (url: string | URL) => {
      const body = served.get(String(url));
      if (body === undefined) throw new TypeError("fetch failed");
      return new Response(body);
    }) as typeof fetch,
  });
});
after(async () => {
  await env.core.close();
  await home.remove();
});

test("a command that bridges to a remote server shows that server's host before it is added", async () => {
  const seen = await env.client.call("extensions.inspect", { file: file(pack(manifest())) });
  assert.deepEqual(seen.hosts, ["mcp.billing.example.com"]);
  assert.equal(seen.runs_code, true);
  // Its page shows the address the program connects to, not "this computer".
  assert.deepEqual(seen.connectors, [{ name: "service", url: "https://mcp.billing.example.com", runs_here: true }]);
});

test("a server at an address shows it, and one at the owner's own address says so without one", async () => {
  const seen = await env.client.call("extensions.inspect", {
    file: file(
      pack(
        manifest({
          mcp: {
            cloud: { url: "https://mcp.billing.example.com/mcp" },
            mine: { url: "https://setting://domain/mcp" },
          },
          settings: [{ name: "domain", label: "Your domain", type: "string", required: true }],
        }),
      ),
    ),
  });
  assert.deepEqual(seen.connectors, [
    { name: "cloud", url: "https://mcp.billing.example.com/mcp", runs_here: false },
    { name: "mine", owner_url: true, runs_here: false },
  ]);
});

test("the tools its listing names are shown before adding, in the owner's language", async () => {
  const listing = {
    summary: "Invoices and payments.",
    tools: [{ name: "list_invoices", description: "Lists invoices" }, { name: "get_payment" }],
    locales: {
      es: { summary: "Facturas y pagos.", tools: [{ name: "list_invoices", description: "Lista facturas" }] },
    },
  };
  const seen = await env.client.call("extensions.inspect", { file: file(pack(manifest(), listing)) });
  assert.deepEqual(seen.listing?.tools, [
    { name: "list_invoices", description: "Lists invoices" },
    { name: "get_payment" },
  ]);
  assert.deepEqual(seen.listing?.es?.tools, [{ name: "list_invoices", description: "Lista facturas" }]);
});

test("an extension written for a newer APX is refused with the version it needs", async () => {
  await reason(env.client.call("extensions.inspect", { file: file(pack(manifest({ min_apx: "99.0.0" }))) }), {
    reason: "newer_apx",
    needs: "99.0.0",
  });
  // A field this APX does not know comes from a newer one too.
  await reason(env.client.call("extensions.inspect", { file: file(pack(manifest({ voice: { on: true } }))) }), {
    reason: "newer_apx",
  });
  // One that asks for an older APX reads fine.
  const ok = await env.client.call("extensions.inspect", { file: file(pack(manifest({ min_apx: "0.1.0" }))) });
  assert.equal(ok.id, "billing");
});

test("a download that fails, broken files and files changed since they were looked at each say why", async () => {
  await reason(env.client.call("extensions.inspect", { url: "https://dl.example.com/billing.apxext" }), {
    reason: "download",
  });
  await reason(env.client.call("extensions.inspect", { file: file(pack({ name: "no id" })) }), {
    reason: "invalid",
  });
  const buf = pack(manifest());
  await reason(env.client.call("extensions.install", { file: file(buf), hash: "0000000000000000" }), {
    reason: "changed",
  });
});
