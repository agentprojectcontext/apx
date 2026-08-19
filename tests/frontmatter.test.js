// Four parsers with four different key patterns meant the same file read by
// two code paths yielded different fields, silently — a non-matching line is
// just skipped, so nothing ever errored. These tests pin the union behaviour.
import test from "node:test";
import assert from "node:assert/strict";

import {
  formatFrontmatterEntry,
  parseFrontmatter,
  parseFrontmatterFields,
  setFrontmatterField,
} from "#core/apc/frontmatter.js";

test("no frontmatter: the whole text is the body", () => {
  const r = parseFrontmatter("# Just a heading\n\nbody");
  assert.deepEqual(r.fm, {});
  assert.equal(r.body, "# Just a heading\n\nbody");
  assert.equal(r.bodyStart, 0);
});

test("unterminated frontmatter is not treated as frontmatter", () => {
  const r = parseFrontmatter("---\nagent: sofia\nno closing fence");
  assert.deepEqual(r.fm, {});
  assert.equal(r.bodyStart, 0);
});

test("parses fields and returns the body separately", () => {
  const r = parseFrontmatter("---\nagent: sofia\nstarted: 2026-08-16T10:00:00Z\n---\n\nThe body.\n");
  assert.deepEqual(r.fm, { agent: "sofia", started: "2026-08-16T10:00:00Z" });
  assert.equal(r.body, "The body.\n");
  assert.ok(r.bodyStart > 0);
});

// The actual bug: these key shapes parsed in some copies and vanished in others.
test("keys may contain digits and dashes", () => {
  const fm = parseFrontmatterFields(
    "---\nroute_to_agent2: sofia\nagent-slug: reviewer\nplain: ok\n---\nbody"
  );
  assert.deepEqual(fm, {
    route_to_agent2: "sofia",
    "agent-slug": "reviewer",
    plain: "ok",
  });
});

test("quoted values are unquoted, single or double", () => {
  const fm = parseFrontmatterFields(`---\na: "quoted"\nb: 'single'\nc: bare\n---\nx`);
  assert.deepEqual(fm, { a: "quoted", b: "single", c: "bare" });
});

test("a lone quote is not stripped", () => {
  assert.deepEqual(parseFrontmatterFields(`---\na: "\n---\nx`), { a: '"' });
});

test("a bare --- opener is accepted", () => {
  assert.deepEqual(parseFrontmatterFields("---\nname: x\n---\nbody"), { name: "x" });
});

test("values keep inner colons and are trimmed", () => {
  const fm = parseFrontmatterFields("---\nurl:   https://example.com/a:b   \n---\nx");
  assert.equal(fm.url, "https://example.com/a:b");
});

test("lines that are not key: value are skipped, not fatal", () => {
  const fm = parseFrontmatterFields("---\nok: 1\n# a comment\n   \n2bad: nope\n---\nx");
  assert.deepEqual(fm, { ok: "1" });
});

test("setFrontmatterField: replaces an existing field, preserves the rest", () => {
  const src = "---\nagent: sofia\nstatus: open\n---\n\nBody stays.\n";
  const out = setFrontmatterField(src, "status", "closed");
  assert.deepEqual(parseFrontmatterFields(out), { agent: "sofia", status: "closed" });
  assert.ok(out.endsWith("\nBody stays.\n"));
});

test("setFrontmatterField: appends a missing field", () => {
  const out = setFrontmatterField("---\nagent: sofia\n---\nbody", "status", "open");
  assert.deepEqual(parseFrontmatterFields(out), { agent: "sofia", status: "open" });
});

test("setFrontmatterField: no frontmatter means no change", () => {
  assert.equal(setFrontmatterField("plain text", "a", "b"), "plain text");
});

test("null and undefined are handled like empty input", () => {
  for (const v of [null, undefined, ""]) {
    const r = parseFrontmatter(v);
    assert.deepEqual(r.fm, {});
    assert.equal(r.body, "");
  }
});

// ---------------------------------------------------------------------------
// Shapes APX does not write but does read: every third-party skill dropped
// into ~/.apx/skills/ comes from an ecosystem where a multi-line description
// is a block scalar. A flat parser read `description: |` as the string "|"
// and dropped the four lines under it, so the skill listed fine while the
// Skill Inspector embedded "|" and could never match it.
// ---------------------------------------------------------------------------

test("block scalar `|` keeps the line breaks", () => {
  const fm = parseFrontmatterFields(
    "---\nname: humanizer\ndescription: |\n  first line\n  second line\nlicense: MIT\n---\nbody"
  );
  assert.equal(fm.description, "first line\nsecond line");
  // and the keys around it are untouched
  assert.equal(fm.name, "humanizer");
  assert.equal(fm.license, "MIT");
});

test("block scalar `>` folds lines into one, blank line becomes a newline", () => {
  const fm = parseFrontmatterFields(
    "---\ndescription: >\n  first line\n  second line\n\n  new paragraph\nafter: x\n---\nbody"
  );
  assert.equal(fm.description, "first line second line\nnew paragraph");
  assert.equal(fm.after, "x");
});

