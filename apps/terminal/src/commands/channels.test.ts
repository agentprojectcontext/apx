import assert from "node:assert/strict";
import { test } from "node:test";
import { channels } from "./channels.ts";
import { printed, recordingClient } from "./testing.ts";

const person = (id: string, name: string) => ({ id, name, role: "contact", addresses: [], created_at: "" });
const answers = {
  "contacts.list": { persons: [person("per_1", "Alex Acme"), person("per_2", "Sam"), person("per_3", "Sam")] },
  "channels.open": { id: "thr_c" },
  "channels.send": { ok: true },
};

test("send opens the contact's chat on the channel and writes in it, found by name or id", async () => {
  const { client, calls } = recordingClient(answers);
  const out = await printed(() => channels(client, ["send", "telegram-main", "alex acme", "On", "my", "way"], {}));
  assert.equal(out, "sent to Alex Acme on telegram-main");
  await channels(client, ["send", "telegram-main", "per_2", "Hi"], {});
  assert.deepEqual(calls, [
    ["contacts.list", {}],
    ["channels.open", { person: "per_1", channel: "telegram-main" }],
    ["channels.send", { thread: "thr_c", text: "On my way" }],
    ["contacts.list", {}],
    ["channels.open", { person: "per_2", channel: "telegram-main" }],
    ["channels.send", { thread: "thr_c", text: "Hi" }],
  ]);
});

test("send refuses an unknown or ambiguous contact and a missing text, sending nothing", async () => {
  const { client, calls } = recordingClient(answers);
  await assert.rejects(channels(client, ["send", "telegram-main", "Sam", "Hi"], {}), /2 contacts are named Sam/);
  await assert.rejects(channels(client, ["send", "telegram-main", "Nobody", "Hi"], {}), /no contact Nobody/);
  await assert.rejects(channels(client, ["send", "telegram-main", "per_1"], {}), /apx channels send/);
  assert.ok(!calls.some(([m]) => m !== "contacts.list"));
});
