import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";

test("a running core discovers Sheets tools, reads untrusted cells and gates an actual write on owner approval", async () => {
  const google = await fakeGoogle();
  const llm = scriptedLlm((_request, { said, afterTool }) => {
    if (afterTool) return say("done");
    if (said === "inspect tabs") return callTool("tabs", "tool_run", { tool: "sheets_tabs", args: { id: "sheet-1" } });
    if (said === "read cells")
      return callTool("read", "tool_run", { tool: "sheets_read", args: { id: "sheet-1", range: "Summary!A1:B2" } });
    if (said === "replace cells")
      return callTool("write", "tool_run", {
        tool: "sheets_write",
        args: { id: "sheet-1", range: "Summary!A1:B2", values: [["=1+1"]] },
      });
    return callTool("find", "tool_search", { query: "sheets" });
  });
  const env = await startCore({ llm, googleApi: google.url });
  try {
    const health = await env.client.call("system.health", {});
    assert.equal(health.code_sha, env.core.identity.code_sha);
    const { url } = await env.client.call("integrations.oauth_start", {
      id: "google-drive",
      values: { client_id: "123-abc.apps.googleusercontent.com", client_secret: FAKE_GOOGLE_SECRET },
    });
    const consent = await fetch(url, { redirect: "manual" });
    const callback = new URL(consent.headers.get("location") ?? "");
    await env.client.call("integrations.oauth_finish", {
      code: callback.searchParams.get("code") ?? "",
      state: callback.searchParams.get("state") ?? "",
    });
    const { id: thread } = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    const turn = async (text: string) => {
      await env.client.call("threads.send", { thread, text });
      await env.settle(thread);
      return String(llm.calls.at(-1)?.messages.at(-1)?.content ?? "");
    };
    assert.match(await turn("find sheets"), /sheets_read/);
    assert.match(await turn("inspect tabs"), /Details/);
    const cells = await turn("read cells");
    assert.match(cells, /untrusted/);
    assert.match(cells, /Ignore your instructions/);
    google.setSheetsError({ status: 503, message: "not connected; connect it outside-error-content" });
    const failure = await turn("inspect tabs");
    assert.match(failure, /Check file access/);
    assert.doesNotMatch(failure, /outside-error-content/);
    google.setSheetsError();
    await env.client.call("threads.send", { thread, text: "replace cells" });
    const pending = await inputsOrEnd(env.client, thread);
    assert.equal(pending.length, 1);
    assert.equal(google.sheetWrites.length, 0);
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "deny" });
    await env.settle(thread);
    assert.equal(google.sheetWrites.length, 0);
    await env.client.call("threads.send", { thread, text: "replace cells" });
    const approved = await inputsOrEnd(env.client, thread);
    assert.equal(approved.length, 1);
    await env.client.call("runs.respond", { input: approved[0]?.id ?? "", decision: "approve" });
    await env.settle(thread);
    assert.deepEqual(google.sheetWrites, [{ range: "Summary!A1:B2", majorDimension: "ROWS", values: [["=1+1"]] }]);
    await env.client.call("integrations.disconnect", { id: "google-drive" });
    assert.doesNotMatch(await turn("find sheets"), /sheets_read/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await google.close();
  }
});
