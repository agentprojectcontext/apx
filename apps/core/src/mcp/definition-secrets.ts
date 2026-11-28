import type { McpDef } from "./config.ts";
import { MCP_SECRET_REF } from "./connection-errors.ts";

/** The stored secrets a definition names, in order, once each. */
export const secretNames = (d: McpDef): string[] => [
  ...new Set(
    [...Object.values(d.env), ...Object.values(d.headers), ...d.args, d.url ?? ""].flatMap((v) =>
      [...v.matchAll(MCP_SECRET_REF)].map((m) => m[1] as string),
    ),
  ),
];
