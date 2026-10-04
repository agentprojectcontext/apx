import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { AGENT_NAMES } from "./seed.ts";

test("a fresh install names its super-agent from the list, unless the install says which name", async () => {
  for (const agentName of [undefined, "Ada"]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-seed-"));
    const core = await createCore(testConfig({ home, agentName }), { quiet: true });
    const boss = core.store.agents.list().find((a) => a.kind === "secretary");
    await core.close();
    fs.rmSync(home, { recursive: true, force: true });
    if (agentName) assert.equal(boss?.name, agentName);
    else assert.ok(AGENT_NAMES.includes(boss?.name ?? ""), `unexpected name ${boss?.name}`);
  }
});
