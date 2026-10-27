import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentDraft, attachmentsOf, discardAttachments } from "./attachmentDrafts.ts";

test("discard invalidates pending callbacks, releases previews, and forgets the chat", (t) => {
  const revoked: string[] = [];
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const draft = attachmentsOf("deleted-chat");
  draft.add([{ key: "pending", name: "review.png", image: true, preview: "blob:deleted" }]);
  discardAttachments("deleted-chat");
  assert.equal(draft.active(), false);
  assert.deepEqual(draft.snapshot(), []);
  draft.patch("pending", { media });
  draft.add([{ key: "late", name: "review.png", image: true, media }]);
  assert.deepEqual(draft.take(), []);
  assert.deepEqual(revoked, ["blob:deleted"]);
  assert.notEqual(attachmentsOf("deleted-chat"), draft);
});

const media = { id: "media-review", kind: "image" as const, name: "review.png", mime: "image/png", bytes: 20 };

test("drafts retain pending uploads by chat and ignore late results after removal", () => {
  const first = attachmentsOf("chat-first");
  const other = attachmentsOf("chat-other");
  first.add([{ key: "pending", name: "review.png", image: true }]);
  assert.equal(attachmentsOf("chat-first"), first);
  assert.deepEqual(other.snapshot(), []);
  first.remove("pending");
  first.patch("pending", { media });
  assert.deepEqual(first.snapshot(), []);
  assert.deepEqual(other.take(), []);
});

test("take returns each upload once, releases previews, and publishes immutable snapshots", (t) => {
  const revoked: string[] = [];
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const draft = attachmentDraft();
  let notifications = 0;
  const unsubscribe = draft.subscribe(() => notifications++);
  draft.add([{ key: "pending", name: "review.png", image: true, preview: "blob:review" }]);
  const pending = draft.snapshot();
  draft.patch("pending", { media });
  assert.equal(pending[0]?.media, undefined);
  assert.equal(draft.snapshot()[0]?.media, media);
  assert.deepEqual(draft.take(), [media]);
  assert.deepEqual(draft.take(), []);
  assert.deepEqual(revoked, ["blob:review"]);
  assert.equal(notifications, 4);
  unsubscribe();
  draft.add([{ key: "discard", name: "discard.png", image: true, preview: "blob:discard" }]);
  draft.remove("discard");
  assert.equal(notifications, 4);
  assert.deepEqual(revoked, ["blob:review", "blob:discard"]);
  assert.deepEqual(draft.snapshot(), []);
});
