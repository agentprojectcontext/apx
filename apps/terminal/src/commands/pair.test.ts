import assert from "node:assert/strict";
import { test } from "node:test";
import { pair } from "./pair.ts";
import { printed, recordingClient } from "./testing.ts";

test("pairing on loopback explains exposure without inventing a usable link", async () => {
  const { client, calls } = recordingClient({
    "devices.pair_start": { code: "123456", expires_at: "2000-01-01T00:00:00Z", urls: [] },
  });
  const out = await printed(() => pair(client));
  assert.match(out, /Pairing code: 123456/);
  assert.match(out, /about 1 min/);
  assert.match(out, /apx expose tailscale \| lan/);
  assert.doesNotMatch(out, /apx:\/\/pair/);
  assert.deepEqual(calls, [["devices.pair_start", {}]]);
});

test("pairing prints every reachable URL and a link encoding both URLs and the one-time code", async () => {
  const urls = ["https://core.example.com", "http://192.0.2.10:7440"];
  const { client } = recordingClient({
    "devices.pair_start": { code: "123456", expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), urls },
  });
  const out = await printed(() => pair(client));
  for (const url of urls) assert.ok(out.includes(`  ${url}`));
  const match = out.match(/apx:\/\/pair\?\S+/)?.[0];
  assert.ok(match, out);
  const link = new URL(match);
  assert.equal(link.searchParams.get("c"), "123456");
  assert.deepEqual(link.searchParams.getAll("u"), urls);
});

test("failed pairing never prints a code", async () => {
  const error = new Error("pairing disabled");
  const { client } = recordingClient({ "devices.pair_start": error });
  assert.equal(
    await printed(async () => {
      await assert.rejects(pair(client), (e) => e === error);
    }),
    "",
  );
});
