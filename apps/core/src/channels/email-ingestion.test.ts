import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { emailAdapter } from "./email.ts";
import { fakeImap, fakeSmtp, mail } from "./fake-email.test-support.ts";

const USER = "reader@example.org";
const PASS = "test-mail-password";

async function fixture(seeds: string[] = [], strangers: "ask" | "answer" | "pair" = "ask", omitUidvalidity = false) {
  const home = tempDir();
  const imap = await fakeImap({ user: USER, pass: PASS, omitUidvalidity });
  const smtp = await fakeSmtp({ user: USER, pass: PASS });
  const old = new Date("2020-01-02T12:00:00.000Z");
  for (const raw of seeds) imap.deliver(raw, old);
  const llm = scriptedLlm(() => say('{"important": false}'));
  const boot = () =>
    startCore({
      home: home.path,
      llm,
      aux: true,
      channelAdapters: {
        email: (c, s) => emailAdapter(c, s, { dir: path.join(home.path, "channels", c.id) }),
      },
    });
  let env = await boot();
  await env.client.call("channels.set", {
    id: "email",
    token: PASS,
    channel: {
      type: "email",
      agent_id: "superagent",
      strangers,
      email: {
        address: USER,
        imap: { host: "127.0.0.1", port: imap.port, tls: "none" },
        smtp: { host: "127.0.0.1", port: smtp.port, tls: "none" },
        blocked: ["@blocked.example"],
      },
    },
  });
  await waitFor(
    async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
    "mailbox running",
  );
  const messages = (address: string) => {
    const thread = env.core.store.threads.byConversation("email", address);
    return thread ? env.core.store.messages.list(thread.id) : [];
  };
  return {
    get core() {
      return env.core;
    },
    get client() {
      return env.client;
    },
    async restart() {
      await env.core.close();
      env = await boot();
      await waitFor(
        async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
        "mailbox running after restart",
      );
    },
    home,
    imap,
    smtp,
    llm,
    messages,
    async close() {
      await env.core.close();
      await imap.close();
      await smtp.close();
      await env.cleanup();
      await home.remove();
    },
  };
}

test("captured automatic and historical senders retain the account's future stranger policy", async () => {
  for (const kind of ["automatic", "history"] as const) {
    const original = automatic("later@example.net");
    const f = await fixture(kind === "history" ? [original.raw] : [], "answer");
    try {
      if (kind === "history") await f.client.call("channels.email_history", { channel: "email" });
      else f.imap.deliver(original.raw);
      await waitFor(() => f.messages("later@example.net").length === 1, "passive mail captured");
      assert.equal(f.smtp.sent.length, 0);
      f.imap.deliver(mail({ from: "later@example.net", to: USER, subject: "Personal", text: "Please answer me" }).raw);
      await waitFor(() => f.smtp.sent.length === 1, "personal mail gets the configured answer");
      assert.equal(f.messages("later@example.net").filter((m) => m.author.kind === "person").length, 2);
    } finally {
      await f.close();
    }
  }
  const f = await fixture([], "pair");
  try {
    f.imap.deliver(automatic("unapproved@example.net").raw);
    await waitFor(() => f.messages("unapproved@example.net").length === 1, "automatic kept without approval");
    f.imap.deliver(
      mail({ from: "unapproved@example.net", to: USER, subject: "Personal", text: "Still needs approval" }).raw,
    );
    await waitFor(
      async () =>
        (await f.client.call("pairing.list", {})).requests.some((r) => r.external_id === "unapproved@example.net"),
      "personal mail still waits for approval",
    );
    assert.equal(f.smtp.sent.length, 0);
  } finally {
    await f.close();
  }
});

test("history cannot consume live mail, whether live delivery finishes before or after recovery", async () => {
  for (const liveFirst of [false, true]) {
    const f = await fixture(
      [mail({ from: "old@example.net", to: USER, subject: "Old", text: "Earlier mail" }).raw],
      "answer",
    );
    const gate = liveFirst ? undefined : f.imap.pauseNextFetch();
    try {
      f.imap.deliver(mail({ from: "new@example.net", to: USER, subject: "New", text: "Answer this new mail" }).raw);
      if (gate) await gate.entered;
      else await waitFor(() => f.smtp.sent.length === 1, "live mail answered first");
      const page = await f.client.call("channels.email_history", { channel: "email" });
      assert.equal(page.stored, 1, "only the old message is imported");
      assert.equal(page.scanned, liveFirst ? 2 : 1, "unfinished live UID is outside recovery");
      gate?.release();
      await waitFor(() => f.smtp.sent.length === 1, "live answer is not swallowed by history");
      assert.equal(f.messages("new@example.net").filter((m) => m.author.kind === "person").length, 1);
      assert.ok(
        f
          .messages("new@example.net")
          .every((m) => !m.parts.some((p) => p.type === "text" && p.text.includes("historical mail"))),
      );
    } finally {
      gate?.release();
      await f.close();
    }
  }
});

