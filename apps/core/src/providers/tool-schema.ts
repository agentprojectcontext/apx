// Grammar-based OpenAI-compatible servers may reject or expand these string constraints excessively.
// The executor still validates arguments against the original schema before running a tool.
const MAPS = new Set(["properties", "$defs", "definitions", "patternProperties", "dependentSchemas"]);
const SINGLE = new Set(["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"]);
const LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

export function grammarSchema(schema: object): object {
  const walk = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        if (key === "pattern" || key === "maxLength") return [];
        if (MAPS.has(key) && child && typeof child === "object" && !Array.isArray(child))
          return [[key, Object.fromEntries(Object.entries(child).map(([name, spec]) => [name, walk(spec)]))]];
        if (LISTS.has(key) && Array.isArray(child)) return [[key, child.map(walk)]];
        if (SINGLE.has(key)) return [[key, Array.isArray(child) ? child.map(walk) : walk(child)]];
        return [[key, child]];
      }),
    );
  };
  return walk(schema) as object;
}
