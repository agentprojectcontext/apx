import type { Bucket } from "./storage.ts";

export const PUBLIC_BUDGET = { bytes: 1_000_000_000, reads: 7_500_000, writes: 500_000 } as const;
type Operation =
  | { op: "read"; revocation?: true }
  | { op: "write"; key: string; bytes: number }
  | { op: "release"; key: string };
type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
};
type Totals = { bytes: number; month: string; reads: number; writes: number };

/** Reservations survive failed or uncertain R2 writes; space returns only after a confirmed delete. */
export async function chargeBudget(storage: Storage, input: Operation, now: number) {
  const month = new Date(now).toISOString().slice(0, 7);
  const before = await storage.get<Totals>("totals");
  const totals: Totals = {
    bytes: before?.bytes ?? 0,
    month,
    reads: before?.month === month ? before.reads : 0,
    writes: before?.month === month ? before.writes : 0,
  };
  if (input.op === "read") totals.reads++;
  else {
    if (
      !/^(heads\/[0-9abcdefghjkmnpqrstvwxyz]{8}|copies\/[0-9abcdefghjkmnpqrstvwxyz]{8}\/[a-f0-9]{64})$/.test(input.key)
    )
      throw new Error("invalid_budget_request");
    const key = `object/${input.key}`;
    const previous = (await storage.get<number>(key)) ?? 0;
    if (input.op === "release") {
      totals.bytes -= previous;
      await storage.delete(key);
    } else {
      if (!Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > 10_000_000)
        throw new Error("invalid_budget_request");
      totals.writes++;
      const reserved = Math.max(previous, input.bytes + 1024);
      totals.bytes += reserved - previous;
      if (totals.bytes > PUBLIC_BUDGET.bytes || totals.writes > PUBLIC_BUDGET.writes)
        throw new Error("public_artifact_budget_exhausted");
      await storage.put(key, reserved);
    }
  }
  if (input.op === "read" && totals.reads > (input.revocation ? 9_500_000 : PUBLIC_BUDGET.reads))
    throw new Error("public_artifact_budget_exhausted");
  await storage.put("totals", totals);
}

export class PublicationBudget {
  private ctx: DurableObjectState;
  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }
  async fetch(request: Request) {
    try {
      const input = await request.json<Operation>();
      if (!input || !["read", "write", "release"].includes(input.op)) throw new Error("invalid_budget_request");
      await this.ctx.storage.transaction((storage) => chargeBudget(storage, input, Date.now()));
      return new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
}

export function budgetedBucket(bucket: R2Bucket, namespace: DurableObjectNamespace, revocation = false): Bucket {
  const budget = namespace.get(namespace.idFromName("public-artifacts"));
  async function charge(operation: Operation) {
    const response = await budget.fetch("https://budget.internal/", {
      method: "POST",
      body: JSON.stringify(operation),
    });
    if (!response.ok) throw new Error("public_artifact_budget_exhausted");
  }
  return {
    async get(key: string) {
      await charge({ op: "read", ...(revocation ? { revocation: true } : {}) });
      return bucket.get(key);
    },
    async put(key: string, value: string, options?: R2PutOptions) {
      await charge({ op: "write", key, bytes: new TextEncoder().encode(value).byteLength });
      return bucket.put(key, value, options);
    },
    async delete(key: string) {
      await bucket.delete(key);
      await charge({ op: "release", key });
    },
  };
}
