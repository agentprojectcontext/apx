import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { signatureFor } from "../domain/email-signature-settings.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
const gmail = {
  transport: "gmail" as const,
  account: "user@example.com",
  sender: "user@example.com",
  enabled: true,
  text: "Acme",
  html: "<b>Acme</b>",
};
const smtp = { ...gmail, transport: "smtp" as const, account: "channel_email" };

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("signature configuration round-trips through the running core and is isolated by account and sender", async () => {
  assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures: [] });
  const signatures = [gmail, smtp, { ...smtp, account: "disabled", enabled: false }];
  assert.deepEqual(await env.client.call("email.signatures_set", { signatures }), { signatures });
  assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures });
  const store = env.core.store;
  assert.deepEqual(signatureFor(store, "gmail", "USER@example.com", "USER@example.com"), gmail);
  assert.deepEqual(signatureFor(store, "smtp", "channel_email", "user@example.com"), smtp);
  assert.equal(signatureFor(store, "smtp", "CHANNEL_EMAIL", "user@example.com"), undefined);
  assert.equal(signatureFor(store, "gmail", "other@example.com", "user@example.com"), undefined);
  assert.equal(signatureFor(store, "gmail", "user@example.com", "alias@example.com"), undefined);
  assert.equal(signatureFor(store, "gmail", undefined, "user@example.com"), undefined);
  assert.equal(signatureFor(store, "smtp", "disabled", "user@example.com"), undefined);
});

test("agents cannot read or change signature configuration", async () => {
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(agent.call("email.signatures_get", {}), /reserved to the owner/);
  await assert.rejects(agent.call("email.signatures_set", { signatures: [] }), /reserved to the owner/);
  assert.deepEqual(signatureFor(env.core.store, "gmail", gmail.account, gmail.sender), gmail);
});

test("invalid signatures cannot replace valid configuration", async () => {
  await assert.rejects(
    env.client.call("email.signatures_set", { signatures: [{ ...gmail, html: "<script>alert(1)</script>" }] }),
    /invalid params/,
  );
  await assert.rejects(env.client.call("email.signatures_set", { signatures: [gmail, gmail] }), /invalid params/);
  assert.deepEqual(signatureFor(env.core.store, "gmail", gmail.account, gmail.sender), gmail);
});

test("corrupt persisted configuration fails closed", () => {
  env.core.store.settings.set("email_signatures", JSON.stringify([{ ...gmail, html: "<script>x</script>" }]));
  assert.equal(signatureFor(env.core.store, "gmail", gmail.account, gmail.sender), undefined);
});
