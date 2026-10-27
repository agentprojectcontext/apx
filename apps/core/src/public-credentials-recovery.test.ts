import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createPublicCredentials } from "./public-credentials.ts";
import { tempDir } from "./testkit/platform.ts";

const activeKey = "public-route-credentials";
const cleanupKey = "public-route-credential-cleanup";
const endpoints = () => [{ path: "/flows/acme", label: "Acme" }];

test("rotation returns the committed credential despite cleanup failure and retries after a core restart", async (t) => {
  const folder = tempDir();
  let env = await startCore({ home: folder.path, llm: scriptedLlm(() => say("Unused")) });
  try {
    const credentials = createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    const first = credentials.rotate("/flows/acme");
    const previousToken = env.core.secrets.resolve(first.secret_ref);
    const set = env.core.secrets.set.bind(env.core.secrets);
    const failure = t.mock.method(env.core.secrets, "set", (name: string, value: string | null) => {
      if (value === null) throw new Error("Secret storage unavailable");
      return set(name, value);
    });
    const next = credentials.rotate("/flows/acme");
    const nextToken = env.core.secrets.resolve(next.secret_ref);
    assert.ok(nextToken, "a successful rotation returns a resolvable reference to its caller");
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${previousToken}` }), false);
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${nextToken}` }), true);
    assert.deepEqual(JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null"), [first.secret_ref]);
    assert.equal(env.core.store.settings.get(cleanupKey)?.includes(nextToken), false);
    failure.mock.restore();
    await env.core.close();
    env = await startCore({ home: folder.path, llm: scriptedLlm(() => say("Unused")) });
    const restarted = createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    assert.equal(env.core.secrets.resolve(first.secret_ref), undefined);
    assert.deepEqual(JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null"), []);
    assert.equal(restarted.authorize("/flows/acme", { authorization: `Bearer ${previousToken}` }), false);
    assert.equal(restarted.authorize("/flows/acme", { authorization: `Bearer ${nextToken}` }), true);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});

test("a failed activation keeps the old token and journals a new secret until cleanup recovers", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const credentials = createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    const first = credentials.rotate("/flows/acme");
    const previousToken = env.core.secrets.resolve(first.secret_ref);
    const setSecret = env.core.secrets.set.bind(env.core.secrets);
    const secretFailure = t.mock.method(env.core.secrets, "set", (name: string, value: string | null) => {
      if (value === null) throw new Error("Secret storage unavailable");
      return setSecret(name, value);
    });
    const setSetting = env.core.store.settings.set.bind(env.core.store.settings);
    const settingFailure = t.mock.method(env.core.store.settings, "set", (key: string, value: string) => {
      if (key === activeKey) throw new Error("Activation unavailable");
      return setSetting(key, value);
    });
    assert.throws(() => credentials.rotate("/flows/acme"), /Activation unavailable/);
    const pending = JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null") as string[];
    assert.equal(pending.length, 1);
    const abandonedRef = pending[0];
    assert.ok(abandonedRef);
    const abandonedToken = env.core.secrets.resolve(abandonedRef);
    assert.ok(abandonedToken);
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${abandonedToken}` }), false);
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${previousToken}` }), true);
    secretFailure.mock.restore();
    settingFailure.mock.restore();
    createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    assert.equal(env.core.secrets.resolve(abandonedRef), undefined);
    assert.equal(env.core.secrets.resolve(first.secret_ref), previousToken);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("activation and the old credential cleanup reference commit atomically", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const credentials = createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    const first = credentials.rotate("/flows/acme");
    const previousToken = env.core.secrets.resolve(first.secret_ref);
    const set = env.core.store.settings.set.bind(env.core.store.settings);
    t.mock.method(env.core.store.settings, "set", (key: string, value: string) => {
      if (key === cleanupKey && value === JSON.stringify([first.secret_ref])) throw new Error("Journal unavailable");
      return set(key, value);
    });
    assert.throws(() => credentials.rotate("/flows/acme"), /Journal unavailable/);
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${previousToken}` }), true);
    assert.deepEqual(JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null"), []);
    assert.deepEqual(
      env.core.secrets
        .list()
        .filter((entry) => entry.name.startsWith("public-token-"))
        .map((entry) => entry.name),
      [first.secret_ref.slice(9)],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a secret-store interruption after writing a token leaves a non-authorizing cleanup reference", async (t) => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const credentials = createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    const set = env.core.secrets.set.bind(env.core.secrets);
    const failure = t.mock.method(env.core.secrets, "set", (name: string, value: string | null) => {
      if (value === null) throw new Error("Delete unavailable");
      set(name, value);
      throw new Error("Write interrupted");
    });
    assert.throws(() => credentials.rotate("/flows/acme"), /Write interrupted/);
    const pending = JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null") as string[];
    assert.equal(pending.length, 1);
    assert.ok(env.core.secrets.resolve(pending[0]));
    assert.equal(env.core.store.settings.get(activeKey), undefined);
    failure.mock.restore();
    createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints });
    assert.equal(env.core.secrets.resolve(pending[0]), undefined);
    assert.deepEqual(JSON.parse(env.core.store.settings.get(cleanupKey) ?? "null"), []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
