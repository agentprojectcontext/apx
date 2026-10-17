import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { localConnection, serviceConnection } from "./local.ts";

test("RPC connections honor APX_URL but service operations always target the local installation", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-service-target-"));
  try {
    fs.writeFileSync(path.join(home, "core.env"), "APX_PORT=7550\nAPX_TOKEN=local-token\n");
    const env = { APX_HOME: home, APX_URL: "https://server.example.com" };
    assert.equal(localConnection(env).url, "https://server.example.com");
    assert.deepEqual(serviceConnection(env), { url: "http://127.0.0.1:7550", token: "local-token" });
    assert.equal(serviceConnection({ ...env, APX_PORT: "7660" }).url, "http://127.0.0.1:7660");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
