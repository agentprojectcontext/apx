import { test } from "node:test";
import assert from "node:assert/strict";
import { mascot } from "#core/mascot.js";

function captureStderr(fn) {
  const originalWrite = process.stderr.write;
  let output = "";
  process.stderr.write = (chunk, encoding, callback) => {
    output += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };

  try {
    fn();
    return output;
  } finally {
    process.stderr.write = originalWrite;
  }
}

test("mascot prints a stable panda banner with caption and message", () => {
  const output = captureStderr(() => mascot("wave", "Setup Wizard"));

  assert.match(output, /▄███████▄/);
  assert.match(output, /◕   ◕/);
  assert.match(output, /APX/);
  assert.match(output, /Setup Wizard/);
  assert.doesNotMatch(output, /👋/u);
});

test("mascot falls back to happy mood for unknown mood", () => {
  const output = captureStderr(() => mascot("missing"));

  assert.match(output, /ready to go!/);
});
