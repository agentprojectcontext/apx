import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeProgram } from "../harness/fake-program.test-support.ts";
import { createLog } from "../log.ts";
import { CODEX_IMAGE_SERVICE, CODEX_IMAGES, createCodexImages } from "./codex-images.ts";
import { createServices } from "./registry.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** A `codex` that answers like `codex exec --experimental-json` and leaves a PNG where its image_gen would. */
function fakeCodex(dir: string): { bin: string; env: Record<string, string>; prompt(): string; args(): string[] } {
  const asked = path.join(dir, "prompt.txt");
  const argv = path.join(dir, "argv.json");
  const events = [
    { type: "thread.started", thread_id: "thread-img" },
    { type: "item.completed", item: { id: "i0", type: "agent_message", text: "Done." } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  const fake = fakeProgram(
    dir,
    "codex",
    `const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(asked)}, input);
  fs.writeFileSync(${JSON.stringify(argv)}, JSON.stringify(argv));
  const made = path.join(process.env.CODEX_HOME, "generated_images", "thread-img");
  fs.mkdirSync(made, { recursive: true });
  fs.writeFileSync(path.join(made, "exec-1.png"), Buffer.from(${JSON.stringify(PNG.toString("base64"))}, "base64"));
  process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\n"))} + "\\n");
});`,
  );
  return {
    ...fake,
    prompt: () => fs.readFileSync(asked, "utf8"),
    args: () => JSON.parse(fs.readFileSync(argv, "utf8")) as string[],
  };
}

async function withServices(
  signedIn: boolean,
  run: (s: ReturnType<typeof createServices>, home: string, codex: ReturnType<typeof fakeCodex>) => unknown,
) {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const codex = fakeCodex(env.home);
  const services = createServices({
    store: env.core.store,
    secrets: env.core.secrets,
    home: env.home,
    log: createLog("test", true),
    codexImages: createCodexImages({
      codexPath: async () => codex.bin,
      signedIn: async () => signedIn,
      env: () => ({ PATH: process.env.PATH ?? "", CODEX_HOME: path.join(env.home, "codex-home"), ...codex.env }),
      workDir: path.join(env.home, "codex-images"),
    }),
  });
  try {
    await run(services, env.home, codex);
  } finally {
    services.close();
    await env.core.close();
    await env.cleanup();
  }
}

const homelab = {
  kind: "image",
  dialect: "a1111",
  label: "Homelab",
  base_url: "http://127.0.0.1:9",
  enabled: true,
  needs_key: false,
} as const;

test("a signed-in Codex is added first of the image services, once: removed, it is not added again", async () => {
  await withServices(true, async (services) => {
    services.set("homelab", homelab);
    assert.equal(services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE), true);
    assert.deepEqual(
      (await services.info("image")).map((s) => [s.id, s.status]),
      [
        [CODEX_IMAGES, "reachable"],
        ["homelab", "unreachable"],
      ],
    );
    assert.equal(services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE), false);
    services.set(CODEX_IMAGES, null);
    assert.equal(services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE), false);
    assert.deepEqual(
      (await services.info("image")).map((s) => s.id),
      ["homelab"],
    );
  });
});

test("an image asked through Codex is the one its image_gen left in its thread's folder, kept as the chat's media", async () => {
  await withServices(true, async (services, home, codex) => {
    services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE);
    const got = await services.image(
      { prompt: "a unicorn over a neon city", width: 1024, height: 512 },
      AbortSignal.timeout(20_000),
    );
    assert.equal(got.service.id, CODEX_IMAGES);
    assert.equal(got.media.length, 1);
    const m = got.media[0];
    assert.ok(m);
    assert.equal(m.mime, "image/png");
    assert.ok(m.path.startsWith(path.join(home, "media")));
    assert.deepEqual(fs.readFileSync(m.path), PNG);
    assert.match(codex.prompt(), /image_gen/);
    assert.match(codex.prompt(), /landscape/);
    assert.match(codex.prompt(), /a unicorn over a neon city/);
  });
});

test("Codex not signed in shows as unreachable and does not draw", async () => {
  await withServices(false, async (services) => {
    services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE);
    assert.equal((await services.info("image"))[0]?.status, "unreachable");
    assert.equal((await services.test(CODEX_IMAGE_SERVICE)).ok, false);
  });
});

test("reference images reach Codex as images of its turn; only images of the same chat can be references", async () => {
  await withServices(true, async (services, _home, codex) => {
    services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE);
    const ref = services.keep(PNG, "image/png");
    const got = await services.image(
      {
        prompt: "a carousel cover in the reel's style",
        references: [{ path: ref.path, mime: ref.mime }],
      },
      AbortSignal.timeout(20_000),
    );
    assert.equal(got.media.length, 1);
    const args = codex.args();
    assert.equal(args[args.indexOf("--image") + 1], ref.path);
    assert.match(codex.prompt(), /attached image is a reference/);

    assert.deepEqual(services.imageReference(ref.id, undefined), { path: ref.path, mime: "image/png" });
    assert.equal(services.imageReference(ref.id, "thr_other"), undefined);
    const drawn = got.media[0];
    assert.ok(drawn);
    assert.equal(services.imageReference(drawn.id, "thr_other"), undefined);
    assert.equal(services.imageReference("med_missing", undefined), undefined);
  });
});

test("Codex is told nothing about references when there are none", async () => {
  await withServices(true, async (services, _home, codex) => {
    services.offer(CODEX_IMAGES, CODEX_IMAGE_SERVICE);
    await services.image({ prompt: "a fox" }, AbortSignal.timeout(20_000));
    assert.equal(codex.args().includes("--image"), false);
    assert.doesNotMatch(codex.prompt(), /reference/);
  });
});
