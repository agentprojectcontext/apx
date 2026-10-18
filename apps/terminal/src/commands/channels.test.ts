import assert from "node:assert/strict";
import { test } from "node:test";
import { channels, contacts, pairing } from "./channels.ts";
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

test("recover asks for a chat's lost files and prints what came and why the rest did not", async () => {
  const { client, calls } = recordingClient({
    "channels.recover": {
      asked: 2,
      recovered: [{ message_id: "msg_1", name: "video.mp4" }],
      missing: [{ message_id: "msg_2", reason: "WhatsApp did not send this message again" }],
    },
  });
  const out = await printed(() => channels(client, ["recover", "thr_c"], {}));
  assert.deepEqual(calls, [["channels.recover", { thread: "thr_c" }]]);
  assert.equal(
    out,
    "recovered video.mp4  (msg_1)\nmissing   msg_2: WhatsApp did not send this message again\n1 of 2 recovered",
  );
  await assert.rejects(channels(client, ["recover"], {}), /apx channels recover/);
});

test("supervise finds the contact by name; suggestions are listed, sent with the owner's text or dropped", async () => {
  const draft = {
    id: "sug_1",
    person_id: "per_1",
    thread_id: "thr_c",
    channel: "telegram-main",
    said: ["hi", "tomorrow?"],
    text: "Tomorrow works",
    state: "pending",
    created_at: "",
  };
  const { client, calls } = recordingClient({
    ...answers,
    "contacts.set": person("per_1", "Alex Acme"),
    "contacts.suggestions.list": { suggestions: [draft] },
    "contacts.suggestions.send": { suggestion: { ...draft, state: "sent" }, delivery: { state: "sent" } },
    "contacts.suggestions.discard": { suggestion: { ...draft, state: "discarded" } },
  });
  assert.equal(await printed(() => contacts(client, ["supervise", "alex", "acme"])), "Alex Acme: supervised");
  const listed = await printed(() => contacts(client, ["suggestions"]));
  assert.match(listed, /sug_1 {2}Alex Acme: hi \/ tomorrow\?\n {4}→ Tomorrow works/);
  await contacts(client, ["suggestions", "send", "sug_1", "Friday", "then"]);
  await contacts(client, ["suggestions", "drop", "sug_1"]);
  assert.deepEqual(
    calls.filter(([m]) => m !== "contacts.list"),
    [
      ["contacts.set", { id: "per_1", name: "Alex Acme", supervised: true }],
      ["contacts.suggestions.list", {}],
      ["contacts.suggestions.send", { id: "sug_1", text: "Friday then" }],
      ["contacts.suggestions.discard", { id: "sug_1" }],
    ],
  );
});

test("pairing lists pending requests and explains an empty queue", async () => {
  const pending = recordingClient({
    "pairing.list": { requests: [{ code: "123456", channel: "telegram-main", name: "Alex", text: "Hello" }] },
  });
  assert.equal(await printed(() => pairing(pending.client, [])), "123456  telegram-main  Alex: Hello");
  assert.deepEqual(pending.calls, [["pairing.list", {}]]);
  const empty = recordingClient({ "pairing.list": { requests: [] } });
  assert.equal(await printed(() => pairing(empty.client, [])), "(nobody waiting)");
});

test("pairing decisions keep owner, contact and denial distinct and forward the complete contact name", async () => {
  for (const [sub, decision] of [
    ["me", "owner"],
    ["ok", "contact"],
    ["no", "deny"],
  ] as const) {
    const { client, calls } = recordingClient({
      "pairing.respond": decision === "deny" ? {} : { person: { name: "Alex Acme" } },
    });
    const rest = decision === "contact" ? ["Alex", "Acme"] : [];
    const output = await printed(() => pairing(client, [sub, "123456", ...rest]));
    assert.deepEqual(calls, [
      ["pairing.respond", { code: "123456", decision, ...(rest.length ? { name: "Alex Acme" } : {}) }],
    ]);
    assert.equal(output, decision === "deny" ? "dropped" : "linked to Alex Acme");
  }
});

test("malformed pairing commands change nothing and core refusals never print a linked result", async () => {
  const empty = recordingClient({});
  for (const args of [["unknown", "123456"], ["ok"], ["me"], ["no"]])
    await assert.rejects(pairing(empty.client, args), /apx pairing/);
  assert.deepEqual(empty.calls, []);
  const denied = recordingClient({ "pairing.respond": new Error("Code expired") });
  assert.equal(
    await printed(async () => {
      await assert.rejects(pairing(denied.client, ["ok", "123456"]), /Code expired/);
    }),
    "",
  );
  assert.deepEqual(denied.calls, [["pairing.respond", { code: "123456", decision: "contact" }]]);
});

test("blocking and unblocking preserve a contact's name; deleting uses only its exact id", async () => {
  const { client, calls } = recordingClient({
    "contacts.list": {
      persons: [
        {
          ...person("per_1", "Alex Acme"),
          addresses: [{ channel: "telegram-main", external_id: "123", label: "@alex" }],
        },
      ],
    },
    "contacts.set": person("per_1", "Alex Acme"),
    "contacts.remove": { removed: true },
  });
  for (const [command, role] of [
    ["block", "blocked"],
    ["unblock", "contact"],
  ]) {
    const output = await printed(() => contacts(client, [command as string, "per_1"]));
    assert.match(output, /Alex Acme.*telegram-main:@alex/);
    assert.deepEqual(calls.at(-2), ["contacts.set", { id: "per_1", name: "Alex Acme", role }]);
  }
  await printed(() => contacts(client, ["rm", "per_1"]));
  assert.deepEqual(calls.at(-2), ["contacts.remove", { id: "per_1" }]);
  calls.length = 0;
  await assert.rejects(contacts(client, ["block", "missing"]), /no person missing/);
  assert.deepEqual(calls, [["contacts.list", {}]]);
});
