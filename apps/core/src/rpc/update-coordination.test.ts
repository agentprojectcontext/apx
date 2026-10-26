import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApxClient, ApxError, ApxSocket, PROTOCOL_VERSION } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { tempDir } from "../testkit/platform.ts";

test("authenticated direct connections observe durable coordination over HTTP and WS without SSH", async () => {
  const dir = tempDir("apx-update-rpc-");
  fs.writeFileSync(
    path.join(dir.path, "update-coordination.json"),
    JSON.stringify({
      target: "2.1.0",
      running: "2.0.0",
      phase: "restarting",
    }),
  );
  const core = await createCore(testConfig({ home: dir.path, token: "test-update-owner" }), {
    quiet: true,
    llm: scriptedLlm(() => say("ok")),
  });
  const owner = new ApxClient({ url: core.url, token: "test-update-owner" });
  const socket = await owner.connect();
  try {
    const incompatible = new ApxSocket(`${core.url.replace(/^http/, "ws")}/ws?token=test-update-owner`, 5000);
    try {
      await assert.rejects(
        incompatible.open({
          t: "hello",
          protocol: PROTOCOL_VERSION + 1,
          client: { name: "Acme", version: "1.0.0" },
          role: "operator",
        }),
        /socket closed before welcome/,
      );
    } finally {
      incompatible.close();
      await incompatible.closed;
    }
    const state = await owner.call("system.update_state", {});
    assert.deepEqual(await socket.call("system.update_state", {}), state);
    assert.equal(state.supported, false);
    assert.equal(state.coordination_protocol, 1);
    assert.equal(state.running, core.identity.version);
    assert.equal(state.coordination?.phase, "failed");
    assert.equal(state.coordination?.target, "2.1.0");
    await assert.rejects(new ApxClient({ url: core.url }).call("system.update_state", {}), /token/);
    const agent = new ApxClient({ url: core.url, token: "test-update-owner", actor: "agent" });
    await assert.rejects(agent.call("system.update_state", {}), /reserved to the owner/);
    await assert.rejects(
      agent.call("system.update_prepare", { target: "2.1.0", desktop: { os: "linux", arch: "x64" } }),
      /reserved to the owner/,
    );
    const foreign = await owner.call("clients.create", { name: "Acme", scopes: ["chat"] });
    await assert.rejects(
      new ApxClient({ url: core.url, clientToken: foreign.token }).call("system.update_state", {}),
      (error: unknown) => error instanceof ApxError && error.code === "unauthorized",
    );
    const unkeyed = await fetch(`${core.url}/rpc/system.update_prepare`, {
      method: "POST",
      headers: { authorization: "Bearer test-update-owner", "content-type": "application/json" },
      body: JSON.stringify({ target: "2.1.0", desktop: { os: "linux", arch: "x64" } }),
    });
    assert.equal(unkeyed.status, 400);
    await assert.rejects(
      owner.call("system.update_prepare", { target: "../2.1.0", desktop: { os: "linux", arch: "x64" } }),
      /invalid params/,
    );
    await assert.rejects(
      owner.call("system.update_prepare", { target: "2.1.0", desktop: { os: "linux", arch: "x64" } }),
      /cannot coordinate/,
    );
    assert.equal((await owner.call("system.update", { target: "2.1.0" })).ok, false);
  } finally {
    socket.close();
    await socket.closed;
    await core.close();
    await dir.remove();
  }
});
