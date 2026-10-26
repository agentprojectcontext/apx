import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { SPANISH_TITLES } from "../engine/tool-titles.ts";
import { waitFor } from "../testkit/platform.ts";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
const gmail = {
  transport: "gmail" as const,
  account: "user@example.com",
  sender: "user@example.com",
  enabled: true,
  text: "Acme",
  html: "<b>Acme</b>",
};
const smtp = { ...gmail, transport: "smtp" as const, account: "email" };
const key = ({ transport, account, sender }: typeof gmail | typeof smtp) => ({ transport, account, sender });

before(async () => {
  h = await settingsCore();
  const store = h.env.core.store;
  store.settings.set("google_account:gmail", gmail.account);
  await h.env.client.call("channels.set", {
    id: "email",
    channel: {
      type: "email",
      agent_id: "roby",
      enabled: false,
      email: {
        address: smtp.sender,
        imap: { host: "mail.example.com", port: 993, tls: "implicit" },
        smtp: { host: "mail.example.com", port: 465, tls: "implicit" },
      },
    },
  });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const all = async () => (await h.env.client.call("email.signatures_get", {})).signatures;

test("signature settings discover identities, require approval, and preserve other mailboxes", async () => {
  const index = await h.ask({ method: "email.signatures_get" });
  assert.match(index.answer, /user@example.com/);
  assert.match(index.answer, /smtp/);
  assert.equal(index.detail, "");
  const absent = await h.ask({ method: "email.signatures_get", params: key(gmail) });
  assert.match(absent.answer, /"signature":null/);
  const create = { method: "email.signature_upsert", params: { signature: gmail, expected: null } };
  await h.ask(create, "deny");
  assert.deepEqual(await all(), []);
  const approved = await h.ask(create, "approve");
  assert.match(approved.detail, /Change the local email signature/);
  assert.match(approved.detail, /Acme/);
  assert.deepEqual(await all(), [gmail]);
  await h.ask({ method: "email.signature_upsert", params: { signature: smtp, expected: null } }, "approve");
  const changed = { ...gmail, text: "Northwind" };
  await h.ask({ method: "email.signature_upsert", params: { signature: changed, expected: gmail } }, "approve");
  assert.deepEqual(await all(), [smtp, changed]);
  const read = await h.ask({ method: "email.signatures_get", params: key(gmail) });
  assert.match(read.answer, /Northwind/);
  await h.ask({ method: "email.signature_remove", params: { key: key(gmail), expected: changed } }, "approve");
  assert.deepEqual(await all(), [smtp]);
});

test("RPC rejects unapproved agents, stale snapshots, unknown accounts, aliases and unsafe markup", async () => {
  const agent = new ApxClient({ url: h.env.core.url, actor: "agent" });
  await assert.rejects(
    agent.call("email.signature_upsert", { signature: gmail, expected: null }),
    /reserved to the owner/,
  );
  await assert.rejects(
    agent.call("email.signature_remove", { key: key(smtp), expected: smtp }),
    /reserved to the owner/,
  );
  const client = h.env.client;
  await client.call("email.signature_upsert", { signature: gmail, expected: null });
  await assert.rejects(
    client.call("email.signature_upsert", { signature: { ...gmail, text: "Overwrite" }, expected: null }),
    /Signature changed/,
  );
  await assert.rejects(
    client.call("email.signature_remove", { key: key(gmail), expected: { ...gmail, text: "Stale" } }),
    /Signature changed/,
  );
  for (const signature of [
    { ...gmail, account: "other@example.com" },
    { ...gmail, sender: "alias@example.com" },
    { ...smtp, sender: "alias@example.com" },
    { ...smtp, account: "EMAIL" },
  ])
    await assert.rejects(
      client.call("email.signature_upsert", { signature, expected: null }),
      /configured Gmail account or SMTP/,
    );
  for (const html of [
    '<img src="http://example.com/logo.png">',
    '<img src="https://example.com/logo.png" onerror="alert(1)">',
    "<script>alert(1)</script>",
  ])
    await assert.rejects(
      client.call("email.signature_upsert", { signature: { ...gmail, html }, expected: gmail }),
      /invalid params/,
    );
  assert.deepEqual(await all(), [smtp, gmail]);
});

test("sealed contacts cannot read signature settings or request their modification", async () => {
  const person = await h.env.client.call("contacts.set", { name: "Acme Buyer" });
  const thread = h.env.core.store.threads.create({
    kind: "channel",
    title: person.name,
    agent_ids: ["roby"],
    channel: { id: "test", conversation: person.id, person_id: person.id },
  });
  const before = await all();
  for (const call of [
    { method: "email.signatures_get" },
    { method: "email.signature_upsert", params: { signature: { ...gmail, text: "Forged" }, expected: gmail } },
  ]) {
    await h.env.client.call("threads.send", { thread: thread.id, text: JSON.stringify(call) });
    await h.env.settle(thread.id);
    assert.ok(!h.llm.calls.at(-1)?.tools.some((t) => t.function.name === "apx_settings"));
    assert.deepEqual((await h.env.client.call("runs.pending", { thread: thread.id })).inputs, []);
    assert.deepEqual(await all(), before);
  }
});

test("email signature tool titles identify edits and removals in Spanish", () => {
  assert.equal(
    SPANISH_TITLES.apx_settings?.({ method: "email.signature_upsert", params: {} }),
    "Cambió una firma de email",
  );
  assert.equal(
    SPANISH_TITLES.apx_settings?.({ method: "email.signature_remove", params: {} }),
    "Quitó una firma de email",
  );
});

test("signature count limit rejects creation without losing existing entries", async () => {
  const before = await all();
  const signatures = Array.from({ length: 100 }, (_, i) => ({ ...smtp, account: `mailbox-${i}` }));
  await h.env.client.call("email.signatures_set", { signatures });
  try {
    await assert.rejects(
      h.env.client.call("email.signature_upsert", { signature: gmail, expected: null }),
      /Signature limit exceeded/,
    );
    assert.deepEqual(await all(), signatures);
  } finally {
    await h.env.client.call("email.signatures_set", { signatures: before });
  }
});

test("even Total requires owner approval, and an edit during approval fails closed", async () => {
  const client = h.env.client;
  await client.call("agents.update", { agent: "roby", autonomy: "total" });
  const concurrent = { ...gmail, text: "Concurrent owner edit" };
  try {
    const thread = await client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Signature approval",
    });
    await client.call("threads.send", {
      thread: thread.id,
      text: JSON.stringify({
        method: "email.signature_upsert",
        params: { signature: { ...gmail, text: "Proposed" }, expected: gmail },
      }),
    });
    let input = "";
    await waitFor(async () => {
      input =
        (await client.call("runs.pending", { thread: thread.id })).inputs.find((i) => i.tool === "apx_settings")?.id ??
        "";
      return !!input;
    }, "signature owner approval");
    assert.deepEqual(await all(), [smtp, gmail]);
    await client.call("email.signature_upsert", { signature: concurrent, expected: gmail });
    await client.call("runs.respond", { input, decision: "approve" });
    await h.env.settle(thread.id);
    assert.match(String(h.llm.calls.at(-1)?.messages.at(-1)?.content), /Signature changed/);
    assert.deepEqual(await all(), [smtp, concurrent]);
    await client.call("email.signature_upsert", { signature: gmail, expected: concurrent });
  } finally {
    await client.call("agents.update", { agent: "roby", autonomy: null });
  }
});

