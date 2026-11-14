import type { SlashItem } from "./slash.ts";

/** A row of the menu: what "/" lists, a connector after "$", or a group's member after "@". */
export type Item =
  | SlashItem
  | { kind: "mcp"; name: string; description: string }
  | { kind: "agent"; name: string; description: string; tag: string };
