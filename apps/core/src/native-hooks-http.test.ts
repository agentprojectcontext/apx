import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { fakeLine } from "./channels/fake-line.test-support.ts";
import { fakeTeams } from "./channels/fake-teams.test-support.ts";
import { lineAdapter } from "./channels/line.ts";
import { teamsAdapter } from "./channels/teams.ts";
import type { HookRequest } from "./channels/types.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { waitFor } from "./testkit/platform.ts";

test("the public HTTP listener preserves native LINE HMAC and Teams JWT authentication", async () => {
  const line = await fakeLine();
  const teams = await fakeTeams();
  const llm = scriptedLlm(() => say("Unexpected model call"));
  const env = await startCore({
    llm,
    channelAdapters: {
      line: (c, s) => lineAdapter(c, s, { dir: path.join(env.home, "channels", c.id), api: line.api }),
      teams: (c, s) =>
        teamsAdapter(c, s, {
          dir: path.join(env.home, "channels", c.id),
          openid: `${teams.base}/openid`,
          login: teams.base,
        }),
    },
  });
  try {
    await env.client.call("webhooks.set", { mode: "custom", url: "https://acme.example" });
    await env.client.call("channels.set", {
      id: "line",
      channel: { type: "line", agent_id: "roby" },
      token: line.secret,
    });
    await env.client.call("channels.set", {
      id: "teams",
      channel: { type: "teams", agent_id: "roby" },
      token: teams.secret,
    });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels.every((c) => c.status !== "starting"),
      "native adapters started",
    );
    const { port } = await env.client.call("webhooks.get", {});
    const send = async (id: string, req: HookRequest) => {
      const response = await fetch(`http://127.0.0.1:${port}/hooks/${id}`, {
        method: "POST",
        headers: req.headers,
        body: new Uint8Array(req.body),
      });
      await response.arrayBuffer();
      return response.status;
    };
    const signed = line.hook([]);
    assert.equal(await send("line", { ...signed, headers: {} }), 401);
    assert.equal(
      await send("line", { ...signed, body: Buffer.from(`${signed.body.toString()} `) }),
      401,
      "HMAC covers the original bytes",
    );
    assert.equal(await send("line", { ...signed, headers: { authorization: "Bearer unrelated" } }), 401);
    assert.equal(await send("line", signed), 200, "native HMAC requires no APX bearer");
    assert.equal(await send("missing", signed), 404);
    const activity = teams.message("visitor", "Hello");
    const now = Math.floor(Date.now() / 1000);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    for (const auth of [
      null,
      "Bearer unrelated",
      `Bearer ${teams.sign({}, other)}`,
      `Bearer ${teams.sign({ aud: "00000000-0000-4000-8000-00000000dead" })}`,
      `Bearer ${teams.sign({ exp: now - 600, nbf: now - 4000 })}`,
      `Bearer ${teams.sign({ serviceurl: "https://evil.example.com/" })}`,
    ])
      assert.equal(await send("teams", teams.request(activity, auth)), 401);
    assert.equal(teams.sentTo("visitor").length, 0);
    assert.equal(line.sent.length, 0);
    assert.equal(llm.calls.length, 0);
    assert.equal(await send("teams", teams.request(activity)), 200, "the listener forwards the provider JWT unchanged");
    await waitFor(() => teams.sentTo("visitor").length > 0, "signed Teams pairing reply");
    assert.match(teams.sentTo("visitor")[0]?.body.text ?? "", /\d{6}/);
    line.person(`U${"a".repeat(32)}`, "Visitor");
    assert.equal(await send("line", line.hook([line.text(`U${"a".repeat(32)}`, "Hello")])), 200);
    await waitFor(() => line.sentTo(`U${"a".repeat(32)}`).length > 0, "signed LINE pairing reply");
    assert.match(line.sentTo(`U${"a".repeat(32)}`)[0] ?? "", /\d{6}/);
    assert.equal(llm.calls.length, 0, "native signature verification never authorizes an unpaired caller as owner");
  } finally {
    await env.core.close();
    await line.close();
    await teams.close();
    await env.cleanup();
  }
});
