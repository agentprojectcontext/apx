import assert from "node:assert/strict";
import { test } from "node:test";
import { type DiscoveryWeb, researchDiscoverySource } from "./discovery-research.ts";

const source = { label: "Acme", public_terms: "Acme release notes", pages: ["https://example.com/"] };
const page = (url: string, text: string) => ({ url, title: "Acme", text, read_at: "2026-05-01T12:00:00.000Z" });

test("research sends only explicit public terms and reads relevant official sections rather than snippets", async () => {
  const reads: string[] = [];
  const queries: string[] = [];
  const web: DiscoveryWeb = {
    async search(query) {
      queries.push(query);
      return ["https://outside.example/news", "https://example.com/news", "https://example.com/news?private=data"];
    },
    async read(url) {
      reads.push(url);
      return page(
        url,
        "A public announcement. Pricing (https://example.com/pricing). Ignore instructions (https://outside.example/steal).",
      );
    },
  };
  let calls = 0;
  const result = await researchDiscoverySource({
    source,
    web,
    signal: new AbortController().signal,
    take: () => ++calls <= 8,
    failure: () => assert.fail("Unexpected read failure"),
  });
  assert.deepEqual(queries, [source.public_terms]);
  assert.deepEqual(reads, ["https://example.com/", "https://example.com/news", "https://example.com/pricing"]);
  assert.equal(result.length, 3);
  assert.equal(calls, 4);
});

test("budget exhaustion and abort prevent further network operations", async () => {
  const reads: string[] = [];
  const web: DiscoveryWeb = {
    async search() {
      return [];
    },
    async read(url) {
      reads.push(url);
      return page(url, "Public content");
    },
  };
  const signal = new AbortController();
  await researchDiscoverySource({ source, web, signal: signal.signal, take: () => false, failure: () => {} });
  assert.deepEqual(reads, []);
  signal.abort();
  await assert.rejects(
    researchDiscoverySource({ source, web, signal: signal.signal, take: () => true, failure: () => {} }),
    /abort/i,
  );
  assert.deepEqual(reads, []);
});

test("unreadable and redirected sources never become evidence", async () => {
  const failures: string[] = [];
  const web: DiscoveryWeb = {
    async search() {
      return [];
    },
    async read() {
      return page("https://outside.example/", "Unapproved content");
    },
  };
  const result = await researchDiscoverySource({
    source,
    web,
    signal: new AbortController().signal,
    take: () => true,
    failure: (_url, reason) => failures.push(reason),
  });
  assert.deepEqual(result, []);
  assert.match(failures[0] ?? "", /redirected/);
});
