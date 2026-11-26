export function discoveryJson(value: unknown): unknown {
  if (typeof value !== "string") throw new TypeError("Expected a JSON response");
  const text = value.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  return JSON.parse(fence?.[1] ?? text);
}
