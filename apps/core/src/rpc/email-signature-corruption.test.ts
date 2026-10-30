import assert from "node:assert/strict";
import { test } from "node:test";
import { signatureFor } from "../domain/email-signature-settings.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const gmail = {
  transport: "gmail" as const,
  account: "user@example.com",
  sender: "user@example.com",
  enabled: false,
  text: "",
};
const smtp = { ...gmail, transport: "smtp" as const, account: "mailbox-two", enabled: true, text: "Acme" };
const fallback = { enabled: true, text: "Global" };
const corruptError = /Stored email signatures are invalid/;

for (const [label, corrupt] of [
  ["JSON", "["],
  ["schema", JSON.stringify([gmail, { ...smtp, enabled: "false" }])],
] as const) {
  test(`${label} corruption blocks partial edits and reads without losing opt-outs`, async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const store = env.core.store;
      store.settings.set("google_account:gmail", gmail.account);
      await env.client.call("channels.set", {
        id: smtp.account,
        channel: {
          type: "email",
          agent_id: "superagent",
          enabled: false,
          email: {
            address: smtp.sender,
            imap: { host: "mail.example.com", port: 993, tls: "implicit" },
            smtp: { host: "mail.example.com", port: 465, tls: "implicit" },
          },
        },
      });
      store.settings.write("email_signature_default", fallback);
      store.settings.write("email_signatures", [gmail]);
      assert.equal(signatureFor(store, "gmail", gmail.account, gmail.sender), undefined);
      store.settings.set("email_signatures", corrupt);
      const socket = await env.client.connect();
      try {
        for (const client of [env.client, socket]) {
          // Creating a different mailbox must not discard an unreadable opt-out.
          await assert.rejects(
            client.call("email.signature_upsert", { signature: smtp, expected: null }),
            corruptError,
          );
          await assert.rejects(
            client.call("email.signature_upsert", {
              signature: { ...gmail, enabled: true, text: "New" },
              expected: gmail,
            }),
            corruptError,
          );
          const { transport, account, sender } = gmail;
          await assert.rejects(
            client.call("email.signature_remove", { key: { transport, account, sender }, expected: gmail }),
            corruptError,
          );
          await assert.rejects(client.call("email.signatures_get", {}), corruptError);
          assert.equal(store.settings.get("email_signatures"), corrupt);
          assert.equal(signatureFor(store, "gmail", gmail.account, gmail.sender), undefined);
          assert.equal(signatureFor(store, "smtp", smtp.account, smtp.sender), undefined);
        }
      } finally {
        socket.close();
      }
      // Replacing the complete list is an explicit recovery, unlike a partial edit.
      await env.client.call("email.signatures_set", { signatures: [gmail] });
      await env.client.call("email.signature_upsert", { signature: smtp, expected: null });
      assert.deepEqual((await env.client.call("email.signatures_get", {})).signatures, [gmail, smtp]);
      assert.equal(signatureFor(store, "gmail", gmail.account, gmail.sender), undefined);
      await env.client.call("email.signatures_set", { signatures: [] });
      await env.client.call("email.signature_upsert", { signature: gmail, expected: null });
      await env.client.call("email.signature_remove", {
        key: { transport: gmail.transport, account: gmail.account, sender: gmail.sender },
        expected: gmail,
      });
      assert.deepEqual((await env.client.call("email.signatures_get", {})).signatures, []);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("a missing signature record remains readable and partially editable", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    store.settings.set("google_account:gmail", gmail.account);
    assert.equal(store.settings.get("email_signatures"), undefined);
    assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures: [] });
    await env.client.call("email.signature_upsert", { signature: gmail, expected: null });
    assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures: [gmail] });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
