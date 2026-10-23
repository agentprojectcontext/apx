// APX's own OAuth client for Google, so the owner signs in without making one in Cloud Console. It is a Desktop app
// client: Google treats its secret as public (an installed app cannot keep one) and PKCE guards each sign-in. It is
// still kept out of the repository: a release build writes it beside build.json from CI's APX_GOOGLE_CLIENT secret, and
// a checkout reads the same file, git-ignored, at its root. See DECISIONS.md#d-130.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientCreds } from "./google-oauth.ts";

/** The root an installed core and a checkout share: where build.json sits. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const CLIENT_FILE = "google-client.json";

/** A client written as `client_id:client_secret`, or undefined when either half is missing. */
export function clientFromPair(pair: string | undefined): ClientCreds | undefined {
  const at = pair?.indexOf(":") ?? -1;
  if (!pair || at < 1) return undefined;
  const clientId = pair.slice(0, at).trim();
  const clientSecret = pair.slice(at + 1).trim();
  // An id is a plain name (123-abc.apps.googleusercontent.com): a JSON text holds a ":" too, and is not one.
  return /^[\w.-]+$/.test(clientId) && clientSecret ? { clientId, clientSecret } : undefined;
}

/** The client in a JSON as Cloud Console downloads it (`installed`), or as the build writes it. */
export function clientFromJson(text: string): ClientCreds | undefined {
  try {
    const data = JSON.parse(text) as { installed?: Record<string, unknown> } & Record<string, unknown>;
    const c = data.installed ?? data;
    const clientId = typeof c.client_id === "string" ? c.client_id.trim() : "";
    const clientSecret = typeof c.client_secret === "string" ? c.client_secret.trim() : "";
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  } catch {
    return undefined;
  }
}

/** The client this install carries, if any: none in a build or a checkout without the file. */
export function apxGoogleClient(root = ROOT): ClientCreds | undefined {
  try {
    return clientFromJson(fs.readFileSync(path.join(root, CLIENT_FILE), "utf8"));
  } catch {
    return undefined;
  }
}
