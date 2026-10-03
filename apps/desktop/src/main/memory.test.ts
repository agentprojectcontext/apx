import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryReport, memoryText, memoryWatch, type ProcessMetric } from "./memory.ts";

const metric = (pid: number, type: string, mb: number): ProcessMetric => ({
  pid,
  type,
  memory: { workingSetSize: mb * 1024 },
});

test("each process says what it is (a tab, its site) and the biggest comes first", () => {
  const r = memoryReport(
    [metric(1, "Browser", 150), metric(2, "Tab", 300), metric(3, "Tab", 5000), metric(4, "GPU", 900)],
    new Map([
      [2, { kind: "panel" as const }],
      [3, { kind: "tab" as const, site: "shop.example.com" }],
    ]),
  );
  assert.deepEqual(
    r.items.map((i) => [i.kind, i.site, i.mb]),
    [
      ["tab", "shop.example.com", 5000],
      ["gpu", undefined, 900],
      ["panel", undefined, 300],
      ["main", undefined, 150],
    ],
  );
  assert.equal(r.total_mb, 6350);
});

test("past the limit it says once, in the system's language, which process takes the most; then it keeps quiet", () => {
  let at = 0;
  let mb = 5000;
  const said: string[] = [];
  const w = memoryWatch({
    read: () =>
      memoryReport([metric(9, "Tab", mb)], new Map([[9, { kind: "tab" as const, site: "shop.example.com" }]])),
    limitMb: 4096,
    quietMs: 3_600_000,
    text: memoryText("es-AR"),
    warn: (m) => said.push(m),
    now: () => at,
  });
  w.check();
  at += 60_000;
  w.check();
  assert.deepEqual(said, ["APX está usando 4.9 GB; el que más: Pestaña del navegador · shop.example.com (4.9 GB)."]);
  at += 3_600_000;
  mb = 1000;
  w.check();
  assert.equal(said.length, 1, "under the limit: nothing to say");
});
