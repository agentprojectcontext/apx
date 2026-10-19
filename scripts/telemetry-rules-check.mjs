// Read-only security-rule checks against inline source; does not publish rules or write documents.
// FIREBASE_PROJECT=... GOOGLE_ACCESS_TOKEN=... node scripts/telemetry-rules-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";

const project = process.env.FIREBASE_PROJECT;
const token = process.env.GOOGLE_ACCESS_TOKEN;
assert.ok(project && token, "FIREBASE_PROJECT and GOOGLE_ACCESS_TOKEN are required");
const source = {
  files: [
    {
      name: "firestore.rules",
      content: fs.readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8"),
    },
  ],
};
const testCases = [];
const contexts = [
  null,
  { uid: "ordinary-user", token: {} },
  { uid: "private-reader", token: { telemetry_reader: true } },
];
for (const auth of contexts) {
  for (const suffix of [
    "installs/00000000-0000-4000-8000-000000000000",
    "installs/00000000-0000-4000-8000-000000000000/days/2026-01-01",
  ]) {
    for (const method of ["get", "list", "create", "update", "delete"]) {
      testCases.push({
        expectation: auth?.token.telemetry_reader === true && ["get", "list"].includes(method) ? "ALLOW" : "DENY",
        request: { auth, method, path: `/databases/(default)/documents/${suffix}` },
      });
    }
  }
}
testCases.push({
  expectation: "DENY",
  request: { auth: contexts[2], method: "get", path: "/databases/(default)/documents/unrelated/private" },
});
const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ source, testSuite: { testCases } }),
});
const result = await response.json();
assert.ok(response.ok, JSON.stringify(result));
assert.equal((result.issues ?? []).filter((x) => x.severity === "ERROR").length, 0, JSON.stringify(result.issues));
assert.equal(result.testResults?.length, testCases.length, "Every security case must execute");
result.testResults.forEach((r, i) => {
  assert.equal(r.state, "SUCCESS", `Case ${i}: ${JSON.stringify(r)}`);
});
console.log(
  "Security rules: " +
    testCases.length +
    " cases passed (anonymous/unclaimed/reader, reads/writes, unrelated collection).",
);
