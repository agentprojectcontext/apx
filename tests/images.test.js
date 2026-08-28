// Tests for the image-generation subsystem in src/core/images/ and its daemon
// routes.
//
// Everything runs offline (project rule 1): the mock engine is the only real
// generator, and the three HTTP adapters are exercised against a stubbed
// global fetch that replays the shapes the real servers answer with — an
// AUTOMATIC1111 txt2img reply, a stable-diffusion.cpp job going
// queued → generating → completed, and an OpenAI /v1/images/generations reply
// in both its b64 and its URL form.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-images-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  generate, listProviders, capabilities,
  resolveRequest, ignoredOptions, imageOutDir,
  FAMILY_DEFAULTS, REQUEST_OPTIONS, IMAGES_DIR,
} = await import("#core/images/generate.js");
const {
  selectImageEngine, listAvailableImageEngines, getImageAdapter,
  resolveMode, resolveChainOrder, isCustomId,
  IMAGE_ENGINE_IDS, AUTO_PREFERENCE, CUSTOM_KINDS,
} = await import("#core/images/engines/index.js");
const { joinUrl, parseSize, sniffFormat, decodeBase64Image } =
  await import("#core/images/engines/shared.js");
const a1111 = (await import("#core/images/engines/a1111.js")).default;
const sdcpp = (await import("#core/images/engines/sdcpp.js")).default;
const openaiImages = (await import("#core/images/engines/openai.js")).default;
const mock = (await import("#core/images/engines/mock.js")).default;
const { buildApi } = await import("#host/daemon/api.js");

const outDir = () => fs.mkdtempSync(path.join(TMP_HOME, "out-"));

/** A 1x1 PNG, base64 — the smallest thing a fake server can hand back. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Swap in a fetch that answers from `routes` (substring of the URL → handler)
 * and record every call. Returns a restore function plus the call log.
 */
function stubFetch(routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: href, method: init.method || "GET", body, headers: init.headers || {} });
    const key = Object.keys(routes).find((k) => href.includes(k));
    if (!key) return new Response("no route", { status: 404 });
    const answer = await routes[key]({ href, body, calls });
    if (answer instanceof Response) return answer;
    return new Response(JSON.stringify(answer), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ---------------------------------------------------------------------------
// Registry surface
// ---------------------------------------------------------------------------

test("registry exposes the four engines and prefers local ones", () => {
  assert.deepEqual(IMAGE_ENGINE_IDS, ["a1111", "sdcpp", "openai", "mock"]);
  assert.equal(AUTO_PREFERENCE[0], "a1111");
  assert.equal(AUTO_PREFERENCE[AUTO_PREFERENCE.length - 1], "mock");
});

test("mock is appended to a chain order that forgot it", () => {
  assert.deepEqual(resolveChainOrder({ order: ["openai"] }), ["openai", "a1111", "sdcpp", "mock"]);
  // Unknown ids are dropped rather than routed to a missing adapter.
  assert.deepEqual(resolveChainOrder({ order: ["nope", "sdcpp"] }), ["sdcpp", "a1111", "openai", "mock"]);
});

test("mode is derived from provider when not set explicitly", () => {
  assert.equal(resolveMode({}), "chain");
  assert.equal(resolveMode({ provider: "auto" }), "chain");
  assert.equal(resolveMode({ provider: "a1111" }), "single");
  assert.equal(resolveMode({ provider: "a1111", mode: "chain" }), "chain");
});

test("a custom provider picks its adapter from `kind`, and an unknown kind is refused", () => {
  const cfg = { images: { custom: {
    box: { kind: "sdcpp", base_url: "http://example.test:8189" },
    plain: { base_url: "http://example.test:7860" },
    broken: { kind: "wat", base_url: "http://example.test" },
  } } };
  assert.ok(isCustomId("custom:box"));
  assert.equal(getImageAdapter("custom:box", cfg).id, "sdcpp");
  assert.equal(getImageAdapter("custom:plain", cfg).id, "a1111", "a1111 is the default dialect");
  assert.throws(() => getImageAdapter("custom:broken", cfg), /unknown kind/);
  assert.throws(() => getImageAdapter("nope", cfg), /unknown image provider/);
  assert.deepEqual(CUSTOM_KINDS, ["a1111", "sdcpp", "openai"]);
});

// ---------------------------------------------------------------------------
// isAvailable contracts
// ---------------------------------------------------------------------------

test("mock is always available; the HTTP engines need a base_url or a key", async () => {
  assert.equal(await mock.isAvailable(), true);
  assert.equal(await a1111.isAvailable({}), false);
  assert.equal(await sdcpp.isAvailable({}), false);

  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await openaiImages.isAvailable({}), false);
    assert.equal(await openaiImages.isAvailable({ api_key: "sk-test" }), true);
    // The parent engines block is the stock fallback — same as TTS.
    assert.equal(await openaiImages.isAvailable({}, { openai: { api_key: "sk-test" } }), true);
  } finally {
    if (prev) process.env.OPENAI_API_KEY = prev;
  }
});

