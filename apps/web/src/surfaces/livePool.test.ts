import assert from "node:assert/strict";
import { test } from "node:test";
import { admit, attachLive, detachLive, dropLive, expired, liveEntries, OPEN_MAX, sweepLive } from "./livePool.ts";

const slot = (surface: string, hosted: boolean, lastSeen: number, keepMs = Number.POSITIVE_INFINITY, open = false) => ({
  surface,
  hosted,
  lastSeen,
  keepMs,
  open,
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

test("opened apps have their own room: they never expire, and only another opened app closes one", () => {
  const live = [slot("l1", false, 1, 1000), slot("l2", false, 2, 1000), slot("l3", false, 3, 1000)];
  const apps = Array.from({ length: OPEN_MAX }, (_, i) =>
    slot(`app${i}`, false, 10 + i, Number.POSITIVE_INFINITY, true),
  );
  // A full live tier does not close an app, and a full app tier does not close a live page.
  assert.deepEqual(admit([...live, ...apps.slice(0, 2)], "app9", true), { ok: true });
  assert.deepEqual(admit([...live, ...apps], "app9", true), { ok: true, evict: "app0" });
  assert.deepEqual(admit([...live, ...apps], "l4"), { ok: true, evict: "l1" });
  // Out of sight for a day, an opened app is still running; a live page is not.
  assert.deepEqual(expired([...live, ...apps], 86_400_000), ["l1", "l2", "l3"]);
});

test("a page first shown live and then opened as an app stays running as an app", () => {
  for (const e of liveEntries()) dropLive(e.surface);
  const host = { el: {} as HTMLElement, fit: "fill" as const, maxHeight: 600 };
  const id = attachLive("board", 1000, host, 0) as number;
  detachLive("board", id, 1);
  attachLive("board", Number.POSITIVE_INFINITY, host, 2, true);
  assert.equal(liveEntries().find((e) => e.surface === "board")?.open, true);
  dropLive("board");
});

test("hosting a running page again keeps its place in the layer, so its frame is never moved and reloaded", () => {
  for (const e of liveEntries()) dropLive(e.surface);
  const host = { el: {} as HTMLElement, fit: "fill" as const, maxHeight: 600 };
  const a = attachLive("a", Number.POSITIVE_INFINITY, host, 0, true) as number;
  detachLive("a", a, 1);
  const b = attachLive("b", Number.POSITIVE_INFINITY, host, 2, true) as number;
  detachLive("b", b, 3);
  attachLive("a", Number.POSITIVE_INFINITY, host, 4, true);
  assert.deepEqual(
    liveEntries().map((e) => e.surface),
    ["a", "b"],
  );
  for (const e of liveEntries()) dropLive(e.surface);
});
