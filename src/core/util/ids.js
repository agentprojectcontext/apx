// Short, prefix-able ids derived from a UUID. Stores use these for primary
// keys when an autoincrement isn't a fit (no SQL row counter, JSON files).
import { randomUUID } from "node:crypto";

/**
 * Six-character base36 id derived from a UUID. Random enough for in-process
 * uniqueness inside a single file/store; combine with a prefix when collisions
 * across stores would be ambiguous.
 */
export function shortId(prefix = "") {
  const hex = randomUUID().replace(/-/g, "").slice(0, 8);
  const id = parseInt(hex, 16).toString(36).padStart(6, "0").slice(-6);
  return prefix ? `${prefix}_${id}` : id;
}
