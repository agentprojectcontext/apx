import { http } from "../http";

export type DiscordMode = "always" | "useful" | "mention" | "read";

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
  bot?: { id: string; name: string; avatar_url?: string | null } | null;
  /** How many servers the bot is in. 0 = connected but not invited anywhere. */
  guilds?: number;
  /** The owner's notes: what the bot can do and answer. Public by design. */
  knowledge?: string;
  /** When a `useful` room may be answered uncalled. Empty = the built-in default. */
  reply_when?: string;
  gate_model?: string;
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
  knowledge?: string;
  reply_when?: string;
}

export const Discord = {
  status: () => http.get<DiscordStatus>("/api/discord/status"),
  settings: (patch: DiscordSettingsPatch) => http.patch<DiscordStatus>("/api/discord/settings", patch),
  setChannel: (id: string, body: { mode: DiscordMode; name?: string }) =>
    http.put<DiscordChannelRow>(`/api/discord/channels/${encodeURIComponent(id)}`, body),
  removeChannel: (id: string) => http.del<{ ok: true }>(`/api/discord/channels/${encodeURIComponent(id)}`),
  rooms: () => http.get<{ rooms: DiscordRoom[] }>("/api/discord/rooms"),
  setAvatar: (dataUrl: string) => http.put<{ bot: DiscordStatus["bot"] }>("/api/discord/avatar", { data_url: dataUrl }),
  reconnect: () => http.post<DiscordStatus>("/api/discord/reconnect", {}),
};
