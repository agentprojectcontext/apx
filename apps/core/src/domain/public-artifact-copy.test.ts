import assert from "node:assert/strict";
import { test } from "node:test";
import { ArtifactBundle } from "@apx/protocol";
import {
  isPublicArtifactCode,
  PUBLIC_ARTIFACT_LIMITS,
  publicArtifactCode,
  publicArtifactCopy,
  publicArtifactUsage,
} from "./public-artifact-copy.ts";

const surface = {
  name: "orders",
  title: "Orders",
  html: "<h1>Orders</h1>",
  version: 3,
  app: true,
  state: { selected: { tab: "open" }, private: "not selected" },
  store: { credential: "private-store" },
  db: "private-db",
  author: "Private author",
  project_id: "private-project",
  connect: ["https://api.example.com"],
  secrets: ["private-key"],
};

test("a public copy defaults to HTML and a minimal installable manifest, not private memory or identity", () => {
  const copy = publicArtifactCopy(surface);
  assert.deepEqual(copy.bundle, {
    format: "apx-artifact@1",
    manifest: { name: "orders", title: "Orders", kind: "app", version: 3 },
    html: "<h1>Orders</h1>",
  });
  assert.deepEqual(ArtifactBundle.parse(JSON.parse(copy.json)), copy.bundle);
  assert.equal(copy.bytes, Buffer.byteLength(copy.json));
  for (const value of [
    "not selected",
    "private-store",
    "private-db",
    "Private author",
    "private-project",
    "private-key",
  ])
    assert.equal(copy.json.includes(value), false);
});

test("only explicitly chosen state keys enter the immutable public snapshot", () => {
  const source = { ...surface, state: { selected: { tab: "open" }, private: "private-value" } };
  const copy = publicArtifactCopy(source, ["selected"]);
  source.state.selected.tab = "closed";
  assert.deepEqual(copy.bundle.state, { selected: { tab: "open" } });
  assert.equal(copy.json.includes("private-value"), false);
  assert.equal(publicArtifactCopy(surface, ["selected"]).sha256, copy.sha256);
  assert.notEqual(publicArtifactCopy(source, ["selected"]).sha256, copy.sha256);
  assert.notEqual(publicArtifactCopy(surface).sha256, copy.sha256);
  assert.match(copy.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => publicArtifactCopy(source, ["missing"]), /no longer available/);
  assert.throws(() => publicArtifactCopy(source, ["selected", "selected"]), /different state keys/);
});

test("prototype keys are refused rather than silently removed from the approved copy", () => {
  assert.throws(() => publicArtifactCopy(surface, ["constructor"]), /cannot be published/);
  const source = { ...surface, state: JSON.parse('{"__proto__":{"safe":true}}') };
  assert.throws(() => publicArtifactCopy(source, ["__proto__"]), /cannot be published/);
  assert.equal(Object.hasOwn({}, "safe"), false);
});

test("malformed JSON state and secret references are refused before any upload", () => {
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, () => true, Symbol("invalid")]) {
    assert.throws(() => publicArtifactCopy({ ...surface, state: { selected: value } }, ["selected"]), /JSON values/);
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => publicArtifactCopy({ ...surface, state: { selected: cyclic } }, ["selected"]), /circular/i);
  assert.throws(
    () => publicArtifactCopy({ ...surface, html: '<script>fetch("secret://key")</script>' }),
    /secret references/,
  );
  assert.throws(
    () => publicArtifactCopy({ ...surface, state: { selected: "SECRET://key" } }, ["selected"]),
    /secret references/,
  );
});

test("limits count UTF-8 bytes, not characters; invalid manifests and oversized HTML are refused", () => {
  const copy = publicArtifactCopy({ ...surface, title: "Órdenes" });
  assert.ok(copy.bytes > copy.json.length);
  assert.throws(
    () =>
      publicArtifactCopy({ ...surface, state: { selected: "x".repeat(PUBLIC_ARTIFACT_LIMITS.bytes) } }, ["selected"]),
    /too large/,
  );
  assert.throws(() => publicArtifactCopy({ ...surface, name: "../invalid" }));
  assert.equal(publicArtifactCopy({ ...surface, html: "x".repeat(400_000) }).bundle.html.length, 400_000);
  assert.throws(() => publicArtifactCopy({ ...surface, html: "x".repeat(400_001) }), /public_artifact_html_too_large/);
});

test("publication codes have eight Crockford characters and contain no account-derived prefix", () => {
  const codes = Array.from({ length: 128 }, () => publicArtifactCode());
  for (const code of codes) assert.equal(isPublicArtifactCode(code), true);
  for (const code of ["1234567", "123456789", "abcdefgh/", "IIIIIIII", "llllllll", "oooooooo", "uuuuuuuu", "ABCDEFGH"])
    assert.equal(isPublicArtifactCode(code), false);
});

test("account usage computes a new or replacement copy without consuming another slot for updates", () => {
  const current = { count: 2, bytes: 700 };
  assert.deepEqual(publicArtifactUsage(current, 300), { count: 3, bytes: 1000 });
  assert.deepEqual(publicArtifactUsage(current, 300, 500), { count: 2, bytes: 500 });
  assert.deepEqual(current, { count: 2, bytes: 700 });
  assert.deepEqual(publicArtifactUsage({ count: 20, bytes: 700 }, 300, 500), { count: 20, bytes: 500 });
  assert.throws(() => publicArtifactUsage({ count: 20, bytes: 700 }, 300), /limit/);
  assert.throws(() => publicArtifactUsage({ count: 19, bytes: PUBLIC_ARTIFACT_LIMITS.accountBytes }, 1), /limit/);
  assert.throws(() => publicArtifactUsage(current, PUBLIC_ARTIFACT_LIMITS.bytes + 1), /too large/);
  assert.throws(() => publicArtifactUsage(current, -1), /Invalid/);
  assert.throws(() => publicArtifactUsage(current, 1.1), /Invalid/);
  assert.throws(() => publicArtifactUsage(current, 1, 701), /Invalid/);
  assert.throws(() => publicArtifactUsage({ count: 0, bytes: 700 }, 1, 100), /Invalid/);
});
