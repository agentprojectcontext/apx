import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ServiceSettings } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createModelInstaller } from "../services/local-whisper.ts";
import { createServices } from "../services/registry.ts";
import type { CallContext } from "./context.ts";
import { LOCAL_EMBED_SERVICE, useLocalEmbedder } from "./embeddings.ts";
import { mediaHandlers } from "./media.ts";
import { createRouter, type Handlers } from "./router.ts";
import { LOCAL_SERVICE, transcriptionHandlers, useLocalModel } from "./transcription.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let services: ReturnType<typeof createServices>;
const log = createLog("test", true);
const ctx: CallContext = { transport: "internal", role: "operator", actor: "human", session: undefined, log };
const image: ServiceSettings = {
  kind: "image",
  dialect: "a1111",
  label: "Acme",
  base_url: "http://media.example.test",
  enabled: false,
  needs_key: true,
};
const requests: string[] = [];
const testRouter = (handlers: Partial<Handlers>) => createRouter(handlers as Handlers);

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  services = createServices({
    store: env.core.store,
    secrets: env.core.secrets,
    home: env.home,
    log,
    fetch: async (input) => {
      requests.push(String(input));
      return Response.json({});
    },
  });
});
after(async () => {
  services?.close();
  await env?.core.close();
  env?.cleanup();
});

test("service RPCs persist settings, keep keys private and return the requested kind in owner order", async () => {
  const dispatch = testRouter(mediaHandlers(services, env.core.store));
  for (const id of ["acme", "northwind"]) {
    const added = await dispatch(
      "services.set",
      { id, service: { ...image, label: id }, api_key: "test-service-private-value" },
      ctx,
      id,
    );
    assert.equal(added.ok, true);
    assert.doesNotMatch(JSON.stringify(added), /test-service-private-value/);
  }
  assert.equal(env.core.secrets.has("secret://service-acme"), true);
  const ordered = await dispatch("services.order", { kind: "image", ids: ["northwind", "acme"] }, ctx, "order");
  assert.ok(ordered.ok);
  assert.deepEqual(
    (ordered.result as { services: { id: string }[] }).services.map((s) => s.id),
    ["northwind", "acme"],
  );
  const listed = await dispatch("services.list", { kind: "speech" }, ctx);
  assert.ok(listed.ok);
  assert.deepEqual((listed.result as { services: unknown[] }).services, []);
  const defaults = await dispatch(
    "services.defaults",
    { width: 768, height: 512, steps: 15, cfg_scale: 6, count: 1, negative_prompt: "blur" },
    ctx,
    "defaults",
  );
  assert.ok(defaults.ok);
  assert.equal((defaults.result as { width: number }).width, 768);
  assert.equal(services.imageDefaults().negative_prompt, "blur");
});

test("testing a service reaches only the injected transport and returns a structured health result", async () => {
  const dispatch = testRouter(mediaHandlers(services, env.core.store));
  requests.length = 0;
  const result = await dispatch("services.test", { service: image, id: "acme" }, ctx);
  assert.ok(result.ok);
  assert.equal((result.result as { ok: boolean }).ok, true);
  assert.deepEqual(requests, ["http://media.example.test/sdapi/v1/options"]);
});

test("service mutations refuse agents before writing settings or exposing a key", async () => {
  const dispatch = testRouter(mediaHandlers(services, env.core.store));
  const before = env.core.store.settings.read("services");
  for (const [method, params] of [
    ["services.set", { id: "bad", service: image }],
    ["services.order", { kind: "image", ids: [] }],
    ["services.defaults", { width: 1024 }],
  ] as const) {
    const result = await dispatch(method, params, { ...ctx, actor: "agent" }, method);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.code, "unauthorized");
  }
  assert.deepEqual(env.core.store.settings.read("services"), before);
});

