// Unit tests for the CLI branding helpers (src/interfaces/cli/branding.js).
//
// They write to stderr; we capture it. Key guarantees:
//   - apxHeader / apxBanner always include the version
//   - both honour APX_QUIET / APX_NO_BANNER (silent)
//   - output goes to stderr (so stdout pipes stay clean)
import { test } from "node:test";
import assert from "node:assert/strict";

import { apxHeader, apxBanner } from "#interfaces/cli/branding.js";

function captureStderr(fn) {
  const orig = process.stderr.write;
  let buf = "";
  process.stderr.write = (chunk) => { buf += chunk; return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return buf;
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  let buf = "";
  process.stdout.write = (chunk) => { buf += chunk; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return buf;
}

test("apxHeader prints version + subtitle to stderr", () => {
  const out = captureStderr(() => apxHeader("9.9.9", "skills inspector"));
  assert.match(out, /APX/);
  assert.match(out, /v9\.9\.9/);
  assert.match(out, /skills inspector/);
});

test("apxHeader never writes to stdout (pipes stay clean)", () => {
  const stdout = captureStdout(() => {
    // capture stderr too so it doesn't leak into the test reporter
    captureStderr(() => apxHeader("1.0.0", "x"));
  });
  assert.equal(stdout, "");
});

test("apxBanner prints the big wordmark with version", () => {
  const out = captureStderr(() => apxBanner("2.3.4", "init demo"));
  assert.match(out, /v2\.3\.4/);
  assert.match(out, /init demo/);
  // ASCII art uses box-drawing blocks
  assert.match(out, /█|╗|╝/);
});

test("APX_QUIET suppresses both header and banner", () => {
  const prev = process.env.APX_QUIET;
  process.env.APX_QUIET = "1";
  try {
    assert.equal(captureStderr(() => apxHeader("1.0.0", "x")), "");
    assert.equal(captureStderr(() => apxBanner("1.0.0", "x")), "");
  } finally {
    if (prev === undefined) delete process.env.APX_QUIET;
    else process.env.APX_QUIET = prev;
  }
});

test("APX_NO_BANNER suppresses output", () => {
  const prev = process.env.APX_NO_BANNER;
  process.env.APX_NO_BANNER = "1";
  try {
    assert.equal(captureStderr(() => apxHeader("1.0.0", "x")), "");
  } finally {
    if (prev === undefined) delete process.env.APX_NO_BANNER;
    else process.env.APX_NO_BANNER = prev;
  }
});
