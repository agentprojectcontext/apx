import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { createAsana } from "./asana.ts";

test("Asana bounds streamed responses and never echoes malformed JSON", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-asana-body-"));
  const secrets = createSecrets(home, "file");
  secrets.set("asana-token", "example-token");
  try {
    let cancelled = false;
    const large = createAsana({
      secrets,
      offIn: () => false,
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(600_000));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    });
    await assert.rejects(large.read({ operation: "workspaces", limit: 1 }), /response is too large/);
    assert.equal(cancelled, true);
    for (const body of ["example-token", "null", "{}", '{"data":[],"next_page":{"offset":123}}']) {
      const malformed = createAsana({ secrets, offIn: () => false, fetch: async () => new Response(body) });
      await assert.rejects(
        malformed.read({ operation: "workspaces", limit: 1 }),
        /^Error: Asana returned an invalid response$/,
      );
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
