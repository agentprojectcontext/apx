import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithinOrigin } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createSecrets, projectSecretName } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { connectionErrors } from "./connection-errors.ts";

test("connection diagnostics remember the exact project, environment and inline values used before rotation", async () => {
  const home = tempDir("apx-connection-errors-");
  try {
    const secrets = createSecrets(home.path, "file", { ACME_KEY: "environment-value" });
    secrets.set("key", "global-value");
    secrets.set(projectSecretName("acme", "key"), 'project-value+/="');
    const errors = connectionErrors((ref) => secrets.resolveIn(ref, ["acme"]));
    assert.equal(errors.fill("Bearer secret://key"), 'Bearer project-value+/="');
    assert.equal(errors.fill("env:ACME_KEY"), "environment-value");
    assert.equal(errors.fill("secret://missing"), "secret://missing");
    secrets.set(projectSecretName("acme", "key"), "replacement-value");
    for (const value of [
      'project-value+/="',
      encodeURIComponent('project-value+/="'),
      JSON.stringify('project-value+/="').slice(1, -1),
      "environment-value",
    ]) {
      assert.ok(!errors.message(new Error(`gateway failed at /capture/${value}`)).includes(value));
    }
    assert.match(errors.message(new Error("gateway unavailable")), /gateway unavailable/);
  } finally {
    await home.remove();
  }
});

test("the redirect policy permits only same-origin or default-port HTTPS upgrades and preserves POST", async () => {
  for (const [from, to, allowed] of [
    ["http://acme.example/mcp", "https://acme.example/mcp", true],
    ["https://acme.example/mcp", "https://acme.example/other", true],
    ["https://acme.example/mcp", "http://acme.example/mcp", false],
    ["http://acme.example:8080/mcp", "https://acme.example/mcp", false],
    ["https://acme.example/mcp", "https://northwind.example/mcp", false],
  ] as const) {
    for (const status of [301, 302, 303, 307, 308]) {
      const requested: string[] = [];
      const fetch = fetchWithinOrigin(async (url) => {
        requested.push(String(url));
        return requested.length === 1 ? new Response(null, { status, headers: { location: to } }) : new Response("ok");
      });
      await fetch(from, { method: "POST", body: "initialization" });
      assert.deepEqual(requested, allowed && (status === 307 || status === 308) ? [from, to] : [from]);
    }
  }
});
