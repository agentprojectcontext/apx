// The blob key list exists twice: once for the renderer
// (web/src/components/agents/blobPresets.ts, with eye rects and image sources)
// and once for the surfaces that only need to ASSIGN an avatar
// (core/apc/blob-keys.js — CLI, MCP server, daemon API).
//
// `scripts/export_web_assets.py` writes both, so they can only drift if someone
// hand-edits one. That drift is silent and ugly: an agent created from the CLI
// with a key the web doesn't know renders as a grey lettered disc, which is the
// exact bug the core list was added to fix. Hence this test.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOB_KEYS,
  SUPER_AGENT_BLOB,
  isBlobKey,
  pickBlob,
  resolveSuperAgentBlob,
} from "#core/apc/agent-identity.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function webBlobKeys() {
  const src = fs.readFileSync(
    path.join(REPO, "src/interfaces/web/src/components/agents/blobPresets.ts"),
    "utf8",
  );
  const body = src.slice(src.indexOf("BLOB_PRESETS"));
  return [...body.matchAll(/^\s{2}(\w+):\s*\{\s*key:/gm)].map((m) => m[1]);
}

test("core blob keys match the web renderer's, in the same order", () => {
  assert.deepEqual([...BLOB_KEYS], webBlobKeys());
});

test("Android bundles every shared blob and generated catalog entry", () => {
  const androidRoot = path.join(REPO, "src/interfaces/android/app/src/main");
  const catalog = fs.readFileSync(
    path.join(androidRoot, "java/dev/agentprojectcontext/apx/MascotBlobCatalog.java"),
    "utf8",
  );
  for (const key of BLOB_KEYS) {
    assert.ok(catalog.includes(`case "${key}"`), `missing Android catalog entry: ${key}`);
    assert.ok(
      fs.existsSync(path.join(androidRoot, `res/drawable-nodpi/mascot_${key}.png`)),
      `missing Android mascot body: ${key}`,
    );
  }
});

test("the super-agent's blob is one of the presets", () => {
  assert.ok(isBlobKey(SUPER_AGENT_BLOB));
});

test("the super-agent blob resolves a configured preset and rejects junk", () => {
  assert.equal(resolveSuperAgentBlob({ super_agent: { icon: "coral" } }), "coral");
  assert.equal(resolveSuperAgentBlob({ super_agent: { icon: "not-a-blob" } }), SUPER_AGENT_BLOB);
  assert.equal(resolveSuperAgentBlob({}), SUPER_AGENT_BLOB);
});

test("the web's SUPER_AGENT_ICON is the same blob core reserves", () => {
  const src = fs.readFileSync(
    path.join(REPO, "src/interfaces/web/src/components/agents/AgentAvatar.tsx"),
    "utf8",
  );
  const m = /SUPER_AGENT_ICON\s*=\s*"([^"]+)"/.exec(src);
  assert.ok(m, "SUPER_AGENT_ICON not found in AgentAvatar.tsx");
  assert.equal(m[1], SUPER_AGENT_BLOB);
});

test("pickBlob never hands out the super-agent's face", () => {
  // Walk the whole range of the rng so every branch of the pool is exercised.
  for (let i = 0; i < 100; i++) {
    const got = pickBlob({ rng: () => i / 100 });
    assert.notEqual(got, SUPER_AGENT_BLOB);
    assert.ok(isBlobKey(got));
  }
});

test("pickBlob prefers a blob the project isn't using yet", () => {
  const taken = BLOB_KEYS.filter((k) => k !== "onyx" && k !== SUPER_AGENT_BLOB);
  // Only "onyx" is free, so every draw must land on it regardless of the rng.
  for (const r of [0, 0.3, 0.99]) {
    assert.equal(pickBlob({ taken, rng: () => r }), "onyx");
  }
});

test("pickBlob falls back to the full set once every blob is taken", () => {
  const got = pickBlob({ taken: [...BLOB_KEYS], rng: () => 0.5 });
  assert.ok(isBlobKey(got));
  assert.notEqual(got, SUPER_AGENT_BLOB);
});

