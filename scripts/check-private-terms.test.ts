import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { approvedPublicHit, type Commit, parseTerms, scanCommits, scanText } from "./check-private-terms.ts";

test("a public exception requires the exact file, content and approved term", () => {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const approval = { file: "author.mjs", content: hash("Acme"), terms: new Set([hash("Acme")]) };
  assert.equal(approvedPublicHit("author.mjs", "Acme", "Acme", approval), true);
  assert.equal(approvedPublicHit("other.mjs", "Acme", "Acme", approval), false);
  assert.equal(approvedPublicHit("author.mjs", "Acme plus private", "Acme", approval), false);
  assert.equal(approvedPublicHit("author.mjs", "Acme", "private", approval), false);
  assert.equal(approvedPublicHit("author.mjs", "Acme", "user-path", approval), false);
});

test("public attribution exception leaves other terms, paths, files and edits checked", () => {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const text = `Acme Other ${["", "Users", "someone-private"].join("/")}`;
  const approval = { file: "author.mjs", content: hash(text), terms: new Set([hash("Acme")]) };
  const { matchers, allow } = parseTerms("Acme\nOther");
  assert.deepEqual(
    scanText("author.mjs", text, matchers, allow, approval).map((h) => h.term),
    ["Other", "user-path"],
  );
  assert.deepEqual(
    scanText("other.mjs", text, matchers, allow, approval).map((h) => h.term),
    ["Acme", "Other", "user-path"],
  );
  assert.deepEqual(
    scanText("author.mjs", `${text}!`, matchers, allow, approval).map((h) => h.term),
    ["Acme", "Other", "user-path"],
  );
});

const me = "1234567+acme@users.noreply.github.com";
const commit = (c: Partial<Commit>): Commit => ({
  sha: "0123456789abcdef",
  authorEmail: me,
  committerEmail: me,
  message: "fix(web): something\n",
  ...c,
});
const terms = (c: Partial<Commit>) => scanCommits([commit(c)], [], []).map((h) => h.term);

test("a commit by a GitHub noreply address passes", () => {
  assert.deepEqual(terms({}), []);
});

test("a personal email fails as author or as committer", () => {
  assert.deepEqual(terms({ authorEmail: "someone@example.com", committerEmail: "someone@example.com" }), [
    "author-email",
  ]);
  assert.deepEqual(terms({ committerEmail: "someone@example.com" }), ["author-email"]);
});

test("a pull request merged in GitHub's web UI passes with its web-flow committer, not with a personal author", () => {
  assert.deepEqual(terms({ committerEmail: "noreply@github.com" }), []);
  assert.deepEqual(terms({ authorEmail: "someone@example.com", committerEmail: "noreply@github.com" }), [
    "author-email",
  ]);
});

test("AI-tool trailers fail", () => {
  assert.deepEqual(terms({ message: "fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n" }), ["ai-trailer"]);
});
