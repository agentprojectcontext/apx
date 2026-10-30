import assert from "node:assert/strict";
import { test } from "node:test";
import type { SharedFile } from "../protocol";
import { sharedCount, sharedItem } from "./shared.ts";

const file = (over: Partial<SharedFile>): SharedFile => ({
  media_id: "med_1",
  kind: "image",
  mime: "image/jpeg",
  name: "storefront.jpg",
  bytes: 10,
  path: "/kept/storefront.jpg",
  thread_id: "th_1",
  thread_title: "Launch",
  message_id: "msg_1",
  author: { kind: "user" },
  created_at: "2026-01-01T09:00:00.000Z",
  ...over,
});

test("a shared file becomes the media item the viewer and the share sheet use", () => {
  assert.deepEqual(sharedItem(file({}), "Image"), {
    key: "msg_1:med_1",
    kind: "image",
    media_id: "med_1",
    mime: "image/jpeg",
    name: "storefront.jpg",
    bytes: 10,
  });
  const doc = sharedItem(file({ kind: "document", mime: "application/pdf", name: "" }), "Document");
  assert.equal(doc.kind, "file");
  assert.equal(doc.name, "Document");
});

test("the count under a filter is all of them or one kind's, and nothing before the first answer", () => {
  const counts = { image: 3, video: 2, audio: 1, document: 4 };
  assert.equal(sharedCount(counts, "all"), 10);
  assert.equal(sharedCount(counts, "video"), 2);
  assert.equal(sharedCount(undefined, "all"), undefined);
});
