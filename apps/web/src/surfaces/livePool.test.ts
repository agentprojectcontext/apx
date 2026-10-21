import assert from "node:assert/strict";
import { test } from "node:test";
import { admit, attachLive, detachLive, dropLive, expired, liveEntries, sweepLive } from "./livePool.ts";

const slot = (surface: string, hosted: boolean, lastSeen: number, keepMs = Number.POSITIVE_INFINITY) => ({
  surface,
  hosted,
  lastSeen,
  keepMs,
});

test("a live page joins while there is room, and a full pool closes the page seen least recently", () => {
  assert.deepEqual(admit([slot("a", true, 1)], "b"), { ok: true });
  const full = [slot("a", false, 30), slot("b", false, 10), slot("c", true, 5)];
  assert.deepEqual(admit(full, "d"), { ok: true, evict: "b" });
});

test("a page shown everywhere keeps its place: no room means the newcomer shows itself, unpooled", () => {
  assert.deepEqual(admit([slot("a", true, 1), slot("b", true, 2), slot("c", true, 3)], "d"), { ok: false });
});

test("a page another placeholder holds is not taken from it; one no placeholder holds is hosted again", () => {
  assert.deepEqual(admit([slot("a", true, 1)], "a"), { ok: false });
  assert.deepEqual(admit([slot("a", false, 1)], "a"), { ok: true });
});

test("a hidden page closes once its keep time runs out; one still shown never does", () => {
  const slots = [slot("a", false, 0, 60_000), slot("b", true, 0, 60_000), slot("c", false, 0)];
  assert.deepEqual(expired(slots, 60_001), ["a"]);
  assert.deepEqual(expired(slots, 59_000), []);
});

test("the pool keeps at most three pages running, rehosts a hidden one and evicts by last seen", () => {
  const el = {} as HTMLElement;
  const host = { el, fit: "content" as const, maxHeight: 600 };
  const ids = ["a", "b", "c"].map((s, i) => attachLive(s, Number.POSITIVE_INFINITY, host, i));
  assert.ok(ids.every((id) => id !== undefined));
  assert.equal(attachLive("d", Number.POSITIVE_INFINITY, host, 10), undefined);
  detachLive("b", ids[1] as number, 20);
  detachLive("a", ids[0] as number, 30);
  assert.ok(attachLive("d", 1000, host, 40) !== undefined);
  assert.deepEqual(
    liveEntries()
      .map((e) => e.surface)
      .sort(),
    ["a", "c", "d"],
  );
  // Hosted again, a hidden page is the same entry: it was never reloaded.
  assert.ok(attachLive("a", Number.POSITIVE_INFINITY, host, 50) !== undefined);
  assert.equal(liveEntries().length, 3);
  const d = liveEntries().find((e) => e.surface === "d");
  detachLive("d", d?.host?.id as number, 60);
  sweepLive(2000);
  assert.deepEqual(
    liveEntries()
      .map((e) => e.surface)
      .sort(),
    ["a", "c"],
  );
  for (const s of ["a", "c"]) dropLive(s);
  assert.equal(liveEntries().length, 0);
});
