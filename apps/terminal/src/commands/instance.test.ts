import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { InstancePlan } from "@apx/protocol";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { importInstance } from "./instance.ts";
import { printed, recordingClient } from "./testing.ts";

const plan: InstancePlan = {
  apx_version: "2.13.0",
  created_at: "2026-11-05T10:00:00.000Z",
  includes: { chats: false, rows: false },
  items: [
    { section: "agents", id: "nora", label: "Nora", action: "add" },
    { section: "mcps", id: "crm", label: "crm", action: "add", off: true, reason: "needs_secret" },
    { section: "memory", id: "m1", label: "Prefers short answers", action: "same" },
  ],
  secrets: ["acme_key"],
};

test("apx import shows the preview and changes nothing until --yes", async () => {
  const dir = tempDir("apx-import-");
  const file = path.join(dir.path, "apx-export.json");
  fs.writeFileSync(file, JSON.stringify({ format: "apx-instance", version: 1 }));
  try {
    const { client, calls } = recordingClient({
      "instance.preview_import": plan,
      "instance.import": { ...plan, applied: 2 },
    });
    const shown = await printed(() => importInstance(client, file, {}));
    assert.match(shown, /Agents\s+1 new, 0 changed, 0 already here/);
    assert.match(shown, /crm — arrives off until its key or sign-in is set here/);
    assert.match(shown, /Secrets to fill here: acme_key/);
    assert.match(shown, /Run again with --yes/);
    assert.deepEqual(
      calls.map(([m]) => m),
      ["instance.preview_import"],
    );
    assert.match(await printed(() => importInstance(client, file, { yes: true })), /Imported 2 items/);
    assert.equal(calls.at(-1)?.[0], "instance.import");
    await assert.rejects(importInstance(client, undefined, {}), /usage: apx import/);
  } finally {
    await dir.remove();
  }
});
