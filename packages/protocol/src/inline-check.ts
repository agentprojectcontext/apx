// What a cards block may hold, checked the same way by every view (inline-ui.ts, inline-views.ts).

const MEDIA = /^med_[A-Za-z0-9_-]{1,80}$/;
const MAX_URL = 2000;

export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
/** The text when present and valid, undefined when absent, false when present and invalid (the block falls back). */
export const optional = (v: unknown, max: number): string | undefined | false =>
  v === undefined ? undefined : text(v, max) ? v : false;

/** A picture or page address a card may use: https only, so a block never reaches a local or plain-text address. */
export function https(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_URL || /\s/.test(v)) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether an image's `src` is a picture APX holds (loaded through the core) rather than a web address. */
export const isMediaId = (src: string): boolean => MEDIA.test(src);
export const picture = (v: unknown): v is string => typeof v === "string" && (MEDIA.test(v) || https(v));

/** A list of `max` items at most, each read by `one`; false when any is invalid. */
export function list<T>(v: unknown, min: number, max: number, one: (item: unknown) => T | false): T[] | false {
  if (!Array.isArray(v) || v.length < min || v.length > max) return false;
  const out: T[] = [];
  for (const item of v) {
    const read = one(item);
    if (read === false) return false;
    out.push(read);
  }
  return out;
}
