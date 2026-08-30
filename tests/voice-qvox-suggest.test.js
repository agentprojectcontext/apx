// The QVox card is always on the Voices screen — it is the pointer to the
// project, not only an install prompt. What this predicate decides is which
// half of it renders: the install steps, or a note that the local voice is up.
// Getting it backwards would tell a machine already running QVox to install it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { shouldSuggestQvox } = await import(path.join(ROOT, "src/interfaces/web/src/lib/qvox.ts"));

test("install half shown when no local voice is configured", () => {
  assert.equal(shouldSuggestQvox([{ id: "gemini" }, { id: "openai" }]), true);
  assert.equal(shouldSuggestQvox([]), true);
});

test("install half hidden once a QVox provider exists", () => {
  assert.equal(shouldSuggestQvox([{ id: "custom:qvox", note: "http://127.0.0.1:5111/v1" }]), false);
});

test("hidden for a QVox added under another name — the port is the tell", () => {
  // Someone who called it "custom:voz" is running it just as much.
  assert.equal(shouldSuggestQvox([{ id: "custom:voz", note: "http://127.0.0.1:5111/v1" }]), false);
});

test("an unrelated custom endpoint does not count as having QVox", () => {
  assert.equal(shouldSuggestQvox([{ id: "custom:remote", note: "http://192.168.1.50:9000/v1" }]), true);
});
