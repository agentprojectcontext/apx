import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactOwners,
  itemName,
  type MemoryItem,
  memoryReport,
  memoryText,
  memoryWatch,
  type ProcessMetric,
} from "./memory.ts";

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

test("an artifact in a process of its own is counted as that app; one inside its page's process is not split out", () => {
  const owners = artifactOwners(
    [
      { name: "", osProcessId: 10 },
      { name: "apx-artifact:Estadísticas APX", osProcessId: 21 },
      { name: "apx-artifact:Gastos del hogar", osProcessId: 22 },
      { name: "apx-artifact:Focus board", osProcessId: 22 },
      { name: "apx-artifact:Inline", osProcessId: 10 },
      { name: "some-other-frame", osProcessId: 23 },
    ],
    10,
  );
  assert.deepEqual(
    [...owners],
    [
      [21, { kind: "app", site: "Estadísticas APX" }],
      [22, { kind: "app", site: "Gastos del hogar, Focus board" }],
    ],
  );
  const r = memoryReport(
    [
      { pid: 10, type: "Tab", memory: { workingSetSize: 200 * 1024 } },
      { pid: 21, type: "Tab", memory: { workingSetSize: 80 * 1024 } },
    ],
    new Map([[10, { kind: "panel" as const }], ...owners]),
  );
  assert.equal(itemName(r.items[1] as MemoryItem, memoryText("es")), "App · Estadísticas APX");
});
