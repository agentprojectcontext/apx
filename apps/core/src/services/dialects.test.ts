import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { generateImage, IMAGE_PROBE, probe } from "./images.ts";
import { speak } from "./speech.ts";
import type { ServiceConfig } from "./types.ts";
import { joinUrl } from "./types.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

type Seen = { path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders };
const seen: Seen[] = [];
let polls = 0;
let canceled = false;
let url = "";
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const path = req.url ?? "";
      seen.push({ path, body: raw ? JSON.parse(raw) : {}, headers: req.headers });
      const json = (j: object) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(j));
      };
      if (path === "/sdapi/v1/options") return json({});
      if (path === "/sdapi/v1/txt2img")
        return json({
          images: [PNG.toString("base64")],
          info: JSON.stringify({ all_seeds: [42], sd_model_name: "turbo" }),
        });
      if (path === "/sdcpp/v1/img_gen") return json({ id: "job1" });
      if (path === "/sdcpp/v1/jobs/job1")
        return json(
          ++polls < 2
            ? { status: "generating", queue_position: 0 }
            : { status: "completed", result: { images: [{ b64_json: PNG.toString("base64") }] } },
        );
      if (path === "/sdcpp/v1/jobs/slow") return json({ status: "queued" });
      if (path === "/sdcpp/v1/jobs/slow/cancel") {
        canceled = true;
        return json({});
      }
      if (path === "/v1/images/generations") return json({ data: [{ b64_json: PNG.toString("base64") }] });
      if (path === "/v1/audio/speech") {
        res.writeHead(200, { "content-type": "audio/wav" });
        return res.end(Buffer.from("RIFFfake"));
      }
      if (path.startsWith("/v1beta/models/"))
        return json({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.alloc(8).toString("base64") } }],
              },
            },
          ],
        });
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const svc = (p: Partial<ServiceConfig>): ServiceConfig => ({
  id: "s",
  kind: "image",
  dialect: "a1111",
  label: "Homelab",
  base_url: url,
  enabled: true,
  needs_key: false,
  ...p,
});
const req = {
  prompt: "a fox",
  width: 512,
  height: 512,
  steps: 8,
  cfg_scale: 2,
  seed: -1,
  count: 1,
  negative_prompt: "blurry",
  sampler: "",
};
const signal = () => new AbortController().signal;

test("joinUrl never doubles /v1", () => {
  assert.equal(joinUrl("http://h/v1", "/v1/images/generations"), "http://h/v1/images/generations");
  assert.equal(joinUrl("http://h/", "/sdapi/v1/txt2img"), "http://h/sdapi/v1/txt2img");
});

test("A1111: one call, the model by checkpoint, seeds and model read back", async () => {
  const r = await generateImage(svc({ model: "turbo.safetensors" }), req, undefined, signal());
  assert.equal(r.images[0]?.mime, "image/png");
  assert.equal(r.images[0]?.seed, 42);
  assert.equal(r.model, "turbo");
  const body = seen.findLast((s) => s.path === "/sdapi/v1/txt2img")?.body;
  assert.deepEqual(body?.override_settings, { sd_model_checkpoint: "turbo.safetensors" });
  assert.equal(body?.negative_prompt, "blurry");
  assert.equal(await probe(svc({}), IMAGE_PROBE.a1111 ?? "", undefined), true);
  assert.equal(await probe(svc({ dialect: "sdcpp" }), "/nothing", undefined), false);
});

test("stable-diffusion.cpp: queued job polled until done; an abandoned job is canceled", async () => {
  const r = await generateImage(svc({ dialect: "sdcpp" }), req, undefined, signal());
  assert.equal(r.images.length, 1);
  const params = seen.findLast((s) => s.path === "/sdcpp/v1/img_gen")?.body.sample_params as
    | { sample_steps?: number }
    | undefined;
  assert.equal(params?.sample_steps, 8);

  // A server that never finishes: the caller gives up, APX cancels the job so the GPU is free again.
  const slow: typeof fetch = (input, init) =>
    String(input).endsWith("/img_gen")
      ? Promise.resolve(new Response(JSON.stringify({ id: "slow" }), { status: 200 }))
      : fetch(input, init);
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("stop")), 1500);
  await assert.rejects(generateImage(svc({ dialect: "sdcpp" }), req, undefined, ac.signal, slow), /Homelab/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(canceled, true);
});

test("OpenAI-compatible images; QVox speech gets its style and language; Gemini PCM becomes WAV", async () => {
  const img = await generateImage(svc({ dialect: "openai-images", model: "gpt-image-1" }), req, "k", signal());
  assert.equal(img.images[0]?.mime, "image/png");
  assert.equal(seen.findLast((s) => s.path === "/v1/images/generations")?.body.size, "512x512");

  const voice = await speak(
    svc({ kind: "speech", dialect: "openai-speech", label: "QVox", voice: "narrator", language: "es", style: "calm" }),
    { text: "hola" },
    undefined,
    signal(),
  );
  assert.equal(voice.mime, "audio/wav");
  const body = seen.findLast((s) => s.path === "/v1/audio/speech")?.body;
  assert.deepEqual(
    [body?.input, body?.voice, body?.instruct, body?.language, body?.response_format],
    ["hola", "narrator", "calm", "es", "wav"],
  );

  const g = await speak(
    svc({ kind: "speech", dialect: "gemini-speech", label: "Gemini" }),
    { text: "hola" },
    "gk",
    signal(),
  );
  assert.equal(g.bytes.subarray(0, 4).toString(), "RIFF");
  const call = seen.findLast((s) => s.path.startsWith("/v1beta/models/"));
  assert.equal(call?.headers["x-goog-api-key"], "gk");
  assert.ok(!call?.path.includes("gk"), "the key never goes in the URL");
});