test("pickBlob ignores junk in `taken` instead of shrinking the pool", () => {
  const got = pickBlob({ taken: ["not-a-blob", null, undefined, 42], rng: () => 0 });
  assert.ok(isBlobKey(got));
});

// ── The two flat outputs ───────────────────────────────────────────────────
//
// A blob is drawn by <BlobAvatar> as an eyeless body with animated eye rects on
// top, which is right for the browser and useless to everything else: anything
// that just wants a picture of an agent — another product's panel, a chat, a
// README — got a blob with no face. So the export writes two more per blob, and
// these guard the parts that fail quietly.

function webPresets() {
  const src = fs.readFileSync(
    path.join(REPO, "src/interfaces/web/src/components/agents/blobPresets.ts"),
    "utf8",
  );
  const out = {};
  for (const line of src.split("\n")) {
    const m = /^\s{2}(\w+): \{.*?src: "([^"]+)", face: "([^"]+)", svg: "([^"]+)".*eyes: \[(.*)\] \},$/.exec(line);
    if (m) out[m[1]] = { src: m[2], face: m[3], svg: m[4], eyes: m[5] };
  }
  return out;
}

const publicPath = (url) => path.join(REPO, "src/interfaces/web/public", url);

test("every preset declares a flat face and a standalone svg, and both exist", () => {
  const presets = webPresets();
  assert.deepEqual(Object.keys(presets), [...BLOB_KEYS], "a preset is missing face/svg");

  for (const key of BLOB_KEYS) {
    const { face, svg } = presets[key];
    assert.ok(fs.existsSync(publicPath(face)), `missing composed face: ${key}`);
    assert.ok(fs.existsSync(publicPath(svg)), `missing standalone svg: ${key}`);
  }
});

// The failure this one exists for: writing the composed face over <key>.png.
// <BlobAvatar> would then draw eyes on a body that already has them, and nobody
// would notice until they looked at an avatar.
test("the composed face never replaces the eyeless body", () => {
  for (const [key, { src, face, eyes }] of Object.entries(webPresets())) {
    assert.notEqual(src, face, `${key}: face and body point at the same file`);

    // Only where there were eyes to add. A cyclops has its face in the render,
    // so its composed file is the body byte for byte — that is the next test.
    if (eyes.trim() === "") continue;

    assert.notEqual(
      fs.readFileSync(publicPath(src)).toString("base64"),
      fs.readFileSync(publicPath(face)).toString("base64"),
      `${key}: the body has the face baked into it`,
    );
  }
});

test("the svg stands on its own and carries the same eyes as the preset", () => {
  for (const [key, { svg, eyes }] of Object.entries(webPresets())) {
    const markup = fs.readFileSync(publicPath(svg), "utf8");

    // Self-contained, or it is no better than the preset it came from: a
    // consumer outside the web app cannot resolve a relative href.
    assert.match(markup, /href="data:image\/png;base64,/, `${key}: svg references the body instead of carrying it`);
    assert.match(markup, new RegExp(`viewBox="0 0 256 256"`), `${key}: svg is not in the preset's coordinate system`);

    const inSvg = [...markup.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map((m) => m.slice(1, 5).join(","));
    const inPreset = [...eyes.matchAll(/x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)/g)]
      .map((m) => m.slice(1, 5).join(","));

    assert.deepEqual(inSvg, inPreset, `${key}: the svg's eyes drifted from the preset's`);
  }
});

// `saturno` has its face in the render and no rects at all. It still gets a
// composed file, because a consumer asking for `face` should never have to know
// which blobs are cyclopes.
test("a cyclops still gets a face, it is just the body", () => {
  const cyclopes = Object.entries(webPresets()).filter(([, p]) => p.eyes.trim() === "");
  assert.ok(cyclopes.length > 0, "expected at least one cyclops preset");

  for (const [key, { src, face }] of cyclopes) {
    assert.ok(fs.existsSync(publicPath(face)), `missing composed face: ${key}`);
    assert.equal(
      fs.readFileSync(publicPath(src)).toString("base64"),
      fs.readFileSync(publicPath(face)).toString("base64"),
      `${key}: a cyclops's face should be its body, unchanged`,
    );
  }
});
