import assert from "node:assert/strict";
import test from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";

test("Drive continuation through the real executor preserves every text window without nested output recovery", async () => {
  const google = await fakeGoogle();
  const source = `${"<".repeat(12000)}UNIQUE_MIDDLE_MARKER${"<".repeat(13000)}`;
  google.setDriveText(source);
  const visible: string[] = [];
  const llm = scriptedLlm((req, { afterTool }) => {
    if (afterTool) {
      const result = String(req.messages.at(-1)?.content ?? "");
      visible.push(result);
      const next = result.match(/next_offset="(\d+)"/);
      const revision = result.match(/revision="([a-f0-9]+)"/);
      if (next && revision)
        return callTool(`next-${next[1]}`, "drive_read", {
          id: "d1",
          offset: Number(next[1]),
          revision: revision[1],
        });
      return say("All text windows read");
    }
    return callTool("first", "drive_read", { id: "d1" });
  });
  const env = await startCore({
    llm,
    googleApi: google.url,
    googleClient: `apx.apps.googleusercontent.com:${FAKE_GOOGLE_SECRET}`,
  }).catch(async (error) => {
    await google.close();
    throw error;
  });
  try {
    const { url } = await env.client.call("integrations.oauth_start", {
      id: "google-drive",
      values: { client: "apx" },
    });
    const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
    await env.client.call("integrations.oauth_finish", {
      code: back.searchParams.get("code") ?? "",
      state: back.searchParams.get("state") ?? "",
    });
    const { id } = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: id, text: "Read the selected source completely" });
    await env.settle(id);
    assert.ok(visible.length > 1);
    const all = visible.join("");
    assert.match(all, /UNIQUE_MIDDLE_MARKER/);
    assert.equal((all.match(/&lt;/g) ?? []).length, 25000);
    assert.ok(visible.every((window) => window.includes('trust="untrusted"')));
    assert.doesNotMatch(all, /chars omitted|read_output/);
    assert.match(visible.at(-1) ?? "", /next_offset="null"/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await google.close();
  }
});
