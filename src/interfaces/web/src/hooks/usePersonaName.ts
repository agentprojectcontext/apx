// Resolve the super-agent display name (the persona shown to the user).
// Reads identity.json via useIdentity(); falls back to "APX" while loading
// or when identity is empty. UI strings should always interpolate this hook
// instead of hardcoding a persona name (it would otherwise drift from what
// the daemon-side resolveAgentName() reports across CLI / Telegram / etc.).
import { useIdentity } from "./useIdentity";

export function usePersonaName(): string {
  const { identity } = useIdentity();
  return (identity as { agent_name?: string })?.agent_name?.trim() || "APX";
}
