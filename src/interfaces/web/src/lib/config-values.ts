export function getDotted(source: Record<string, unknown> | undefined, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function flattenObject(source: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenObject(value as Record<string, unknown>, nextKey));
    } else {
      out[nextKey] = value;
    }
  }
  return out;
}

export function parseConfigJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON debe ser objeto.");
  }
  return parsed as Record<string, unknown>;
}
