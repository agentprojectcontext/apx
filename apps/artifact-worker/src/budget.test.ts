import assert from "node:assert/strict";
import { test } from "node:test";
import { chargeBudget, PUBLIC_BUDGET } from "./budget.ts";

function fixture() {
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put(key: string, value: unknown) {
      values.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return values.delete(key);
    },
  };
  return { values, storage };
}
const now = Date.UTC(2026, 10, 18);
const key = `copies/abcd1234/${"a".repeat(64)}`;

test("global object reservations are conservative, idempotent in size and released only on confirmed deletion", async () => {
  const f = fixture();
  await chargeBudget(f.storage, { op: "write", key, bytes: 100 }, now);
  await chargeBudget(f.storage, { op: "write", key, bytes: 100 }, now);
  assert.deepEqual(f.values.get("totals"), { month: "2026-11", bytes: 1124, reads: 0, writes: 2 });
  await chargeBudget(f.storage, { op: "write", key, bytes: 50 }, now);
  assert.equal((f.values.get("totals") as { bytes: number }).bytes, 1124);
  await chargeBudget(f.storage, { op: "release", key }, now);
  await chargeBudget(f.storage, { op: "release", key }, now);
  assert.equal((f.values.get("totals") as { bytes: number }).bytes, 0);
});

test("global storage/write/read ceilings fail closed without raising Cloudflare's included limits", async () => {
  assert.equal(PUBLIC_BUDGET.bytes, 1_000_000_000);
  const f = fixture();
  const normal = { month: "2026-11", bytes: 0, reads: 0, writes: 0 };
  f.values.set("totals", { ...normal, bytes: PUBLIC_BUDGET.bytes - 100 });
  await assert.rejects(chargeBudget(f.storage, { op: "write", key, bytes: 100 }, now), /budget_exhausted/);
  assert.equal(f.values.has(`object/${key}`), false);
  f.values.set("totals", { ...normal, writes: PUBLIC_BUDGET.writes });
  await assert.rejects(chargeBudget(f.storage, { op: "write", key, bytes: 100 }, now), /budget_exhausted/);
  f.values.set("totals", { ...normal, reads: PUBLIC_BUDGET.reads });
  await assert.rejects(chargeBudget(f.storage, { op: "read" }, now), /budget_exhausted/);
  await chargeBudget(f.storage, { op: "read", revocation: true }, now);
  await chargeBudget(f.storage, { op: "release", key }, now);
  f.values.set("totals", { ...normal, reads: 9_500_000 });
  await assert.rejects(chargeBudget(f.storage, { op: "read", revocation: true }, now), /budget_exhausted/);
});

test("an injected UTC month boundary resets operation counters but never forgets existing R2 reservations", async () => {
  const f = fixture();
  await chargeBudget(f.storage, { op: "write", key, bytes: 100 }, now);
  f.values.set("totals", { month: "2026-11", bytes: 1124, reads: 9_500_000, writes: PUBLIC_BUDGET.writes });
  await chargeBudget(f.storage, { op: "read" }, Date.UTC(2026, 11, 1));
  assert.deepEqual(f.values.get("totals"), { month: "2026-12", bytes: 1124, reads: 1, writes: 0 });
  for (const bytes of [-1, 0, 10_000_001, 1.5])
    await assert.rejects(chargeBudget(f.storage, { op: "write", key, bytes }, now), /invalid_budget_request/);
  await assert.rejects(chargeBudget(f.storage, { op: "release", key: "../private" }, now), /invalid_budget_request/);
});
