import { http } from "../http";
import type { GlobalConfig, PairedClient, PairInit, PairStatus, SuperAgentConfig } from "../../types/daemon";

export const Admin = {
  reload:   () => http.post<{ ok: true; super_agent_model: string; fallback_order: string[] }>("/admin/reload"),
  shutdown: () => http.post<{ ok: true }>("/admin/shutdown"),
  config:   {
    get:   () => http.get<{ config: GlobalConfig }>("/admin/config"),
    patch: (body: { set?: Record<string, unknown>; unset?: string[] }) =>
      http.patch<{ ok: true; config: GlobalConfig }>("/admin/config", body),
  },
  superAgent: () => http.get<SuperAgentConfig>("/admin/super-agent"),
  logs: (file: "errors" | "apx" = "errors", limit = 200) =>
    http.get<{ file: string; entries?: Array<Record<string, unknown>>; lines?: string[] }>(
      `/admin/logs?file=${file}&limit=${limit}`,
    ),
};

export const Pair = {
  list:   () => http.get<{ clients: PairedClient[] }>("/pair/list"),
  revoke: (id: string) => http.del<void>(`/pair/revoke/${encodeURIComponent(id)}`),
  // Mint a pairing nonce (localhost-only on the daemon). Used by the web's
  // "Vincular dispositivo" — same nonce the terminal `apx pair` uses.
  init:   () => http.post<PairInit>("/pair/init", {}),
  status: (pid: string) => http.get<PairStatus>(`/pair/status/${encodeURIComponent(pid)}`),
  // Browser plays the "device" role: confirm a nonce (scanned via QR or pasted)
  // to mint a per-client token. Unauthenticated by design (nonce-gated).
  confirm: (body: { pairing_id: string; label?: string; kind?: string }) =>
    http.post<{ token: string; client_id: string; label: string; kind: string }>("/pair/confirm", body),
};