test("failed history commits roll back, retry the same UID safely, and pending history resumes silently after restart", async () => {
  const original = automatic("retry@example.net");
  const f = await fixture([original.raw]);
  try {
    const done = f.core.store.channels.inbox.done;
    let fail = true;
    f.core.store.channels.inbox.done = (id, state, error) => {
      if (state === "done" && fail) {
        fail = false;
        throw new Error("injected commit failure");
      }
      done(id, state, error);
    };
    const page = await f.client.call("channels.email_history", { channel: "email" });
    assert.deepEqual([page.failed, page.stored, page.next_uid, page.has_more], [1, 0, 0, true]);
    assert.equal(f.messages("retry@example.net").length, 0, "partial display write rolled back");
    const retry = await f.client.call("channels.email_history", { channel: "email" });
    assert.deepEqual([retry.failed, retry.stored, retry.already_seen], [0, 1, 0]);
    assert.equal(f.messages("retry@example.net").length, 1);
    f.core.store.channels.inbox.add("email", {
      external_id: "pending-history",
      conversation: "pending@example.net",
      sender: { id: "pending@example.net", name: "Pending" },
      text: "Previously captured history",
      private: true,
      mail_handling: "history",
      mail_received_at: "2020-01-02T12:00:00.000Z",
    });
    const calls = f.llm.calls.length;
    await f.restart();
    await waitFor(() => f.messages("pending@example.net").length === 1, "pending history resumed");
    assert.equal(f.llm.calls.length, calls);
    assert.equal(f.smtp.sent.length, 0);
    const again = await f.client.call("channels.email_history", { channel: "email" });
    assert.equal(again.already_seen, 1);
    assert.equal(f.messages("retry@example.net").length, 1);
  } finally {
    await f.close();
  }
});

test("history refuses missing mailbox identity and channel stop cancels an in-flight fetch", async () => {
  const missing = await fixture([automatic("old@example.net").raw], "ask", true);
  try {
    await assert.rejects(missing.client.call("channels.email_history", { channel: "email" }), /numbering/);
    assert.equal(missing.messages("old@example.net").length, 0);
  } finally {
    await missing.close();
  }
  const f = await fixture([automatic("old@example.net").raw]);
  const gate = f.imap.pauseNextFetch();
  try {
    const page = f.client.call("channels.email_history", { channel: "email" });
    const rejected = assert.rejects(page);
    await gate.entered;
    await f.client.call("channels.set", { id: "email", channel: null });
    await rejected;
    assert.equal(f.messages("old@example.net").length, 0);
    assert.equal(f.smtp.sent.length, 0);
  } finally {
    gate.release();
    await f.close();
  }
});

test("an already-open operator receives each committed historical message once, with no unread flood", async () => {
  const f = await fixture([automatic("visible@example.net").raw]);
  const socket = await f.client.connect();
  const ids: string[] = [];
  socket.onEvent((event) => {
    if (event.type === "message.created") {
      const payload = event.payload as { message: { id: string } };
      ids.push(payload.message.id);
    }
  });
  try {
    const page = await f.client.call("channels.email_history", { channel: "email" });
    assert.equal(page.stored, 1);
    await waitFor(() => ids.length === 1, "open operator receives recovered mail");
    const message = f.messages("visible@example.net")[0];
    assert.equal(ids[0], message?.id);
    const thread = f.core.store.threads.byConversation("email", "visible@example.net");
    assert.equal(thread?.unread ?? 0, 0);
    await f.client.call("channels.email_history", { channel: "email" });
    await socket.call("system.ping", {});
    assert.equal(ids.length, 1, "replay creates no second UI event");
  } finally {
    socket.close();
    await socket.closed;
    await f.close();
  }
});

const automatic = (address: string, verified = true) =>
  mail({
    from: address,
    to: USER,
    subject: "Account notice",
    text: "Keep this notice",
    headers: { "List-Unsubscribe": "<https://example.net/unsubscribe>" },
    verified,
  });

