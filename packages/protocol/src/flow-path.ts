// A Flow's public address: `/flows/<path>`, and `/flows/test/<path>` while the owner listens for a test event
// (DECISIONS.md#d-178). No zod: the panel shows the path a name gets before the Flow is saved.

/** A path the owner chooses: lowercase letters, digits and hyphens inside, at most 64. */
export const FLOW_PATH = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
/** A path saved before paths could be chosen is the Flow's identifier, which may be longer or use `_` and capitals. */
export const FLOW_PATH_SAVED = /^[A-Za-z0-9_-]{1,100}$/;
/** Paths no Flow takes: `test` would read as the test address's own prefix. */
const RESERVED = new Set(["test"]);

/** The path a name gets: its words in lowercase without accents, joined by hyphens; "flow" when nothing is left. */
export function flowPathOf(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) return "flow";
  return RESERVED.has(slug) ? `${slug}-flow` : slug;
}

/** Why a path can't be chosen, or undefined when it can (whether another Flow has it is the core's to say). */
export function flowPathProblem(path: string): "invalid" | "reserved" | undefined {
  if (!FLOW_PATH.test(path)) return "invalid";
  return RESERVED.has(path) ? "reserved" : undefined;
}

/** `base`, or `base-2`, `base-3`… : the first one `taken` says no to. */
export function freeFlowPath(base: string, taken: (path: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; ; i++) {
    const tail = `-${i}`;
    const path = `${base.slice(0, 64 - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!taken(path)) return path;
  }
}
