// The chat owns four keys of the query, not the whole query.
//
// Add project is open while the URL says `?action=add-project`. Over the inbox,
// the embedded chat kept its thread in the URL by writing `queryForChat(key)` as
// the ENTIRE query — from an effect that re-runs on every URL change — so the
// dialog opened and was closed by the next render (2026-09-28). `withChatQuery`
// swaps the selection and keeps every other param; `queryShowsChat` lets the
// sync skip a write the URL already agrees with.
//
// Imports the web's TypeScript directly (Node strips types natively), the same
// way runtime-row-routing.test.js does.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { withChatQuery, queryShowsChat } = await import(
  path.join(ROOT, "src/interfaces/web/src/screens/mobile/routes.ts")
);

const thread = { kind: "thread", channel: "discord", threadId: "2026-01-01~1234567890" };

test("withChatQuery keeps params the chat does not own", () => {
  const prev = new URLSearchParams(`channel=discord&thread=${thread.threadId}&action=add-project`);
  const next = withChatQuery(prev, thread);
  assert.equal(next.get("action"), "add-project");
  assert.equal(next.get("channel"), "discord");
  assert.equal(next.get("thread"), thread.threadId);
});

test("withChatQuery drops the previous selection's keys", () => {
  const prev = new URLSearchParams("agent=acme&conv=c-1&view=board");
  const next = withChatQuery(prev, thread);
  assert.equal(next.get("agent"), null);
  assert.equal(next.get("conv"), null);
  assert.equal(next.get("view"), "board");
  assert.equal(next.get("thread"), thread.threadId);
});

test("queryShowsChat ignores foreign params and catches a different selection", () => {
  const open = new URLSearchParams(`channel=discord&thread=${thread.threadId}&action=add-project`);
  assert.equal(queryShowsChat(open, thread), true);
  assert.equal(queryShowsChat(new URLSearchParams("agent=acme"), thread), false);
  assert.equal(
    queryShowsChat(new URLSearchParams("agent=acme"), { kind: "live", agentSlug: "acme" }),
    true,
  );
});
