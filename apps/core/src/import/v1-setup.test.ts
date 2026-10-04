import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let ollama: http.Server;
let ollamaUrl = "";
const write = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v));
};
const GROUPS = ["keys", "memory", "embeddings", "services"] as const;
const stored = (kind: string) => env.core.store.settings.read("services").filter((s) => s.kind === kind);

before(async () => {
  // An Ollama that embeds every text as the same vector.
  ollama = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/embed") {
        const input = (JSON.parse(body) as { input: string[] }).input;
        res.end(JSON.stringify({ embeddings: input.map(() => [1, 0, 0]) }));
      } else res.end(JSON.stringify({ models: [] }));
    });
  });
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;

  env = await startCore({ llm: scriptedLlm(() => say("ok")), aux: true, providers: loadConfig({}, false).providers });
  const v1 = path.join(env.home, "v1");
  write(path.join(v1, "config.json"), {
    user: { language: "es" },
    engines: {
      gemini: { api_key: "test-key-gemini" },
      ollama: { base_url: ollamaUrl },
    },
    super_agent: { model: "ollama:gemma-test", self_model: "gemini:gemini-test" },
    memory: {
      compact_model: "ollama:qwen-test",
      compact_fallback_model: "chatgpt-codex:gpt-x@low",
      embeddings: {
        order: ["ollama", "gemini"],
        ollama: { model: "embed-test", base_url: "" },
        gemini: { api_key: "", model: "gemini-embedding-001" },
      },
    },
    images: {
      order: ["custom:zimage", "custom:flux_fast"],
      defaults: { negative_prompt: "blurry, watermark", size: "768x512" },
      a1111: { base_url: "" },
      sdcpp: { base_url: "http://sd.example.test:7860" },
      custom: {
        zimage: {
          kind: "sdcpp",
          label: "Z-Image",
          base_url: "http://images.example.test:1234",
          defaults: { steps: 8 },
        },
        flux_fast: { kind: "sdcpp", label: "Flux", base_url: "http://images.example.test:1235", enabled: false },
      },
    },
    voice: {
      voice_replies: true,
      tts: {
        provider: "custom:alejandro",
        mode: "single",
        order: ["custom:qvox", "custom:alejandro", "gemini", "piper"],
        gemini: { api_key: "", voice: "Puck" },
        custom: {
          qvox: { label: "QVox", base_url: "http://voice.example.test:5111/v1", voice: "ryan", language: "spanish" },
          alejandro: { label: "Alejandro", base_url: "http://voice.example.test:5111/v1", clone: "/voices/acme.wav" },
        },
      },
    },
    transcription: { provider: "local", local: { language: "auto" } },
  });
  write(path.join(v1, "memory.md"), "- [09:00][app] Ana prefers short answers\n");
  write(path.join(v1, "projects", "default", "memory.md"), "# MEMORY — default\n\n## 2026-09-01\n- Coffee at 10\n");
  write(
    path.join(v1, "projects", "0a0a0a0a0a0a", "memory.md"),
    "# Northwind — project memory\n\n## 2026-09-02\n- [11:00] Deploys go out on Fridays\n",
  );
  // An embedding engine an earlier import put at this machine's Ollama, whatever v1 said.
  env.core.store.settings.write("services", [
    {
      id: "v1-ollama",
      kind: "embedding",
      dialect: "ollama-embed",
      label: "Ollama",
      base_url: "http://127.0.0.1:11434",
      enabled: true,
      needs_key: false,
      model: "embed-test",
    },
  ]);
});
after(async () => {
  await env.core.close();
  env.cleanup();
  await new Promise((r) => ollama.close(r));
});

test("the scan counts v1's images, voices and transcription, and every note that becomes global", async () => {
  const { groups } = await env.client.call("setup.v1_scan", {});
  const count = Object.fromEntries(groups.map((g) => [g.id, g.count]));
  // zimage, flux, sdcpp; qvox, alejandro, Gemini's voice; v1's whisper.
  assert.equal(count.services, 7);
  assert.equal(count.memory, 3, "the super-agent's, Default's and a project v1 no longer lists");
  assert.equal(count.embeddings, 2, "Gemini on its engine's key");
});

