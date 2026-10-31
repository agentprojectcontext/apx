import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";

test("only explicitly published widgets are readable through public ingress, never their private state or actions", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const surface = env.core.store.surfaces.upsert({
      name: "acme",
      title: "Acme page",
      html: '<script src="/_apx/kit@1.js"></script><h1>Public content</h1>',
      created_by: "superagent",
      connect: ["https://example.com"],
    });
    env.core.store.surfaces.setState(surface.id, { privateMarker: "private-state-must-not-leak" });
    const port = (await env.client.call("webhooks.get", {})).port;
    const url = `http://127.0.0.1:${port}`;
    assert.equal(surface.share_path, undefined);
    assert.equal((await fetch(`${url}/a/${surface.id}`)).status, 404);
    assert.equal((await fetch(`${url}/a/${"a".repeat(32)}`)).status, 404);
    const shared = await env.client.call("surfaces.share", { surface: surface.id, shared: true });
    assert.ok(shared.share_path);
    const page = await fetch(`${url}${shared.share_path}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("Public content"));
    assert.ok(html.includes("window.APX"), "kit is inline without needing the private host");
    assert.equal(html.includes("private-state-must-not-leak"), false);
    assert.equal(html.includes(surface.id), false);
    const csp = page.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("connect-src 'none'"));
    assert.ok(csp.includes("form-action 'none'"));
    assert.equal(csp.includes("allow-same-origin"), false);
    assert.equal(csp.includes("allow-forms"), false);
    assert.equal(
      csp.includes("https://example.com"),
      false,
      "public pages cannot call even declared integration origins",
    );
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(`${url}${shared.share_path}`, { method: "POST", body: "{}" })).status, 405);
    const head = await fetch(`${url}${shared.share_path}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const path of [
      "/rpc/surfaces.store_get",
      "/rpc/surfaces.state_set",
      "/media/private.png",
      "/health",
      "/",
      `${shared.share_path}/state`,
      `${shared.share_path}/media/private.png`,
    ])
      assert.equal((await fetch(`${url}${path}`)).status, 404, path);
    assert.equal((await fetch(`${url}/_apx/kit@1.js`)).status, 200);
    assert.equal((await fetch(`${url}/_apx/kit@1.js`, { method: "POST" })).status, 405);
    await env.client.call("surfaces.share", { surface: surface.id, shared: false });
    assert.equal((await fetch(`${url}${shared.share_path}`)).status, 404);
    const again = await env.client.call("surfaces.share", { surface: surface.id, shared: true });
    assert.notEqual(again.share_path, shared.share_path, "unpublish invalidates the old link permanently");
    assert.equal((await fetch(`${url}${again.share_path}`)).status, 200);
    env.core.store.surfaces.remove(surface.id);
    assert.equal((await fetch(`${url}${again.share_path}`)).status, 404);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
