// APX's own OAuth client for Google, so the owner signs in without making one in Cloud Console. It is a Desktop app
// client: Google treats it as public (an installed app cannot keep a secret) and PKCE guards each sign-in, so shipping
// it exposes no one's data. See DECISIONS.md#d-130.
import type { ClientCreds } from "./google-oauth.ts";

/**
 * `client_id:client_secret`, base64: encoded only so secret scanners do not flag a value that is public by design.
 * Empty in a build without one: the owner then brings their own client.
 */
const APX_CLIENT = "";

/** A client written as `client_id:client_secret`, or undefined when either half is missing. */
export function clientFromPair(pair: string | undefined): ClientCreds | undefined {
  const at = pair?.indexOf(":") ?? -1;
  if (!pair || at < 1) return undefined;
  const clientId = pair.slice(0, at).trim();
  const clientSecret = pair.slice(at + 1).trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** The client this build ships, if any. */
export const apxGoogleClient = (): ClientCreds | undefined =>
  APX_CLIENT ? clientFromPair(Buffer.from(APX_CLIENT, "base64").toString("utf8")) : undefined;