test("importing brings v1's media in its order, its notes, its embedders where v1 had them, and the aux model", async () => {
  const r = await env.client.call("setup.import_v1", { groups: [...GROUPS] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.imported.memory, 3);
  assert.equal(r.imported.services, 9, "7 services, the image defaults and spoken replies");

  // Images: v1's order, a switched-off one off, the shared defaults.
  assert.deepEqual(
    stored("image").map((s) => [s.id, s.dialect, s.enabled]),
    [
      ["zimage", "sdcpp", true],
      ["flux-fast", "sdcpp", false],
      ["v1-sdcpp", "sdcpp", true],
    ],
  );
  assert.deepEqual(stored("image")[0]?.defaults, { steps: 8 });
  assert.deepEqual(env.core.store.settings.read("image_defaults"), {
    negative_prompt: "blurry, watermark",
    width: 768,
    height: 512,
  });
  // Voices: v1 spoke only with the chosen one; the rest wait, off. Gemini's voice runs on the Gemini engine's key.
  const speech = stored("speech");
  assert.deepEqual(
    speech.map((s) => [s.id, s.dialect, s.enabled]),
    [
      ["alejandro", "openai-speech", true],
      ["qvox", "openai-speech", false],
      ["v1-gemini-speech", "gemini-speech", false],
    ],
  );
  assert.equal(speech[0]?.clone, "/voices/acme.wav");
  assert.deepEqual([speech[1]?.voice, speech[1]?.language], ["ryan", "es"]);
  assert.equal(speech[2]?.voice, "Puck");
  assert.equal(env.core.secrets.resolve("secret://service-v1-gemini-speech"), "test-key-gemini");
  assert.equal(env.core.store.threads.context(HOME_THREAD_ID).voice_replies, true);
  // Transcription: v1's local whisper server, in the owner's language.
  assert.deepEqual(
    stored("transcription").map((s) => [s.id, s.dialect, s.base_url, s.language]),
    [["v1-whisper", "whisper-local", "http://127.0.0.1:18765", "es"]],
  );
  // Keys stay in the secret store, never in the saved settings.
  assert.ok(!JSON.stringify(env.core.store.settings.read("services")).includes("test-key"));

  // Notes: Default's are global, and an unlisted project's say where they came from.
  const global = env.core.store.memories.list({ scope: "global", limit: 50 }).map((m) => m.text);
  assert.ok(global.includes("Ana prefers short answers"));
  assert.ok(global.includes("Coffee at 10"));
  assert.ok(global.includes("[v1 · Northwind] Deploys go out on Fridays"));

  // Embeddings: Ollama where v1's engine is; Gemini with the Gemini engine's key.
  const embed = stored("embedding");
  assert.deepEqual(
    embed.map((s) => [s.id, s.base_url, s.model]),
    [
      ["v1-ollama", ollamaUrl, "embed-test"],
      ["v1-gemini", "https://generativelanguage.googleapis.com", "gemini-embedding-001"],
    ],
  );
  assert.equal(env.core.secrets.resolve("secret://service-v1-gemini"), "test-key-gemini");
  // The compaction model and v1's main model as the auxiliary chain; the CLI fallback stays out.
  assert.equal(env.core.store.settings.get("model_aux"), "ollama/qwen-test,ollama/gemma-test");

  // The notes get their vectors in the background.
  const deadline = Date.now() + 5000;
  let counts = env.core.store.memories.counts("v1-ollama/embed-test");
  while (counts.indexed < counts.total && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    counts = env.core.store.memories.counts("v1-ollama/embed-test");
  }
  assert.ok(counts.total >= 3);
  assert.equal(counts.indexed, counts.total);
});

test("importing again keeps what v2 has and the owner changed, and fills only what is missing", async () => {
  const boss = env.core.store.agents.list().find((a) => a.kind === "secretary");
  assert.deepEqual(boss?.model_choice, { model: "gemini/gemini-test", router: true });
  // The owner moves on in v2: another voice first, another aux model; and the super-agent lost its model.
  // Written as stored: the method would call each service to check it answers.
  const all = env.core.store.settings.read("services");
  env.core.store.settings.write("services", [
    ...all.filter((s) => s.id === "qvox"),
    ...all.filter((s) => s.id !== "qvox"),
  ]);
  env.core.store.settings.set("model_aux", "off");
  if (boss) {
    const { harness: _h, model_choice: _m, ...rest } = boss;
    env.core.store.agents.upsert(rest);
  }
  const before = JSON.stringify(env.core.store.settings.read("services"));
  const notes = env.core.store.memories.counts(undefined).total;

  const r = await env.client.call("setup.import_v1", { groups: [...GROUPS] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual([r.imported.memory, r.imported.embeddings, r.imported.services], [0, 0, 0]);
  assert.equal(JSON.stringify(env.core.store.settings.read("services")), before);
  assert.equal(env.core.store.memories.counts(undefined).total, notes);
  assert.equal(env.core.store.settings.get("model_aux"), "off");
  const again = env.core.store.agents.list().find((a) => a.kind === "secretary");
  assert.deepEqual(again?.model_choice, { model: "gemini/gemini-test", router: true });
});
