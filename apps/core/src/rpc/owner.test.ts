import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("saving one field of the owner keeps the others as they were", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("owner.set", {
      name: "Ada",
      about: "Runs a bakery in Northwind.",
      language: "en",
      timezone: "America/New_York",
    });
    // The panel saves one field at a time: what it does not send stays.
    await env.client.call("owner.set", { publish: "ask" });
    await env.client.call("owner.set", { timezone: "Europe/Madrid" });
    assert.deepEqual(await env.client.call("owner.get", {}), {
      name: "Ada",
      about: "Runs a bakery in Northwind.",
      language: "en",
      timezone: "Europe/Madrid",
      publish: "ask",
    });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
