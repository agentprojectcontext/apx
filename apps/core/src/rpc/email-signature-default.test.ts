import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { signatureFor } from "../domain/email-signature-settings.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const fallback = { enabled: true, text: "Acme global", html: "<b>Acme global</b>" };

for (const transport of ["gmail", "smtp"] as const) {
  test(`${transport}: corrupt overrides cannot enable the global default`, async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const store = env.core.store;
      const disabled = {
        transport,
        account: transport === "gmail" ? "user@example.com" : "mailbox-off",
        sender: "user@example.com",
        enabled: false,
        text: "",
      };
      const selected = () => signatureFor(store, transport, disabled.account, disabled.sender);
      store.settings.write("email_signature_default", fallback);
      assert.equal(store.settings.get("email_signatures"), undefined);
      assert.deepEqual(selected(), fallback);
      store.settings.write("email_signatures", [disabled]);
      assert.equal(selected(), undefined);
      for (const corrupt of [
        "[",
        "null",
        JSON.stringify([{ ...disabled, enabled: "false" }]),
        JSON.stringify([disabled, { ...disabled, sender: "alias@example.com", html: "<script>x</script>" }]),
      ]) {
        store.settings.set("email_signatures", corrupt);
        assert.equal(selected(), undefined, `Corrupt setting must block fallback: ${corrupt}`);
      }
      store.settings.write("email_signatures", []);
      assert.deepEqual(selected(), fallback);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("the optional default is independent of connections, owner-only and protected against stale edits", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    assert.deepEqual(await env.client.call("email.signature_default_get", {}), { signature: null });
    assert.deepEqual(await env.client.call("email.signature_default_set", { signature: fallback, expected: null }), {
      signature: fallback,
    });
    assert.deepEqual(await env.client.call("email.signature_default_get", {}), { signature: fallback });
    const socket = await env.client.connect();
    try {
      assert.deepEqual(await socket.call("email.signature_default_get", {}), { signature: fallback });
      await socket.call("email.signature_default_set", {
        signature: { ...fallback, enabled: false },
        expected: fallback,
      });
      await socket.call("email.signature_default_set", {
        signature: fallback,
        expected: { ...fallback, enabled: false },
      });
    } finally {
      socket.close();
    }
    await assert.rejects(
      env.client.call("email.signature_default_set", { signature: null, expected: null }),
      /Default signature changed/,
    );
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("email.signature_default_get", {}), /reserved to the owner/);
    await assert.rejects(
      agent.call("email.signature_default_set", { signature: null, expected: fallback }),
      /reserved to the owner/,
    );
    const agentSocket = await agent.connect();
    try {
      const signature = {
        transport: "smtp" as const,
        account: "mailbox-one",
        sender: "user@example.com",
        ...fallback,
      };
      await assert.rejects(agentSocket.call("email.signature_default_get", {}), /reserved to the owner/);
      await assert.rejects(
        agentSocket.call("email.signature_default_set", { signature: null, expected: fallback }),
        /reserved to the owner/,
      );
      await assert.rejects(agentSocket.call("email.signatures_get", {}), /reserved to the owner/);
      await assert.rejects(
        agentSocket.call("email.signatures_set", { signatures: [signature] }),
        /reserved to the owner/,
      );
      await assert.rejects(
        agentSocket.call("email.signature_upsert", { signature, expected: null }),
        /reserved to the owner/,
      );
      await assert.rejects(
        agentSocket.call("email.signature_remove", {
          key: { transport: signature.transport, account: signature.account, sender: signature.sender },
          expected: signature,
        }),
        /reserved to the owner/,
      );
    } finally {
      agentSocket.close();
    }
    await assert.rejects(
      env.client.call("email.signature_default_set", {
        signature: { ...fallback, html: "<script>x</script>" },
        expected: fallback,
      }),
      /invalid params/,
    );
    assert.deepEqual(await env.client.call("email.signature_default_get", {}), { signature: fallback });
    assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures: [] });
    await env.client.call("email.signature_default_set", { signature: null, expected: fallback });
    assert.deepEqual(await env.client.call("email.signature_default_get", {}), { signature: null });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("account override wins, explicit disable blocks fallback, removal restores it without copying signatures", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("email.signature_default_set", { signature: fallback, expected: null });
    const store = env.core.store;
    const gmail = {
      transport: "gmail" as const,
      account: "user@example.com",
      sender: "user@example.com",
      enabled: true,
      text: "Specific",
    };
    const smtp = { ...gmail, transport: "smtp" as const, account: "mailbox-one" };
    await env.client.call("email.signatures_set", {
      signatures: [gmail, smtp, { ...smtp, account: "mailbox-off", enabled: false, text: "" }],
    });
    assert.deepEqual(signatureFor(store, "gmail", "USER@example.com", "USER@example.com"), gmail);
    assert.deepEqual(signatureFor(store, "smtp", "mailbox-one", smtp.sender), smtp);
    assert.deepEqual(signatureFor(store, "smtp", "mailbox-two", smtp.sender), fallback);
    assert.equal(signatureFor(store, "smtp", "mailbox-off", smtp.sender), undefined);
    assert.deepEqual(signatureFor(store, "gmail", gmail.account, "alias@example.com"), fallback);
    assert.equal(signatureFor(store, "gmail", undefined, gmail.sender), undefined);
    await env.client.call("email.signatures_set", { signatures: [{ ...gmail, enabled: false, text: "" }] });
    assert.equal(signatureFor(store, "gmail", gmail.account, gmail.sender), undefined);
    await env.client.call("email.signatures_set", { signatures: [] });
    assert.deepEqual(signatureFor(store, "gmail", gmail.account, gmail.sender), fallback);
    assert.deepEqual(await env.client.call("email.signatures_get", {}), { signatures: [] });
    const disabled = { ...fallback, enabled: false };
    await env.client.call("email.signature_default_set", { signature: disabled, expected: fallback });
    assert.equal(signatureFor(store, "smtp", "mailbox-two", smtp.sender), undefined);
    store.settings.set("email_signature_default", JSON.stringify({ ...fallback, html: "<script>x</script>" }));
    assert.equal(signatureFor(store, "smtp", "mailbox-two", smtp.sender), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
