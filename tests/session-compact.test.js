// The manual "compact this conversation" entry point (apx session compact /
// web button / POST …/compact) must produce the SAME structured-state summary
// as the automatic condenser — both go through core/memory/summarizer.js.
// Offline: mock engine echoes the prompt, so the written summary contains the
// condenser's section markers, proving the shared service is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactConversation } from "#core/stores/conversations-compactor.js";

function seedConversation() {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "apx-sesscompact-"));
  const dir = path.join(storage, "agents", "reviewer", "conversations");
  fs.mkdirSync(dir, { recursive: true });
  const turns = [];
  turns.push("---\nid: c1\nstatus: active\n---\n");
  for (let i = 0; i < 10; i++) {
    turns.push(`## user — 2026-05-08T10:0${i}:00Z\npregunta ${i}\n`);
    turns.push(`## assistant — 2026-05-08T10:0${i}:30Z\nrespuesta ${i}\n`);
  }
  fs.writeFileSync(path.join(dir, "c1.md"), turns.join("\n"));
  return { storage, file: path.join(dir, "c1.md") };
}

test("session compact uses the shared structured-state summarizer", async () => {
  const { storage, file } = seedConversation();
  try {
    const r = await compactConversation({
      storagePath: storage,
      agentSlug: "reviewer",
      filename: "c1.md",
      modelId: "mock:test",
      config: { engines: {} },
    });
    assert.equal(r.model, "mock:test");
    assert.ok(r.compacted_turns >= 10);
    const written = fs.readFileSync(file, "utf8");
    // Frontmatter marked compacted, compact block present.
    assert.match(written, /status: compacted/);
    assert.match(written, /## compact —/);
    // The mock echoes the prompt into the summary → the structured-state
    // section markers from summarizer.js must appear (proves shared service).
    assert.match(written, /USER_CONTEXT:/);
    assert.match(written, /PENDING:/);
    assert.match(written, /<EVENT id=/);
    // Last turns kept verbatim.
    assert.match(written, /## assistant — 2026-05-08T10:09:30Z/);
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});

test("session compact throws cleanly when no model produces a summary", async () => {
  const { storage } = seedConversation();
  try {
    await assert.rejects(
      compactConversation({
        storagePath: storage,
        agentSlug: "reviewer",
        filename: "c1.md",
        modelId: "", // no model → summarizer returns null
        config: { engines: {}, super_agent: {} },
      }),
      /no model produced a summary/
    );
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