test("verified automatic mail is kept for an unknown or approved sender, never answered; authentication and blocks still apply", async () => {
  const f = await fixture([], "answer");
  try {
    const first = automatic("news@example.net");
    f.imap.deliver(first.raw);
    await waitFor(() => f.messages("news@example.net").length === 1, "automatic mail persisted");
    const person = f.core.store.persons.byAddress("email", "news@example.net");
    assert.equal(person?.unreviewed, true);
    await f.client.call("contacts.set", { id: person?.id ?? "", name: "News", muted: false });
    f.imap.deliver(automatic("news@example.net").raw);
    f.imap.deliver(automatic("forged@example.net", false).raw);
    f.imap.deliver(automatic("sender@blocked.example").raw);
    await waitFor(() => f.messages("news@example.net").length === 2, "approved automatic sender also kept");
    const replay = await f.client.call("channels.email_history", { channel: "email" });
    assert.deepEqual([replay.stored, replay.already_seen, replay.skipped], [0, 2, 2]);
    assert.equal(f.messages("forged@example.net").length, 0);
    assert.equal(f.messages("sender@blocked.example").length, 0);
    assert.equal(f.smtp.sent.length, 0, "no pairing, draft, or automatic reply");
    assert.equal(
      f.core.store.runs.list(f.core.store.threads.byConversation("email", "news@example.net")?.id ?? "").length,
      0,
      "incoming automatic mail starts no agent turn",
    );
    assert.ok(
      f.messages("news@example.net")[0]?.parts.some((p) => p.type === "text" && p.text.includes("Keep this notice")),
    );
  } finally {
    await f.close();
  }
});

test("explicit history pages recover old verified mail silently, keep arrival dates, dedupe retries, and reject stale cursors", async () => {
  const seeds = [
    mail({ from: "person@example.net", to: USER, subject: "Earlier", text: "old personal mail" }).raw,
    automatic("news@example.net").raw,
    automatic("forged@example.net", false).raw,
    automatic("sender@blocked.example").raw,
  ];
  const f = await fixture(seeds);
  try {
    assert.equal(f.messages("person@example.net").length, 0, "first connection does not import history implicitly");
    const calls = f.llm.calls.length;
    const agent = new ApxClient({ url: f.core.url, actor: "agent" });
    await assert.rejects(agent.call("channels.email_history", { channel: "email" }), /owner|human/i);
    await assert.rejects(f.client.call("channels.email_history", { channel: "email", limit: 51 }), /params/);
    const first = await f.client.call("channels.email_history", { channel: "email", limit: 1 });
    assert.deepEqual([first.scanned, first.stored, first.has_more], [1, 1, true]);
    const rest = await f.client.call("channels.email_history", {
      channel: "email",
      after_uid: first.next_uid,
      uidvalidity: first.uidvalidity,
    });
    assert.deepEqual([rest.scanned, rest.stored, rest.skipped, rest.has_more], [3, 1, 2, false]);
    const again = await f.client.call("channels.email_history", { channel: "email" });
    assert.deepEqual([again.stored, again.already_seen, again.skipped], [0, 2, 2]);
    assert.equal(f.messages("person@example.net")[0]?.created_at, "2020-01-02T12:00:00.000Z");
    assert.equal(f.llm.calls.length, calls, "history does not run importance checks or agents");
    assert.equal(f.smtp.sent.length, 0);
    assert.equal(
      f.core.store.runs.list(f.core.store.threads.byConversation("email", "news@example.net")?.id ?? "").length,
      0,
    );
    await assert.rejects(f.client.call("channels.email_history", { channel: "email", after_uid: 1 }), /numbering/);
    f.imap.deliver(automatic("fresh@example.net").raw);
    await waitFor(() => f.messages("fresh@example.net").length === 1, "new mail still arrives after recovery");
    assert.equal(f.imap.readOnlyViolations(), 0, "only EXAMINE and BODY.PEEK reads, no mailbox mutation");
    f.imap.renumber();
    await waitFor(
      async () => (await f.client.call("channels.list", {})).channels[0]?.status === "error",
      "renumbering disconnect observed",
    );
    await waitFor(
      async () => (await f.client.call("channels.list", {})).channels[0]?.status === "running",
      "mailbox reconnected after renumbering",
      { ms: 10_000 },
    );
    await assert.rejects(
      f.client.call("channels.email_history", {
        channel: "email",
        after_uid: first.next_uid,
        uidvalidity: first.uidvalidity,
      }),
      /numbering/,
    );
  } finally {
    await f.close();
  }
});