test("a configured-but-unreachable server does not win the chain", async () => {
  const { restore } = stubFetch({}); // every probe 404s
  try {
    const cfg = { images: { a1111: { base_url: "http://offline.test:8189" } } };
    assert.equal(await a1111.isAvailable(cfg.images.a1111), false);
    const sel = await selectImageEngine({ globalConfig: cfg });
    assert.equal(sel.provider, "mock", "falls through instead of failing every call");
  } finally { restore(); }
});

test("single mode pins the engine even when a better one is reachable", async () => {
  const cfg = { images: { mode: "single", provider: "mock", a1111: { base_url: "http://x.test" } } };
  assert.equal((await selectImageEngine({ globalConfig: cfg })).provider, "mock");
  // An explicit argument still wins over the pinned default.
  assert.equal((await selectImageEngine({ globalConfig: cfg, provider: "a1111" })).provider, "a1111");
});

// ---------------------------------------------------------------------------
// Request resolution — four layers, later wins
// ---------------------------------------------------------------------------

test("defaults layer: family → images.defaults → engine defaults → the call", () => {
  const r = resolveRequest({
    imgCfg: { defaults: { width: 640, steps: 30 } },
    engineCfg: { defaults: { steps: 8, cfg_scale: 1 } },
    request: { steps: 12 },
  });
  assert.equal(r.width, 640, "global default survives");
  assert.equal(r.cfg_scale, 1, "engine default beats the family default");
  assert.equal(r.steps, 12, "the call beats everything");
  assert.equal(r.height, FAMILY_DEFAULTS.height, "untouched knobs keep the family value");
});

test("size expands into width/height at any layer, and a bad size is ignored", () => {
  assert.deepEqual(
    [resolveRequest({ request: { size: "768x512" } }).width, resolveRequest({ request: { size: "768x512" } }).height],
    [768, 512]
  );
  assert.equal(resolveRequest({ imgCfg: { defaults: { size: "1024x1024" } } }).width, 1024);
  assert.equal(resolveRequest({ request: { size: "big" } }).width, FAMILY_DEFAULTS.width);
  // An empty string must not mask a lower layer.
  assert.equal(resolveRequest({ imgCfg: { defaults: { sampler: "euler" } }, request: { sampler: "" } }).sampler, "euler");
});

