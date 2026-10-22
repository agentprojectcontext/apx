import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecrets, keychainService, projectSecretName, splitSecretName } from "./secrets.ts";
import { type Run, systemBackend } from "./secrets-stores.ts";

test("secrets resolve by reference, list names only, and live in a 0600 file with the file backend", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-secrets-"));
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
    // Windows reports writable mode bits, not POSIX owner/group permissions.
    assert.equal(
      fs.statSync(path.join(home, "secrets.json")).mode & 0o777,
      process.platform === "win32" ? 0o666 : 0o600,
    );
    s.set("gemini", null);
    assert.equal(s.resolve("secret://gemini"), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a project's own value wins over the global one there, and only there", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-secrets-"));
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
  assert.equal(keychainService("/tmp/test-home", "/home/u/.apx/v2"), `apx2:${path.resolve("/tmp/test-home")}`);
});

/** A system command stand-in: a Secret Service keyring in memory, or DPAPI as a reversible seal, as a Run. */
function fakeSystem(o: { keyring?: boolean; powershell?: boolean } = {}) {
  const keyring = new Map<string, string>();
  const calls: Array<{ cmd: string; args: string[]; input?: string | undefined }> = [];
  const run: Run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input });
    if (cmd === "secret-tool") {
      if (!o.keyring) throw new Error("Cannot autolaunch D-Bus without X11 $DISPLAY");
      const key = `${args.at(-3)}/${args.at(-1)}`;
      if (args[0] === "store") keyring.set(key, opts.input ?? "");
      if (args[0] === "clear") keyring.delete(key);
      if (args[0] === "lookup") {
        const v = keyring.get(key);
        if (v === undefined) throw new Error("not found");
        return v;
      }
      return "";
    }
    if (cmd === "powershell.exe") {
      if (!o.powershell) throw new Error("not found");
      const text = Buffer.from(opts.input ?? "", "base64").toString("utf8");
      const sealed = opts.env?.APX_DPAPI_OP === "protect" ? `sealed:${text}` : text.replace(/^sealed:/, "");
      return Buffer.from(sealed, "utf8").toString("base64");
    }
    throw new Error(`unexpected ${cmd}`);
  };
  return { run, keyring, calls };
}

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "apx-secrets-"));

test("each system has its store: Keychain on macOS, DPAPI on Windows, the Secret Service on Linux", () => {
  assert.equal(systemBackend("darwin"), "keychain");
  assert.equal(systemBackend("win32"), "dpapi");
  assert.equal(systemBackend("linux"), "secret-service");
});

test("on Linux values go to the keyring by stdin, the file keeps only names, and old file values move once", () => {
  const home = tempHome();
  try {
    fs.writeFileSync(path.join(home, "secrets.json"), JSON.stringify({ old: { value: "from-file", updated_at: "x" } }));
    const sys = fakeSystem({ keyring: true });
    const s = createSecrets(home, "secret-service", {}, sys.run);
    assert.equal(s.backend, "secret-service");
    assert.equal(fs.existsSync(path.join(home, "secrets.json")), false, "the old values file is gone");
    assert.equal(s.resolve("secret://old"), "from-file");
    s.set("google-calendar-refresh_token", "1//refresh-value-long");
    assert.equal(s.resolve("secret://google-calendar-refresh_token"), "1//refresh-value-long");
    const index = fs.readFileSync(path.join(home, "secrets.index.json"), "utf8");
    assert.doesNotMatch(index, /refresh-value|from-file/, "the index has names, never values");
    assert.ok(
      sys.calls.every((c) => !c.args.some((a) => a.includes("refresh-value"))),
      "a value never goes on argv",
    );
    assert.equal(s.resolve("secret://never-set"), undefined);
    assert.ok(!sys.calls.some((c) => c.args.includes("never-set")), "a name the index does not list is not looked up");
    s.set("old", null);
    assert.equal(s.resolve("secret://old"), undefined);
    assert.equal(sys.keyring.has(`${keychainService(home)}/old`), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("without a keyring a Linux server keeps the 0600 file; once values went to the keyring it stays chosen", () => {
  const server = tempHome();
  const desktop = tempHome();
  try {
    const s = createSecrets(server, "secret-service", {}, fakeSystem().run);
    assert.equal(s.backend, "file");
    s.set("token", "v");
    assert.equal(s.resolve("secret://token"), "v");

    const up = fakeSystem({ keyring: true });
    createSecrets(desktop, "secret-service", {}, up.run).set("token", "in-keyring");
    // A start before the keyring answers (a service at boot) must not fall back to an empty file.
    const locked = createSecrets(desktop, "secret-service", {}, fakeSystem().run);
    assert.equal(locked.backend, "secret-service");
    assert.equal(locked.resolve("secret://token"), undefined);
    assert.deepEqual(
      locked.list().map((x) => x.name),
      ["token"],
      "the owner still sees the name",
    );
    assert.equal(fs.existsSync(path.join(desktop, "secrets.json")), false);
  } finally {
    fs.rmSync(server, { recursive: true, force: true });
    fs.rmSync(desktop, { recursive: true, force: true });
  }
});

test("on Windows values are sealed with DPAPI in one file, apart from the index", () => {
  const home = tempHome();
  try {
    const sys = fakeSystem({ powershell: true });
    const s = createSecrets(home, "dpapi", {}, sys.run);
    assert.equal(s.backend, "dpapi");
    s.set("gemini", "k-123");
    s.set("slack", "xoxb-1");
    const sealed = fs.readFileSync(path.join(home, "secrets.dpapi"), "utf8");
    assert.doesNotMatch(sealed, /k-123/);
    assert.match(Buffer.from(sealed, "base64").toString("utf8"), /^sealed:/, "what is on disk went through Protect");
    assert.ok(sys.calls.every((c) => !c.args.some((a) => a.includes("k-123"))));
    assert.equal(sys.calls.at(-1)?.args.includes("-EncodedCommand"), true);
    // A fresh start reads the file back through Unprotect.
    const again = createSecrets(home, "dpapi", {}, sys.run);
    assert.equal(again.resolve("secret://gemini"), "k-123");
    assert.equal(again.resolve("secret://slack"), "xoxb-1");
    const bare = tempHome();
    assert.equal(createSecrets(bare, "dpapi", {}, fakeSystem().run).backend, "file", "no PowerShell: the file");
    fs.rmSync(bare, { recursive: true, force: true });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
