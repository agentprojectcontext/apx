import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecrets, keychainService, projectSecretName, splitSecretName } from "./secrets.ts";

test("secrets resolve by reference, list names only, and live in a 0600 file with the file backend", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-secrets-"));
  try {
    const s = createSecrets(home, "file", { MY_KEY: "from-env" });
    s.set("gemini", "k-123");
    assert.equal(s.resolve("secret://gemini"), "k-123");
    assert.equal(s.resolve("env:MY_KEY"), "from-env");
    assert.equal(s.resolve("k-123"), undefined, "a bare value is never a reference");
    assert.deepEqual(
      s.list().map((x) => x.name),
      ["gemini"],
    );
    assert.equal(fs.statSync(path.join(home, "secrets.json")).mode & 0o777, 0o600);
    s.set("gemini", null);
    assert.equal(s.resolve("secret://gemini"), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a project's own value wins over the global one there, and only there", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-secrets-"));
  try {
    const s = createSecrets(home, "file", {});
    s.set("GH_TOKEN", "global-value");
    s.set(projectSecretName("p_acme", "GH_TOKEN"), "acme-value");
    assert.equal(s.resolveIn("secret://GH_TOKEN", "p_acme"), "acme-value");
    assert.equal(s.resolveIn("secret://GH_TOKEN", "p_northwind"), "global-value");
    assert.equal(s.resolveIn("secret://GH_TOKEN", undefined), "global-value");
    assert.equal(s.resolve("secret://GH_TOKEN"), "global-value", "a plain reference never sees a project's value");
    assert.deepEqual(splitSecretName(projectSecretName("p_acme", "GH_TOKEN")), {
      project_id: "p_acme",
      name: "GH_TOKEN",
    });
    assert.deepEqual(splitSecretName("GH_TOKEN"), { name: "GH_TOKEN" });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("each home has its own Keychain service; the default home keeps the plain one", () => {
  assert.equal(keychainService("/home/u/.apx/v2", "/home/u/.apx/v2"), "apx2");
  assert.equal(keychainService("/home/u/.apx/v2/", "/home/u/.apx/v2"), "apx2");
  assert.equal(keychainService("/tmp/test-home", "/home/u/.apx/v2"), "apx2:/tmp/test-home");
});