test("options an engine cannot honor are reported, not silently dropped", () => {
  assert.deepEqual(ignoredOptions(openaiImages, { steps: 8, cfg_scale: 1, width: 512 }), ["steps", "cfg_scale"]);
  assert.deepEqual(ignoredOptions(sdcpp, { model: "x", steps: 8 }), ["model"]);
  assert.deepEqual(ignoredOptions(a1111, { steps: 8, sampler: "euler" }), []);
  // Defaults were not "asked for": a random seed and a batch of one are silent.
  assert.deepEqual(ignoredOptions(openaiImages, { seed: -1, count: 1 }), []);
  assert.deepEqual(ignoredOptions(openaiImages, { seed: 7 }), ["seed"]);
  // Every knob the family passes is declared by every adapter, one way or the
  // other — that is the contract this asserts.
  for (const adapter of [a1111, sdcpp, openaiImages, mock]) {
    for (const key of adapter.supports) {
      assert.ok(REQUEST_OPTIONS.includes(key), `${adapter.id} declares unknown option ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The mock engine + the facade
// ---------------------------------------------------------------------------

test("the mock engine writes real PNG bytes, deterministically", async () => {
  const dir = outDir();
  const a = await mock.generate({ prompt: "same", outDir: dir });
  const b = await mock.generate({ prompt: "same", outDir: dir });
  const c = await mock.generate({ prompt: "different", outDir: dir });
  const bytes = (r) => fs.readFileSync(r.images[0].path);
  assert.equal(bytes(a).subarray(1, 4).toString("ascii"), "PNG");
  assert.deepEqual(bytes(a), bytes(b), "same prompt, same picture");
  assert.notDeepEqual(bytes(a), bytes(c));
  assert.equal(a.images[0].mime, "image/png");
});

test("generate() with nothing configured still returns a file, via mock", async () => {
  const dir = outDir();
  const res = await generate({ prompt: "a fox", globalConfig: {}, outDir: dir, steps: 8 });
  assert.equal(res.provider, "mock");
  assert.equal(res.images.length, 1);
  assert.ok(fs.existsSync(res.images[0].path));
  assert.deepEqual(res.ignored, ["steps"], "mock honors nothing and says so");
  assert.equal(res.request.width, FAMILY_DEFAULTS.width);
  assert.ok(res.elapsed_ms >= 0);
});

test("generate() refuses an empty prompt", async () => {
  await assert.rejects(() => generate({ prompt: "  ", globalConfig: {} }), /prompt required/);
  await assert.rejects(() => generate({ globalConfig: {} }), /prompt required/);
});

test("count is honored by the mock engine and each file is distinct", async () => {
  const dir = outDir();
  const res = await generate({ prompt: "three", count: 3, globalConfig: {}, outDir: dir });
  assert.equal(res.images.length, 3);
  assert.equal(new Set(res.images.map((i) => i.path)).size, 3);
});

test("the gallery is dated and lives under ~/.apx/images, never in a project", () => {
  const dir = imageOutDir(new Date("2026-08-28T10:00:00Z"));
  assert.equal(dir, path.join(IMAGES_DIR, "2026-08-28"));
  assert.ok(dir.startsWith(path.resolve(process.env.APX_HOME)));
  assert.ok(fs.existsSync(dir));
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

test("joinUrl does not double the API prefix a user pasted", () => {
  assert.equal(joinUrl("http://h:1/v1", "/v1/images/generations"), "http://h:1/v1/images/generations");
  assert.equal(joinUrl("http://h:1", "/v1/images/generations"), "http://h:1/v1/images/generations");
  assert.equal(joinUrl("http://h:1/", "/sdapi/v1/txt2img"), "http://h:1/sdapi/v1/txt2img");
});

test("parseSize and the format sniffer", () => {
  assert.deepEqual(parseSize("768x512"), { width: 768, height: 512 });
  assert.deepEqual(parseSize(" 512 × 512 "), { width: 512, height: 512 });
  assert.equal(parseSize("wide"), null);
  // The extension must describe the real bytes, not what the request asked for.
  assert.equal(sniffFormat(decodeBase64Image(TINY_PNG_B64), "webp"), "png");
  assert.equal(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpeg");
});

// ---------------------------------------------------------------------------
// HTTP adapters, against replayed server shapes
// ---------------------------------------------------------------------------

test("a1111 posts the A1111 dialect and reads the seed out of `info`", async () => {
  const { calls, restore } = stubFetch({
    "/sdapi/v1/txt2img": () => ({
      images: [TINY_PNG_B64],
      info: JSON.stringify({ all_seeds: [1608784042], sd_model_name: "z_image_turbo", sampler_name: "euler", steps: 8 }),
    }),
  });
  try {
    const res = await a1111.generate({
      prompt: "a fox", negative_prompt: "blurry", width: 768, height: 512,
      steps: 8, cfg_scale: 1, seed: -1, sampler: "euler", scheduler: "discrete",
      count: 2, model: "z_image_turbo", outDir: outDir(),
      config: { base_url: "http://box.test:8189" },
    });
    const sent = calls[0].body;
    assert.equal(calls[0].url, "http://box.test:8189/sdapi/v1/txt2img");
    assert.equal(sent.sampler_name, "euler", "the field is sampler_name, not sampler");
    assert.equal(sent.negative_prompt, "blurry");
    assert.equal(sent.n_iter, 2);
    assert.deepEqual(sent.override_settings, { sd_model_checkpoint: "z_image_turbo" });
    assert.equal(res.images[0].seed, 1608784042, "the resolved seed of a seed:-1 run");
    assert.equal(res.model, "z_image_turbo");
  } finally { restore(); }
});

test("a1111 surfaces the server's own words on an error", async () => {
  const { restore } = stubFetch({
    "/sdapi/v1/txt2img": () => new Response(JSON.stringify({ error: "unknown sampler 'nope'" }), { status: 400 }),
  });
  try {
    await assert.rejects(
      () => a1111.generate({ prompt: "x", outDir: outDir(), config: { base_url: "http://box.test:8189" } }),
      /unknown sampler/
    );
  } finally { restore(); }
});

test("sdcpp submits a job, polls it to completion, and reports progress", async () => {
  let polls = 0;
  const seen = [];
  const { calls, restore } = stubFetch({
    "/sdcpp/v1/img_gen": () => ({ id: "job_1", poll_url: "/sdcpp/v1/jobs/job_1", status: "queued" }),
    "/sdcpp/v1/jobs/job_1": () => {
      polls++;
      if (polls < 3) return { status: "generating", queue_position: 3 - polls, result: null };
      return { status: "completed", started: 10, completed: 16, result: { images: [{ b64_json: TINY_PNG_B64 }], output_format: "png" } };
    },
  });
  try {
    const res = await sdcpp.generate({
      prompt: "a boat", steps: 6, cfg_scale: 1, sampler: "euler", width: 320, height: 320,
      count: 1, format: "png", seed: 7, outDir: outDir(),
      config: { base_url: "http://box.test:8189", poll_interval_ms: 1 },
      onProgress: (p) => seen.push(p.status),
    });
    const submit = calls[0].body;
    assert.deepEqual(submit.sample_params, { sample_steps: 6, sample_method: "euler", guidance: { txt_cfg: 1 } });
    assert.equal(submit.batch_count, 1);
    assert.equal(submit.output_format, "png");
    assert.equal(res.images[0].seed, 7);
    assert.equal(res.meta.job_id, "job_1");
    assert.equal(res.meta.elapsed_s, 6);
    assert.deepEqual(seen, ["generating", "generating", "completed"]);
    // The server-supplied poll_url is honored rather than rebuilt.
    assert.ok(calls[1].url.endsWith("/sdcpp/v1/jobs/job_1"));
  } finally { restore(); }
});

test("sdcpp explains a job that vanished under a restarting server", async () => {
  const { restore } = stubFetch({
    "/sdcpp/v1/img_gen": () => ({ id: "job_2", poll_url: "/sdcpp/v1/jobs/job_2", status: "queued" }),
    "/sdcpp/v1/jobs/job_2": () => new Response(JSON.stringify({ error: "job not found" }), { status: 404 }),
  });
  try {
    await assert.rejects(
      () => sdcpp.generate({ prompt: "x", outDir: outDir(), config: { base_url: "http://box.test:8189", poll_interval_ms: 1 } }),
      /restarted mid-render/
    );
  } finally { restore(); }
});

test("sdcpp fails loudly when the job itself fails", async () => {
  const { restore } = stubFetch({
    "/sdcpp/v1/img_gen": () => ({ id: "job_3", poll_url: "/sdcpp/v1/jobs/job_3", status: "queued" }),
    "/sdcpp/v1/jobs/job_3": () => ({ status: "failed", error: "out of memory" }),
  });
  try {
    await assert.rejects(
      () => sdcpp.generate({ prompt: "x", outDir: outDir(), config: { base_url: "http://box.test:8189", poll_interval_ms: 1 } }),
      /out of memory/
    );
  } finally { restore(); }
});

test("openai images: b64 and url replies both land on disk", async () => {
  const { calls, restore } = stubFetch({
    "/v1/images/generations": () => ({ data: [{ b64_json: TINY_PNG_B64 }] }),
  });
  try {
    const res = await openaiImages.generate({
      prompt: "a fox", width: 1024, height: 1024, count: 1,
      outDir: outDir(), config: { api_key: "sk-test" },
    });
    assert.equal(calls[0].body.size, "1024x1024");
    assert.equal(calls[0].body.response_format, "b64_json", "or dall-e-3 leaves nothing on disk");
    assert.equal(calls[0].headers.authorization, "Bearer sk-test");
    assert.equal(res.model, "gpt-image-1");
    assert.ok(fs.existsSync(res.images[0].path));
  } finally { restore(); }

  const { restore: restore2 } = stubFetch({
    "/v1/images/generations": () => ({ data: [{ url: "https://cdn.example.test/img.png" }] }),
    "cdn.example.test": () => new Response(decodeBase64Image(TINY_PNG_B64), { status: 200 }),
  });
  try {
    const res = await openaiImages.generate({ prompt: "a fox", outDir: outDir(), config: { api_key: "sk-test" } });
    assert.ok(fs.existsSync(res.images[0].path), "the expiring URL is fetched right away");
  } finally { restore2(); }
});

test("a custom OpenAI endpoint never receives the stock OpenAI key", async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-personal";
  const { calls, restore } = stubFetch({
    "/v1/images/generations": () => ({ data: [{ b64_json: TINY_PNG_B64 }] }),
  });
  try {
    await openaiImages.generate({
      prompt: "x", outDir: outDir(),
      config: { base_url: "http://box.test:8189/v1" },
      parentEnginesCfg: { openai: { api_key: "sk-engine" } },
    });
    assert.equal(calls[0].headers.authorization, undefined, "no key leaks to a third-party server");
    assert.equal(calls[0].url, "http://box.test:8189/v1/images/generations");
  } finally {
    restore();
    if (prev) process.env.OPENAI_API_KEY = prev; else delete process.env.OPENAI_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

test("capabilities() reads a live catalog, and survives a server that has none", async () => {
  const cfg = { images: { sdcpp: { base_url: "http://box.test:8189" } } };
  const { restore } = stubFetch({
    "/sdcpp/v1/capabilities": () => ({
      model: { stem: "z_image_turbo-Q4_K" },
      samplers: ["euler", "heun"],
      schedulers: ["discrete"],
      supported_modes: ["img_gen"],
      output_formats_by_mode: { img_gen: ["png", "webp"] },
      defaults: { width: 512, height: 512 },
    }),
  });
  try {
    const res = await capabilities({ provider: "sdcpp", globalConfig: cfg });
    assert.equal(res.provider, "sdcpp");
    assert.deepEqual(res.capabilities.models, ["z_image_turbo-Q4_K"]);
    assert.deepEqual(res.capabilities.formats, ["png", "webp"]);
  } finally { restore(); }

  const { restore: r2 } = stubFetch({});
  try {
    const res = await capabilities({ provider: "sdcpp", globalConfig: cfg });
    assert.equal(res.capabilities, null, "an unreachable catalog is not an error");
  } finally { r2(); }
});

test("listProviders reports routing, defaults and what each engine supports", async () => {
  const { restore } = stubFetch({});
  try {
    const info = await listProviders({ images: { provider: "mock", mode: "single", defaults: { steps: 8 } } });
    assert.equal(info.configured_provider, "mock");
    assert.equal(info.mode, "single");
    assert.equal(info.defaults.steps, 8);
    assert.equal(info.defaults.width, FAMILY_DEFAULTS.width);
    const byId = Object.fromEntries(info.engines.map((e) => [e.id, e]));
    assert.equal(byId.mock.available, true);
    assert.equal(byId.a1111.configured, false);
    assert.ok(byId.a1111.supports.includes("steps"));
  } finally { restore(); }
});

test("listing custom engines does not mistake routing metadata for configuration", async () => {
  const { restore } = stubFetch({});
  try {
    const engines = await listAvailableImageEngines({ images: { custom: {
      box: { label: "Homelab", kind: "sdcpp", enabled: false },
    } } });
    const custom = engines.find((e) => e.id === "custom:box");
    assert.equal(custom.configured, false, "label/kind/enabled are not config");
    assert.equal(custom.enabled, false);
    assert.equal(custom.label, "Homelab");
    assert.equal(custom.kind, "sdcpp");
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Daemon routes
// ---------------------------------------------------------------------------

function api() {
  return buildApi({
    projects: { list: () => [], get: () => null }, registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
}

async function withApi(fn) {
  const server = api().listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("POST /api/images/generate returns files plus a fetchable url", async () => {
  await withApi(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/images/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a fox", provider: "mock" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.provider, "mock");
    assert.ok(body.images[0].url.startsWith("/api/images/file?path="));

    // The url round-trips: the bytes come back through the file route.
    const file = await fetch(`${baseUrl}${body.images[0].url}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/png");
    assert.ok((await file.arrayBuffer()).byteLength > 0);
  });
});

test("POST /api/images/generate rejects an empty prompt", async () => {
  await withApi(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/images/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /prompt required/);
  });
});