test("speech routes bind agent output to its own chat and turn service failures into unavailable errors", async (t) => {
  const calls: unknown[] = [];
  t.mock.method(services, "speak", async (input: Parameters<typeof services.speak>[0]) => {
    calls.push(input);
    return { media: { id: "med_1", mime: "audio/ogg" }, service: { label: "Acme voice" }, skipped: ["Offline voice"] };
  });
  const dispatch = testRouter(mediaHandlers(services, env.core.store));
  const actor = { ...ctx, actor: "agent" as const, agent: { id: "roby", run_id: "run_1", thread_id: "own-thread" } };
  const result = await dispatch("media.speak", { text: "Hello", thread: "other-thread" }, actor, "speak");
  assert.ok(result.ok);
  assert.deepEqual(result.result, {
    media: { id: "med_1", mime: "audio/ogg" },
    service: "Acme voice",
    skipped: ["Offline voice"],
  });
  assert.deepEqual(calls, [{ text: "Hello", thread: "own-thread" }]);
  t.mock.method(services, "speak", async () => {
    throw new Error("voice offline");
  });
  const failed = await dispatch("media.speak", { text: "Hello" }, ctx, "failed");
  assert.equal(!failed.ok && failed.error.code, "unavailable");
  assert.equal(!failed.ok && failed.error.message, "voice offline");
});

test("media reads preserve exact binary bytes and missing ids fail typed", async (t) => {
  const bytes = Buffer.from([0, 1, 255]);
  const media = env.core.store.media.add({
    kind: "image",
    mime: "image/png",
    bytes: bytes.length,
    path: path.join(env.home, "binary.png"),
  });
  t.mock.method(services, "read", (id: string) => (id === media.id ? { mime: "image/png", data: bytes } : undefined));
  const dispatch = testRouter(mediaHandlers(services, env.core.store));
  assert.deepEqual(await dispatch("media.get", { id: media.id }, ctx), {
    ok: true,
    result: { mime: "image/png", data: bytes.toString("base64"), bytes: 3 },
  });
  const missing = await dispatch("media.get", { id: "missing" }, ctx);
  assert.equal(!missing.ok && missing.error.code, "not_found");
});

test("local speech installation reuses a model already on disk and selects it before fallback services", async () => {
  const dir = path.join(env.home, "test-models");
  fs.mkdirSync(dir);
  const file = path.join(dir, "ggml-base.bin");
  fs.writeFileSync(file, "test model");
  let downloads = 0;
  const installer = createModelInstaller({
    dir,
    onReady: (_id, file) => useLocalModel(services, file, "en"),
    fetchImpl: async () => {
      downloads++;
      throw new Error("unexpected download");
    },
  });
  try {
    const dispatch = testRouter(transcriptionHandlers(services, installer));
    const installed = await dispatch("transcription.install", { model: "base" }, ctx, "install");
    assert.ok(installed.ok);
    assert.equal((installed.result as { active: string }).active, "base");
    assert.equal(downloads, 0);
    const stored = env.core.store.settings.read("services").find((s) => s.id === LOCAL_SERVICE);
    assert.equal(stored?.model, file);
    assert.equal(stored?.language, "en");
    assert.equal((await dispatch("transcription.local", {}, ctx)).ok, true);
    const bad = await dispatch("transcription.install", { model: "unknown" }, ctx, "bad");
    assert.equal(!bad.ok && bad.error.code, "bad_request");
    assert.equal(downloads, 0);
  } finally {
    installer.cancel();
  }
});

test("a local embedding choice persists the model and moves it first without dropping existing services", () => {
  services.set("fallback-embed", {
    kind: "embedding",
    dialect: "ollama-embed",
    label: "Fallback",
    enabled: false,
    needs_key: false,
    base_url: "http://fallback.example.test",
    model: "small",
  });
  useLocalEmbedder(services, "http://127.0.0.1:11434", "nomic-embed-text");
  const list = env.core.store.settings.read("services").filter((s) => s.kind === "embedding");
  assert.deepEqual(
    list.map((s) => s.id),
    [LOCAL_EMBED_SERVICE, "fallback-embed"],
  );
  assert.equal(list[0]?.model, "nomic-embed-text");
  assert.equal(list[0]?.needs_key, false);
});
