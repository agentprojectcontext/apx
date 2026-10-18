import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { type TestContext, test } from "node:test";

let sequence = 0;

/** Native platform boundaries only; the storage and lifecycle logic under test stays real. */
function native(t: TestContext) {
  const secure = new Map<string, string>();
  const files = new Map<string, string>();
  const schemes: string[] = [];
  const listeners = new Set<(state: string) => void>();
  let writes = 0;
  let failRead = false;
  let failWrite = false;
  const api = {
    async getItemAsync(key: string) {
      if (failRead) throw new Error("Keystore locked");
      return secure.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      if (failWrite) throw new Error("Keystore locked");
      secure.set(key, value);
    },
    async deleteItemAsync(key: string) {
      secure.delete(key);
    },
    Appearance: { setColorScheme: (scheme: string) => schemes.push(scheme) },
    AppState: {
      addEventListener: (_: string, fn: (state: string) => void) => {
        listeners.add(fn);
        return { remove: () => listeners.delete(fn) };
      },
    },
    Paths: { document: "test-documents" },
    File: class {
      key: string;
      constructor(...parts: string[]) {
        this.key = parts.join("/");
      }
      get exists() {
        return files.has(this.key);
      }
      textSync() {
        return files.get(this.key);
      }
      create() {
        files.set(this.key, "");
      }
      write(text: string) {
        if (failWrite) throw new Error("Disk full");
        writes++;
        files.set(this.key, text);
      }
    },
  };
  const key = Symbol.for("apx.native-storage-test");
  const id = sequence++;
  Reflect.set(globalThis, key, api);
  const exports: Record<string, string[]> = {
    "expo-secure-store": ["getItemAsync", "setItemAsync", "deleteItemAsync"],
    "react-native": ["Appearance", "AppState"],
    "expo-file-system": ["File", "Paths"],
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier in exports
        ? { url: `apx-native-storage:${id}/${specifier}`, shortCircuit: true }
        : next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith("apx-native-storage:")) return next(url, context);
      return {
        format: "module",
        shortCircuit: true,
        source: `const api = globalThis[Symbol.for("apx.native-storage-test")];\n${exports[
          url.slice(url.indexOf("/") + 1)
        ]
          ?.map(
            (name) =>
              `export const ${name} = ${["Appearance", "AppState", "File", "Paths"].includes(name) ? `api.${name}` : `(...args) => api.${name}(...args)`};`,
          )
          .join("\n")}`,
      };
    },
  });
  t.after(() => {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, key);
  });
  return {
    secure,
    files,
    schemes,
    get writes() {
      return writes;
    },
    failReads: () => {
      failRead = true;
    },
    failWrites: () => {
      failWrite = true;
    },
    background: () => {
      for (const listener of listeners) listener("background");
    },
  };
}

test("pairing credentials round trip through secure storage and reject corrupted shapes", async (t) => {
  const n = native(t);
  const { loadCreds, saveCreds, clearCreds } = await import("./creds.ts");
  assert.equal(await loadCreds(), undefined);
  const creds = { url: "https://core.example.com", token: "test-device-key", device: "phone" };
  await saveCreds(creds);
  assert.deepEqual(await loadCreds(), creds);
  assert.deepEqual(JSON.parse(n.secure.get("apx.pairing") ?? "null"), creds);
  await clearCreds();
  assert.equal(await loadCreds(), undefined);
  for (const raw of [
    "broken",
    "null",
    "{}",
    "[]",
    '{"url":1,"token":"key","device":"p"}',
    '{"url":"https://core.example.com","token":"","device":"p"}',
  ]) {
    n.secure.set("apx.pairing", raw);
    assert.equal(await loadCreds(), undefined, raw);
  }
  n.failReads();
  await assert.rejects(loadCreds(), /Keystore locked/);
});

test("appearance loads only valid values, falls back on locked storage and applies before persisting", async (t) => {
  const n = native(t);
  const { loadAppearance, saveAppearance, currentAppearance } = await import("./appearance.ts");
  for (const [raw, expected, scheme] of [
    ["light", "light", "light"],
    ["dark", "dark", "dark"],
    ["invalid", "system", "unspecified"],
  ]) {
    n.secure.set("apx.appearance", raw ?? "");
    assert.equal(await loadAppearance(), expected);
    assert.equal(currentAppearance(), expected);
    assert.equal(n.schemes.at(-1), scheme);
  }
  await saveAppearance("dark");
  assert.equal(n.secure.get("apx.appearance"), "dark");
  assert.equal(currentAppearance(), "dark");
  n.failReads();
  assert.equal(await loadAppearance(), "system");
  n.failWrites();
  await assert.rejects(saveAppearance("light"), /Keystore locked/);
  assert.equal(n.schemes.at(-1), "light");
});

test("drafts load only fresh valid text, debounce writes, preserve chats and clear empty drafts", async (t) => {
  const n = native(t);
  const now = Date.parse("2026-01-31T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  n.files.set(
    "test-documents/drafts.json",
    JSON.stringify({
      fresh: { text: "Keep", at: now - 1000 },
      expired: { text: "Forget", at: now - 31 * 86400_000 },
      empty: { text: "", at: now },
      malformed: { text: 5, at: now },
    }),
  );
  const { draftOf, keepDraft } = await import("./chat/drafts.ts");
  assert.equal(draftOf("fresh"), "Keep");
  for (const id of ["expired", "empty", "malformed", "missing"]) assert.equal(draftOf(id), "");
  keepDraft("fresh", "Keep");
  t.mock.timers.tick(500);
  assert.equal(n.writes, 0);
  keepDraft("new", "First");
  keepDraft("new", "Second");
  keepDraft("fresh", "");
  t.mock.timers.tick(399);
  assert.equal(n.writes, 0);
  t.mock.timers.tick(1);
  assert.equal(n.writes, 1);
  assert.equal(draftOf("new"), "Second");
  assert.deepEqual(JSON.parse(n.files.get("test-documents/drafts.json") ?? "null"), {
    new: { text: "Second", at: now + 500 },
  });
  keepDraft("new", "Background edit");
  n.background();
  assert.equal(n.writes, 2);
  t.mock.timers.tick(500);
  assert.equal(n.writes, 2);

  for (let i = 0; i < 101; i++) {
    t.mock.timers.tick(1);
    keepDraft(`chat-${i}`, `Draft ${i}`);
  }
  n.background();
  const kept = JSON.parse(n.files.get("test-documents/drafts.json") ?? "null");
  assert.equal(Object.keys(kept).length, 100);
  assert.equal(draftOf("chat-0"), "");
  assert.equal(draftOf("chat-100"), "Draft 100");
  n.failWrites();
  keepDraft("chat-100", "Retained despite disk failure");
  n.background();
  assert.equal(draftOf("chat-100"), "Retained despite disk failure");
  assert.equal(JSON.parse(n.files.get("test-documents/drafts.json") ?? "null")["chat-100"].text, "Draft 100");
});