test("chomping and indent indicators are accepted", () => {
  for (const head of ["|", "|-", "|+", "|2", ">-", ">+"]) {
    const fm = parseFrontmatterFields(`---\nd: ${head}\n  a\n  b\nk: v\n---\nx`);
    assert.equal(fm.k, "v", `key after a ${head} block was lost`);
    assert.ok(fm.d.startsWith("a"), `${head} did not read its body`);
  }
});

test("a blank line inside a `|` block is kept, trailing blanks are not", () => {
  const fm = parseFrontmatterFields("---\nd: |\n  a\n\n  b\n\nk: v\n---\nx");
  assert.equal(fm.d, "a\n\nb");
  assert.equal(fm.k, "v");
});

test("an empty block scalar is an empty string, not the indicator", () => {
  assert.equal(parseFrontmatterFields("---\nd: |\nk: v\n---\nx").d, "");
});

test("the block's own indentation is stripped, deeper indentation is kept", () => {
  const fm = parseFrontmatterFields("---\nd: |\n  a\n    indented\n  b\n---\nx");
  assert.equal(fm.d, "a\n  indented\nb");
});

test("a block scalar does not swallow the body", () => {
  const r = parseFrontmatter("---\nd: |\n  a\n  b\n---\n\n# Heading\n\ntext\n");
  assert.equal(r.fm.d, "a\nb");
  assert.equal(r.body, "# Heading\n\ntext\n");
});

test("nested maps arrive as dotted keys, parent stays as it was", () => {
  const fm = parseFrontmatterFields(
    '---\nname: x\nmetadata:\n  version: "2.11.1"\n  type: project\nafter: y\n---\nbody'
  );
  assert.deepEqual(fm, {
    name: "x",
    metadata: "",                 // unchanged: callers reading fm.metadata still see ""
    "metadata.version": "2.11.1", // quotes stripped, same as a flat value
    "metadata.type": "project",
    after: "y",
  });
});

test("nested maps nest further", () => {
  const fm = parseFrontmatterFields("---\na:\n  b:\n    c: deep\n---\nx");
  assert.equal(fm["a.b.c"], "deep");
});

test("a bare key with nothing under it is still an empty string", () => {
  assert.deepEqual(parseFrontmatterFields("---\na:\nb: 1\n---\nx"), { a: "", b: "1" });
});

test("a YAML list under a key is skipped, not turned into keys", () => {
  const fm = parseFrontmatterFields("---\nskills:\n  - one\n  - two\nk: v\n---\nx");
  assert.deepEqual(fm, { skills: "", k: "v" });
});

test("an indented line with no parent is still skipped", () => {
  // Byte-identical to the flat parser: top level is column 0 and nothing else.
  assert.deepEqual(parseFrontmatterFields("---\n  stray: 1\nok: 2\n---\nx"), { ok: "2" });
});

test("setFrontmatterField replaces a whole block scalar, leaving no orphans", () => {
  const src = "---\nname: x\ndescription: |\n  one\n  two\nlicense: MIT\n---\n\nBody.\n";
  const out = setFrontmatterField(src, "description", "short");
  assert.deepEqual(parseFrontmatterFields(out), {
    name: "x",
    description: "short",
    license: "MIT",
  });
  assert.ok(!out.includes("one"), "the old block body was left behind");
  assert.ok(out.endsWith("\nBody.\n"));
});

test("setFrontmatterField replaces a whole nested map", () => {
  const src = "---\nmetadata:\n  a: 1\n  b: 2\nk: v\n---\nbody";
  const out = setFrontmatterField(src, "metadata", "flat");
  assert.deepEqual(parseFrontmatterFields(out), { metadata: "flat", k: "v" });
});

test("a multi-line value is written as a block scalar and reads back identical", () => {
  const value = "first line\nsecond line";
  const out = setFrontmatterField("---\nname: x\n---\nbody", "description", value);
  assert.equal(parseFrontmatterFields(out).description, value);
  assert.ok(out.includes("description: |"), "a multi-line value must not be written flat");
});

test("round-trip: a file with a block scalar survives editing another field", () => {
  const src = "---\nname: humanizer\ndescription: |\n  one\n  two\nstatus: open\n---\n\nBody.\n";
  const out = setFrontmatterField(src, "status", "closed");
  assert.deepEqual(parseFrontmatterFields(out), {
    name: "humanizer",
    description: "one\ntwo",
    status: "closed",
  });
});

test("formatFrontmatterEntry keeps single-line values byte-identical", () => {
  assert.deepEqual(formatFrontmatterEntry("a", "b"), ["a: b"]);
  assert.deepEqual(formatFrontmatterEntry("a", ""), ["a: "]);
  assert.deepEqual(formatFrontmatterEntry("a", 1), ["a: 1"]);
});