test("removal refuses disconnected accounts and foreign senders without losing signatures", async () => {
  const client = h.env.client;
  const store = h.env.core.store;
  const before = await all();
  store.settings.set("google_account:gmail", "");
  try {
    await assert.rejects(
      client.call("email.signature_remove", { key: key(gmail), expected: gmail }),
      /configured Gmail account or SMTP/,
    );
    assert.deepEqual(await all(), before);
  } finally {
    store.settings.set("google_account:gmail", gmail.account);
  }
  const foreign = { ...smtp, sender: "alias@example.com" };
  await client.call("email.signatures_set", { signatures: [...before, foreign] });
  try {
    await assert.rejects(
      client.call("email.signature_remove", { key: key(foreign), expected: foreign }),
      /configured Gmail account or SMTP/,
    );
    assert.deepEqual(await all(), [...before, foreign]);
  } finally {
    await client.call("email.signatures_set", { signatures: before });
  }
});

test("idempotent retry cannot overwrite a later signature edit", async () => {
  const client = h.env.client;
  const edited = { ...gmail, text: "First" };
  const params = { signature: edited, expected: gmail };
  const options = "signature-first-edit";
  await client.call("email.signature_upsert", params, options);
  const latest = { ...gmail, text: "Latest" };
  await client.call("email.signature_upsert", { signature: latest, expected: edited });
  await client.call("email.signature_upsert", params, options);
  assert.deepEqual(await all(), [smtp, latest]);
});
