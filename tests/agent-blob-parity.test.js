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
