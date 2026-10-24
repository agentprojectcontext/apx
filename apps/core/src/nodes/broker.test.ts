import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { removeDir } from "../testkit/platform.ts";

let core: Awaited<ReturnType<typeof createCore>>;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-broker-"));

before(async () => {
  core = await createCore(testConfig({ home }), { quiet: true });
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("browser.* fails fast with `unavailable` when no node offers the capability; listing tabs is just empty", async () => {
  const client = new ApxClient({ url: core.url });
  assert.deepEqual(await client.call("browser.tabs", {}), { tabs: [] });
  const err = await client.call("browser.open", { url: "https://example.com" }).catch((e: unknown) => e);
  assert.ok(err instanceof ApxError);
  assert.equal(err.code, "unavailable");
  const h = await client.call("system.health", {});
  assert.equal(h.subsystems.browser?.status, "off");
});

test("an operator call is routed to the node and its answer comes back validated", async () => {
  const nodeClient = new ApxClient({ url: core.url, client: { name: "fake-desktop", version: "0" } });
  const node = await nodeClient.connect("node", ["browser"]);
  const seen: Array<{ method: string; params: unknown }> = [];
  node.onRequest(async (method, params) => {
    seen.push({ method, params });
    if (method === "browser.open") {
      return {
        tab: "t1",
        url: "https://example.com/",
        title: "Example",
        profile: "incognito",
        control: { kind: "idle" },
      };
    }
    throw new ApxError({ code: "paused_by_user", message: "user has the tab" });
  });

  const operator = new ApxClient({ url: core.url });
  const tab = await operator.call("browser.open", { url: "https://example.com", profile: "incognito" });
  assert.equal(tab.tab, "t1");
  // Defaults are applied by the core before forwarding, so the node sees the full params.
  assert.deepEqual(seen[0], {
    method: "browser.open",
    params: { url: "https://example.com", profile: "incognito", by: "operator" },
  });

  const paused = await operator.call("browser.click", { tab: "t1", ref: "e1" }).catch((e: unknown) => e);
  assert.ok(paused instanceof ApxError);
  assert.equal(paused.code, "paused_by_user");

  node.close();
  await node.closed;
});

test("a node that answers with the wrong shape surfaces as an error, not as bad data", async () => {
  const node = await new ApxClient({ url: core.url, client: { name: "bad-node", version: "0" } }).connect("node", [
    "browser",
  ]);
  node.onRequest(async () => ({ tabs: "not-an-array" }));
  const err = await new ApxClient({ url: core.url }).call("browser.tabs", {}).catch((e: unknown) => e);
  assert.ok(err instanceof ApxError);
  assert.equal(err.code, "internal");
  node.close();
  await node.closed;
});