test("GET /api/images/file is sandboxed to the gallery", async () => {
  await withApi(async (baseUrl) => {
    const outside = path.join(TMP_HOME, "secret.png");
    fs.writeFileSync(outside, decodeBase64Image(TINY_PNG_B64));
    const res = await fetch(`${baseUrl}/api/images/file?path=${encodeURIComponent(outside)}`);
    assert.equal(res.status, 403);

    // A traversal that resolves back out of the gallery is refused too.
    const traversal = path.join(IMAGES_DIR, "..", "secret.png");
    const res2 = await fetch(`${baseUrl}/api/images/file?path=${encodeURIComponent(traversal)}`);
    assert.equal(res2.status, 403);

    const missing = path.join(IMAGES_DIR, "2026-01-01", "nope.png");
    const res3 = await fetch(`${baseUrl}/api/images/file?path=${encodeURIComponent(missing)}`);
    assert.equal(res3.status, 404);
  });
});

test("GET /api/images/providers and /capabilities answer for the settings screen", async () => {
  await withApi(async (baseUrl) => {
    const providers = await (await fetch(`${baseUrl}/api/images/providers`)).json();
    assert.ok(Array.isArray(providers.engines));
    assert.ok(providers.order.includes("mock"));

    const caps = await (await fetch(`${baseUrl}/api/images/capabilities?provider=mock`)).json();
    assert.equal(caps.provider, "mock");
    assert.equal(caps.capabilities, null, "the mock engine has no catalog");

    const bad = await fetch(`${baseUrl}/api/images/capabilities?provider=nope`);
    assert.equal(bad.status, 400);
  });
});
