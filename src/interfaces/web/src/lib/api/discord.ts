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
  /** How many servers the bot is in. 0 = connected but not invited anywhere. */
  guilds?: number;
  knowledge_path?: string;
}

/** A text room of a server the bot is in, as Discord reported it. */
export interface DiscordRoom {
  id: string;
  name: string | null;
  guild_id: string | null;
  guild: string | null;
  category: string | null;
  /** Its mode when it is already listed, else null. */
  mode: DiscordMode | null;
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
  rooms: () => http.get<{ rooms: DiscordRoom[] }>("/api/discord/rooms"),
  reconnect: () => http.post<DiscordStatus>("/api/discord/reconnect", {}),
};
