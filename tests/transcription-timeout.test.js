// Tests for transcription.js — verifying the configurable timeout for the
// local Whisper backend. Previously hard-coded to 5 minutes, now respects
// transcription.local.timeout_ms in config, defaulting to 20 minutes.

import { test } from "node:test";
import assert from "node:assert/strict";

test("transcription: DEFAULT_LOCAL exposes a timeout_ms >= 20 minutes", async () => {
  // We can't import DEFAULT_LOCAL directly (not exported), so we read the
  // source file and check the literal. This guards against an accidental
  // regression back to 5 minutes.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "voice", "transcription.js"),
    "utf8",
  );

  // Find the timeout_ms default. Accept any form that resolves to >= 20*60_000.
  const match = src.match(/timeout_ms:\s*([0-9_*+\s()]+)/);
  assert.ok(match, "timeout_ms must be defined in DEFAULT_LOCAL");
  // Safe eval of the small arithmetic expression (digits, _ as separator, * + ( )).
  const expr = match[1].replace(/_/g, "");
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expr});`)();
  assert.ok(value >= 20 * 60_000, `timeout_ms must be >= 20 minutes, got ${value}`);
});

test("transcription: timeout fetch call uses opts.timeout_ms when provided", async () => {
  // Verify by source inspection that the fetch in transcribeViaLocalServer reads
  // from opts.timeout_ms (not a hardcoded constant).
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "voice", "transcription.js"),
    "utf8",
  );
  // Should bind opts.timeout_ms to the local `timeoutMs` AND pass it to
  // AbortSignal.timeout(). We assert both bindings exist; they may be far
  // apart in the file (retry loop in between is allowed).
  assert.match(
    src,
    /Number\(opts\.timeout_ms\)/,
    "transcribeLocal should read opts.timeout_ms",
  );
  assert.match(
    src,
    /AbortSignal\.timeout\(\s*timeoutMs\s*\)/,
    "fetch must abort using the configurable timeoutMs",
  );
  // The old hardcoded value must be gone (or at least not the only path).
  const oldHardcoded = src.match(/AbortSignal\.timeout\(\s*5\s*\*\s*60_000\s*\)/);
  assert.equal(oldHardcoded, null, "old 5*60_000 hardcode must be removed");
});
