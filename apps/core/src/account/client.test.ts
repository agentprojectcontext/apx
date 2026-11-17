import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { ACCOUNT_CLIENT_FILE, accountClient } from "./client.ts";

test("an unconfigured installation stays local; packaged public configuration and explicit overrides are validated", async () => {
  const dir = tempDir("apx-account-client-");
  try {
    assert.equal(accountClient(undefined, dir.path), undefined);
    const config = { project: "acme-account", apiKey: "public-application-key" };
    fs.writeFileSync(path.join(dir.path, ACCOUNT_CLIENT_FILE), JSON.stringify(config));
    assert.deepEqual(accountClient(undefined, dir.path), config);
    const override = { project: "northwind-account", apiKey: "another-public-key" };
    assert.deepEqual(accountClient(JSON.stringify(override), dir.path), override);
    for (const value of [
      "",
      "null",
      "{",
      "{}",
      JSON.stringify({ ...config, project: "../outside" }),
      JSON.stringify({ ...config, apiKey: " " }),
    ]) {
      assert.equal(accountClient(value, dir.path), undefined);
    }
  } finally {
    await dir.remove();
  }
});
