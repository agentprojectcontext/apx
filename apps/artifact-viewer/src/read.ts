import { readPublicCopy } from "@apx/protocol/public-copy";

export { readPublicCopy };

/** Cache only hash-verified parts; metadata always comes from the server or its live listener. */
export function createCopyReader(code: string, read: (path: string) => Promise<unknown>) {
  let parts = new Map<string, unknown>();
  let generation = 0;
  return async (metadata?: unknown) => {
    const expected = ++generation;
    const next = metadata === undefined ? new Map(parts) : new Map<string, unknown>();
    let first = true;
    const copy = await readPublicCopy(code, async (path) => {
      if (path.includes("/parts/")) {
        if (!next.has(path)) next.set(path, await read(path));
        return next.get(path);
      }
      if (first) {
        first = false;
        if (metadata !== undefined) return metadata;
      }
      return read(path);
    });
    if (generation === expected) parts = next;
    return copy;
  };
}
