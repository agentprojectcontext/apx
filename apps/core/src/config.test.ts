import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig, testConfig } from "./config.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-config-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));
fs.writeFileSync(
  path.join(home, "core.env"),
  "# test\nAPX_HOST=0.0.0.0\nAPX_PORT=7501\nAPX_TOKEN=from-file\nAPX_PUBLIC_URL=https://apx.example.ts.net/\nAPX_SECRETS=keychain\n",
);

test("core.env in the home supplies defaults for the exposure keys", () => {
  const c = loadConfig({ APX_HOME: home });
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.port, 7501);
  assert.equal(c.token, "from-file");
  assert.equal(c.publicUrl, "https://apx.example.ts.net");
});

test("the process environment wins over core.env, and other keys in the file are ignored", () => {
  const c = loadConfig({ APX_HOME: home, APX_PORT: "7600", APX_TOKEN: "from-env", APX_SECRETS: "file" });
  assert.equal(c.port, 7600);
  assert.equal(c.token, "from-env");
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.secrets, "file");
});

test("a home without core.env, and testConfig, read nothing from disk", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apx-config-empty-"));
  try {
    assert.equal(loadConfig({ APX_HOME: empty }).host, "127.0.0.1");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  const t = testConfig({ home });
  assert.equal(t.host, "127.0.0.1");
  assert.equal(t.token, undefined);
});
