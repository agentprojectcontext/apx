import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AGENT_NAMES } from "@apx/protocol";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { removeDir } from "../testkit/platform.ts";

test("a fresh install names its super-agent from the list, unless the install says which name", async () => {
  for (const agentName of [undefined, "Ada"]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-seed-"));
    const core = await createCore(testConfig({ home, agentName }), { quiet: true });
    const boss = core.store.agents.list().find((a) => a.kind === "secretary");
    await core.close();
    await removeDir(home);
    if (agentName) assert.equal(boss?.name, agentName);
    else assert.ok((AGENT_NAMES as readonly string[]).includes(boss?.name ?? ""), `unexpected name ${boss?.name}`);
  }
});
