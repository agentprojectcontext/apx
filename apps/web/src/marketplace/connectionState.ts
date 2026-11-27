import type { ExtensionInfo, McpServerStatus } from "@apx/protocol";
import type { ConnectionState } from "./ConnectionCard.tsx";

export function connectionOf(e: ExtensionInfo | undefined, servers: McpServerStatus[]) {
  if (!e?.session?.can_disconnect) return;
  const own = servers.filter((s) => s.scope === "global" && !s.values_of && e.mcp.includes(s.name));
  const has = (status: McpServerStatus["status"]) => own.some((s) => s.status === status);
  const signIn = own.find((s) => s.sign_in_url);
  const saved = e.session.saved;
  const state: ConnectionState = !e.enabled
    ? "off"
    : signIn || has("starting")
      ? "connecting"
      : has("needs-sign-in")
        ? saved
          ? "reconnect"
          : "disconnected"
        : has("error")
          ? "error"
          : has("ready")
            ? "connected"
            : saved
              ? "saved"
              : "disconnected";
  return { state, saved, signIn, canDisconnect: saved };
}
