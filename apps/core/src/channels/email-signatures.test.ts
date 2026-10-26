import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { emailAdapter } from "./email.ts";
import { parseMail } from "./email-mime.ts";
import { fakeImap, fakeSmtp, mail } from "./fake-email.test-support.ts";

const address = "user@example.com";
const pass = "test-password";
const signature = {
  transport: "smtp" as const,
  account: "email",
  sender: address,
  enabled: true,
  text: "Acme",
  html: '<a href="https://example.com">Acme</a><img src="https://example.com/logo.png" alt="Logo">',
};
const parts = (raw: string) =>
  [
    ...raw.matchAll(
      /Content-Type: text\/(?:plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]*)(?=\r\n--|$)/g,
    ),
  ].map((m) => Buffer.from(m[1] ?? "", "base64").toString("utf8"));

test("the production SMTP factory resolves signatures by channel and sender; omission survives the outbox", async () => {
  const dir = tempDir("apx-email-signatures-");
  const imap = await fakeImap({ user: address, pass });
  const smtp = await fakeSmtp({ user: address, pass });
  const env = await startCore({ home: dir.path, llm: scriptedLlm(() => say("Acknowledged")) });
  try {
    await env.client.call("channels.set", {
      id: "email",
      token: pass,
      channel: {
        type: "email",
        agent_id: "roby",
        email: {
          address,
          imap: { host: "127.0.0.1", port: imap.port, tls: "none" },
          smtp: { host: "127.0.0.1", port: smtp.port, tls: "none" },
        },
      },
    });
    await waitFor(
      async () =>
        (await env.client.call("channels.list", {})).channels.some((c) => c.id === "email" && c.status === "running"),
      "email channel running",
    );
    await env.client.call("email.signatures_set", {
      signatures: [
        { ...signature, account: "different", text: "Wrong channel" },
        { ...signature, sender: "alias@example.com", text: "Wrong sender" },
        signature,
      ],
    });
    const contact = env.core.store.persons.create({ name: "Acme contact", role: "contact" });
    env.core.store.persons.link(contact.id, { channel: "email", external_id: "contact@example.com" });
    const sent = await env.client.call("channels.message", { person: contact.id, text: "Hello" });
    assert.equal(sent.delivery.state, "sent");
    const first = smtp.sent.at(-1);
    assert.ok(first);
    assert.deepEqual(parts(first.raw), ["Hello\r\n\r\n-- \r\nAcme", `Hello<br><br><div>${signature.html}</div>`]);
    const omitted = await env.client.call("channels.message", {
      person: contact.id,
      text: "No footer",
      omit_signature: true,
    });
    assert.equal(omitted.delivery.state, "sent");
    assert.deepEqual(parts(smtp.sent.at(-1)?.raw ?? ""), ["No footer"]);
    await env.client.call("channels.send", { thread: sent.thread, text: "Direct", omit_signature: true });
    await waitFor(() => smtp.sent.some((m) => parts(m.raw)[0] === "Direct"), "direct send without signature");
    const original = mail({ from: "contact@example.com", to: address, subject: "Plan", text: "Please confirm" });
    imap.deliver(original.raw);
    await waitFor(
      () => smtp.sent.some((m) => parts(m.raw)[0] === "Acknowledged\r\n\r\n-- \r\nAcme"),
      "signed automated reply",
    );
    const reply = smtp.sent.find((m) => parts(m.raw)[0] === "Acknowledged\r\n\r\n-- \r\nAcme");
    assert.ok(reply);
    assert.equal(parseMail(Buffer.from(reply.raw, "latin1")).headers.get("in-reply-to")?.[0], original.id);
    await env.client.call("email.signatures_set", { signatures: [{ ...signature, enabled: false }] });
    await env.client.call("channels.message", { person: contact.id, text: "Disabled" });
    assert.deepEqual(parts(smtp.sent.at(-1)?.raw ?? ""), ["Disabled"]);
  } finally {
    await env.core.close();
    await imap.close();
    await smtp.close();
    await env.cleanup();
  }
});

test("SMTP signatures retain attachments and do not duplicate a pre-signed message", async () => {
  const dir = tempDir("apx-email-signature-files-");
  const smtp = await fakeSmtp({ user: address, pass });
  const endpoint = { host: "127.0.0.1", port: smtp.port, tls: "none" as const };
  const adapter = emailAdapter(
    {
      id: "email",
      type: "email",
      agent_id: "roby",
      label: "Email",
      enabled: true,
      strangers: "pair",
      concurrency: "queue",
      owner_thread: "home",
      email: { address, imap: endpoint, smtp: endpoint, mailbox: "INBOX", allowed: [], trust_unverified: false },
    },
    pass,
    { dir: path.join(dir.path, "channel"), signature: () => signature },
  );
  try {
    await adapter.send("contact@example.com", { text: "Hello\n\n-- \nAcme" }, [
      { name: "note.txt", kind: "file", mime: "text/plain", data: Buffer.from("Attachment") },
    ]);
    const sent = smtp.sent.at(-1);
    assert.ok(sent);
    assert.equal(parts(sent.raw)[0], "Hello\r\n\r\n-- \r\nAcme");
    assert.ok(sent.raw.includes("multipart/mixed"));
    assert.ok(sent.raw.includes("multipart/alternative"));
    assert.deepEqual(
      parseMail(Buffer.from(sent.raw, "latin1")).attachments.map((a) => a.name),
      ["note.txt"],
    );
  } finally {
    await adapter.stop();
    await smtp.close();
    await dir.remove();
  }
});
