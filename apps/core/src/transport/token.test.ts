import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { removeDir } from "../testkit/platform.ts";

const TOKEN = "core-token-for-tests";
let core: Awaited<ReturnType<typeof createCore>>;
let home = "";

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-token-"));
  core = await createCore(
    { ...testConfig({ home }), token: TOKEN },
    { quiet: true, llm: scriptedLlm(() => say("ok")) },
  );
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("with a core token, an outside app's client token is enough; without either the core refuses", async () => {
  const owner = new ApxClient({ url: core.url, token: TOKEN });
  const { token } = await owner.call("clients.create", { name: "Claude Code", scopes: ["chat"] });
  const app = new ApxClient({ url: core.url, clientToken: token });
  assert.ok((await app.call("agents.list", {})).agents.length > 0);
  const nobody = new ApxClient({ url: core.url });
  await assert.rejects(
    nobody.call("agents.list", {}),
    (e: unknown) => e instanceof ApxError && /bad token/.test(e.message),
  );
  const forged = new ApxClient({ url: core.url, clientToken: `apxc_${"0".repeat(48)}` });
  await assert.rejects(
    forged.call("agents.list", {}),
    (e: unknown) => e instanceof ApxError && /token/.test(e.message),
  );
  // The client token stands in for the core's, never for the owner: owner-only calls stay closed.
  await assert.rejects(app.call("clients.list", {}), (e: unknown) => e instanceof ApxError);
});

test("a local core without a token still accepts repeated socket calls", async () => {
  const localHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-local-socket-"));
  const local = await createCore(testConfig({ home: localHome }), { quiet: true });
  const socket = await new ApxClient({ url: local.url }).connect();
  try {
    assert.ok(Array.isArray((await socket.call("devices.list", {})).devices));
    assert.ok(Array.isArray((await socket.call("devices.list", {})).devices));
  } finally {
    socket.close();
    await socket.closed;
    await local.close();
    await removeDir(localHome);
  }
});

test("Google's return finishes without the core's token, yet only with a state this core signed", async () => {
  const nobody = new ApxClient({ url: core.url });
  await assert.rejects(
    nobody.call("integrations.oauth_finish", { code: "c", state: "forged.state" }),
    (e: unknown) => e instanceof ApxError && /not valid or expired/.test(e.message),
    "it reaches the handler, which refuses a state it did not sign",
  );
  await assert.rejects(
    nobody.call("integrations.oauth_start", { id: "google-calendar" }),
    (e: unknown) => e instanceof ApxError && /bad token/.test(e.message),
    "starting a sign-in stays the owner's",
  );
});
