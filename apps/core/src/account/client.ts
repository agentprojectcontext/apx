import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountClient } from "./session.ts";

export const ACCOUNT_CLIENT_FILE = "account-client.json";

/** Firebase's public client configuration is packaged separately, like the Google desktop client. */
export function accountClient(
  value?: string,
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
): AccountClient | undefined {
  try {
    const config = JSON.parse(value ?? fs.readFileSync(path.join(root, ACCOUNT_CLIENT_FILE), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof config.project !== "string" || !/^[a-z][a-z0-9-]{4,62}$/.test(config.project)) return undefined;
    if (typeof config.apiKey !== "string" || !config.apiKey.trim()) return undefined;
    return { project: config.project, apiKey: config.apiKey };
  } catch {
    return undefined;
  }
}
