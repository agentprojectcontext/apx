import assert from "node:assert/strict";
import { test } from "node:test";
import { clients } from "./clients.ts";
import { printed, recordingClient } from "./testing.ts";

test("connected apps list scopes and last use without exposing tokens", async () => {
  const { client, calls } = recordingClient({
    "clients.list": { clients: [{ id: "app_1", name: "Acme", scopes: ["chat", "browser"], last_used_at: null }] },
  });
  assert.equal(await printed(() => clients(client, [], {})), "app_1  Acme  · chat, browser  · never used");
  assert.deepEqual(calls, [["clients.list", {}]]);
  const empty = recordingClient({ "clients.list": { clients: [] } });
  assert.match(await printed(() => clients(empty.client, [], {})), /^\(no connected apps\)/);
});

test("adding an app defaults to chat, trims explicit scopes and shows its token once", async () => {
  for (const scopes of [undefined, " chat, browser "]) {
    const expected = scopes ? ["chat", "browser"] : ["chat"];
    const { client, calls } = recordingClient({
      "clients.create": { client: { id: "app_1", name: "Acme", scopes: expected }, token: "test-client-token" },
    });
    const out = await printed(() => clients(client, ["add", "Acme"], { scopes }));
    assert.deepEqual(calls, [["clients.create", { name: "Acme", scopes: expected }]]);
    assert.equal(out.split("test-client-token").length - 1, 1);
    assert.match(out, /never as you/);
  }
});

test("revoking an app reports whether it existed; malformed commands never call the core", async () => {
  for (const revoked of [true, false]) {
    const { client, calls } = recordingClient({ "clients.revoke": { revoked } });
    assert.equal(await printed(() => clients(client, ["rm", "app_1"], {})), revoked ? "revoked" : "no such client");
    assert.deepEqual(calls, [["clients.revoke", { id: "app_1" }]]);
  }
  const { client, calls } = recordingClient({});
  for (const args of [["add"], ["rm"], ["unknown"]]) await assert.rejects(clients(client, args, {}), /apx clients/);
  assert.deepEqual(calls, []);
});

test("client errors propagate instead of printing success", async () => {
  const error = new Error("owner authorization required");
  const { client } = recordingClient({ "clients.create": error });
  assert.equal(
    await printed(async () => {
      await assert.rejects(clients(client, ["add", "Acme"], {}), (e) => e === error);
    }),
    "",
  );
});
