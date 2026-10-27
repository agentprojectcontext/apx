// Deterministic flow predicates: webhook data is never executable code.
export type FlowScalar = string | number | boolean | null;
export type FlowPredicate = { path: string[]; equals: FlowScalar };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 16;
const MAX_PREDICATES = 32;

export function matchesFlowPredicates(payload: unknown, predicates: readonly FlowPredicate[]): boolean {
  if (predicates.length > MAX_PREDICATES) throw new Error("Too many flow predicates");
  for (const { path } of predicates) {
    if (path.length === 0 || path.length > MAX_DEPTH || path.some((key) => !key || FORBIDDEN_KEYS.has(key))) {
      throw new Error("Invalid flow predicate path");
    }
  }
  return predicates.every(({ path, equals }) => {
    let value: unknown = payload;
    for (const key of path) {
      if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return false;
      value = (value as Record<string, unknown>)[key];
    }
    return value === equals;
  });
}
