import { http } from "../http";

export type DiscordMode = "always" | "mention" | "read";

export interface DiscordChannelRow {
  id: string;
  mode: DiscordMode;
  name?: string | null;
}

export interface DiscordStatus {
  running: boolean;
  enabled: boolean;
  /** Whether a token is saved. The token itself never leaves the daemon. */
  has_token: boolean;
  owner_ids: string[];
  names: string[];
  channels: DiscordChannelRow[];
  state: "off" | "connecting" | "connected" | "reconnecting" | "error";
  error?: string | null;
  bot?: { id: string; name: string } | null;
  knowledge_path?: string;
}

export interface DiscordSettingsPatch {
  enabled?: boolean;
  token?: string;
  owner_ids?: string[];
  names?: string[];
  knowledge_path?: string;
}

export const Discord = {
  status: () => http.get<DiscordStatus>("/api/discord/status"),
  settings: (patch: DiscordSettingsPatch) => http.patch<DiscordStatus>("/api/discord/settings", patch),
  setChannel: (id: string, body: { mode: DiscordMode; name?: string }) =>
    http.put<DiscordChannelRow>(`/api/discord/channels/${encodeURIComponent(id)}`, body),
  removeChannel: (id: string) => http.del<{ ok: true }>(`/api/discord/channels/${encodeURIComponent(id)}`),
  reconnect: () => http.post<DiscordStatus>("/api/discord/reconnect", {}),
};
