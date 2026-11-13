// The variables APX keeps for itself, under names it picks: a channel's token, a service's key, a sign-in it holds for
// an integration. Every writer takes its name from here, so Resources › Variables can list them apart from the owner's.

export const channelSecret = (id: string) => `channel-${id}`;
export const serviceSecret = (id: string) => `service-${id}`;
/** Extension secret names hold no "-", so `ext-<id>-<name>` splits one way. */
export const extensionSecret = (id: string, name: string) => `ext-${id}-${name}`;
export const integrationSecret = (id: string, field: string) => `${id}-${field}`;
export const googleRefreshSecret = (id: string) => `${id}-refresh_token`;
export const GOOGLE_CLIENT_SECRET = "google-client_secret";
export const ASANA_SECRET = "asana-token";
export const CHATGPT_SECRET = "chatgpt_login";
export const PUBLIC_TOKEN_PREFIX = "public-token-";
export const artifactSecretPrefix = (artifact: string) => `artifact.${artifact}.`;

/** What else names APX keeps a value for: provider ids and the integrations' own secret fields. */
export type SystemNames = { providers: Iterable<string>; integrations: Iterable<string> };

/**
 * Where APX uses a variable it keeps for itself ("provider:openai", "extension:acme"), or undefined for one of the
 * owner's own. A name that is not one of these is the owner's, even when a provider or a server reads it.
 */
export function systemSecretOwner(name: string, known: SystemNames): string | undefined {
  if (name === CHATGPT_SECRET) return "provider:chatgpt";
  if (name === GOOGLE_CLIENT_SECRET) return "integration:google";
  if (name === ASANA_SECRET) return "integration:asana";
  if (name.startsWith(PUBLIC_TOKEN_PREFIX)) return "public";
  for (const [prefix, kind] of [
    ["channel-", "channel"],
    ["service-", "service"],
  ] as const)
    if (name.startsWith(prefix)) return `${kind}:${name.slice(prefix.length)}`;
  const ext = /^ext-(.+)-[^-]+$/.exec(name);
  if (ext) return `extension:${ext[1]}`;
  const artifact = /^artifact\.([^.]+)\./.exec(name);
  if (artifact) return `artifact:${artifact[1]}`;
  const google = /^(.+)-refresh_token$/.exec(name);
  if (google) return `integration:${google[1]}`;
  for (const id of known.providers) if (name === id) return `provider:${id}`;
  for (const n of known.integrations) if (name === n) return `integration:${name.slice(0, name.lastIndexOf("-"))}`;
  return undefined;
}
