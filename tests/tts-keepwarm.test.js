// The voice engine is kept warm on a timer because idle weights get compressed
// out and the next generation pays seconds to decompress them. That ping is
// only ever safe against an engine the user runs themselves: the same timer
// aimed at a metered API would bill for silence, forever, in the background.
// These tests pin that boundary and the config switches around it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSelfHosted,
  keepWarmTarget,
  DEFAULT_KEEP_WARM_MINUTES,
} from "../src/host/daemon/tts-keepwarm.js";

test("isSelfHosted accepts this machine and the local network", () => {
  for (const url of [
    "http://127.0.0.1:5111/v1",
    "http://127.1.2.3:5111/v1",
    "http://localhost:5111/v1",
    "http://qvox.local:5111/v1",
    "http://192.168.18.138:5111/v1",
    "http://10.0.0.4:8080/v1",
    "http://172.16.0.1/v1",
    "http://172.31.255.254/v1",
  ]) assert.equal(isSelfHosted(url), true, url);
});

test("isSelfHosted rejects anything reached over the internet", () => {
  for (const url of [
    "https://api.openai.com/v1",
    "https://api.elevenlabs.io/v1",
    "https://tts.example.com/v1",
    // Just outside the private /12 — a real public address, and the exact
    // off-by-one a hand-written range check gets wrong.
    "http://172.32.1.5/v1",
    "http://172.15.1.5/v1",
    "http://8.8.8.8/v1",
    "not a url",
    "",
    undefined,
  ]) assert.equal(isSelfHosted(url), false, String(url));
});

const localQvox = {
  voice: { tts: {
    mode: "chain",
    order: ["custom:qvox"],
    custom: { qvox: { base_url: "http://127.0.0.1:5111/v1", voice: "aiden" } },
  } },
};

test("keepWarmTarget picks a local custom endpoint", async () => {
  const t = await keepWarmTarget(localQvox);
  assert.ok(t, "expected a target");
  assert.equal(t.provider, "custom:qvox");
});

test("keepWarmTarget refuses a remote endpoint even when it is first in the chain", async () => {
  const remote = {
    voice: { tts: {
      mode: "chain",
      order: ["custom:cloudtts"],
      custom: { cloudtts: { base_url: "https://tts.example.com/v1" } },
    } },
  };
  assert.equal(await keepWarmTarget(remote), null);
});

test("keepWarmTarget refuses a stock cloud provider", async () => {
  const openai = {
    voice: { tts: { mode: "single", provider: "openai", openai: { api_key: "K" } } },
  };
  assert.equal(await keepWarmTarget(openai), null);
});

test("keepWarmTarget refuses an engine with nothing to warm", async () => {
  // mock is always available and is what an unconfigured chain falls through
  // to; it has no warmup, so there is nothing to keep hot.
  assert.equal(await keepWarmTarget({ voice: { tts: { mode: "single", provider: "mock" } } }), null);
});

test("the default interval stays well inside the window that was measured cold", () => {
  // 2.5 min idle was still warm, 8.75 min was not. A default at or above the
  // cold end would make the timer useless while still costing a ping.
  assert.ok(DEFAULT_KEEP_WARM_MINUTES >= 1);
  assert.ok(DEFAULT_KEEP_WARM_MINUTES <= 5);
});
